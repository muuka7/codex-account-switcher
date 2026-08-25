const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Derived from GboyCode/CodexAuth (MIT), simplified for this private fork.
const FILE_CREDENTIAL_STORE_LINE = 'cli_auth_credentials_store = "file"';

function isTomlTableHeader(line) {
  return /^\[\[?.+\]\]?\s*(?:#.*)?$/.test(String(line ?? '').trim());
}

function fileCredentialStoreConfig(content = '') {
  const source = String(content);
  const hasBom = source.startsWith('\uFEFF');
  const body = hasBom ? source.slice(1) : source;
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = body.endsWith('\n');
  const lines = body ? body.split(/\r?\n/) : [];
  if (hadFinalNewline) lines.pop();

  const firstTableIndex = lines.findIndex(isTomlTableHeader);
  const topLevelEnd = firstTableIndex < 0 ? lines.length : firstTableIndex;
  const settingIndexes = [];

  for (let index = 0; index < topLevelEnd; index += 1) {
    if (/^\s*cli_auth_credentials_store\s*=/.test(lines[index])) settingIndexes.push(index);
  }

  let changed = false;
  if (settingIndexes.length) {
    const firstIndex = settingIndexes[0];
    const existingLine = lines[firstIndex];
    const indent = existingLine.match(/^\s*/)?.[0] ?? '';
    const commentIndex = existingLine.indexOf('#');
    const comment = commentIndex >= 0 ? existingLine.slice(commentIndex).trimStart() : '';
    const replacement = `${indent}${FILE_CREDENTIAL_STORE_LINE}${comment ? ` ${comment}` : ''}`;
    if (existingLine !== replacement) {
      lines[firstIndex] = replacement;
      changed = true;
    }
    for (let index = settingIndexes.length - 1; index >= 1; index -= 1) {
      lines.splice(settingIndexes[index], 1);
      changed = true;
    }
  } else {
    lines.unshift(FILE_CREDENTIAL_STORE_LINE);
    changed = true;
  }

  const nextBody = `${lines.join(newline)}${hadFinalNewline || !lines.length ? newline : ''}`;
  return { changed, content: `${hasBom ? '\uFEFF' : ''}${nextBody}` };
}

async function atomicWrite(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, filePath);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

async function ensureFileCredentialStore(codexHome) {
  const configPath = path.join(codexHome, 'config.toml');
  let original = '';
  let existed = true;

  try {
    original = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    existed = false;
  }

  const next = fileCredentialStoreConfig(original);
  if (!next.changed) return { changed: false, configPath, backupPath: null };

  let backupPath = null;
  if (existed) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${configPath}.codex-switcher-backup-${stamp}`;
    await fs.copyFile(configPath, backupPath);
  }

  await atomicWrite(configPath, next.content);
  return { changed: true, configPath, backupPath };
}

module.exports = {
  FILE_CREDENTIAL_STORE_LINE,
  fileCredentialStoreConfig,
  ensureFileCredentialStore,
};
