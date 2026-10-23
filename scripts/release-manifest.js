const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyRelease, digest } = require('./verify-release');

function validateContext(context) {
  if (!/^\d+\.\d+\.\d+$/.test(context.version) || context.tag !== `v${context.version}` || !/^[a-f0-9]{40}$/.test(context.sha)) {
    throw new Error('The release tag, version and full source commit must match.');
  }
}

function requireDraft(release, context) {
  validateContext(context);
  if (!release?.isDraft || release.tagName !== context.tag) throw new Error('An existing matching draft is required. Published releases are never changed.');
}

function receiptName(platform) {
  if (!['mac', 'win'].includes(platform)) throw new Error('Expected receipt platform mac or win.');
  return platform === 'mac' ? 'macos-verification.json' : 'windows-verification.json';
}

async function writeReceipt(dir, platform, context) {
  validateContext(context);
  if (platform === 'mac' && !/^[A-Z0-9]{10}$/.test(context.teamId)) throw new Error('An Apple team ID is required.');
  if (platform === 'win' && !/^\d+$/.test(context.workflowRunId)) throw new Error('A workflow run ID is required.');
  const files = await verifyRelease(dir, platform, context.version);
  const assets = [];
  for (const name of files) assets.push({ name, size: (await fs.stat(path.join(dir, name))).size, sha256: await digest(path.join(dir, name), 'sha256') });
  const receipt = { schema: 1, platform, tag: context.tag, version: context.version, sourceCommit: context.sha, assets };
  if (platform === 'mac') receipt.teamId = context.teamId;
  else receipt.workflowRunId = context.workflowRunId;
  await fs.writeFile(path.join(dir, receiptName(platform)), `${JSON.stringify(receipt, null, 2)}\n`);
  return [...files, receiptName(platform)];
}

async function verifyReceipt(dir, platform, context) {
  validateContext(context);
  const receipt = JSON.parse(await fs.readFile(path.join(dir, receiptName(platform)), 'utf8'));
  if (receipt.schema !== 1 || receipt.platform !== platform || receipt.tag !== context.tag || receipt.version !== context.version || receipt.sourceCommit !== context.sha) {
    throw new Error('Release receipt does not match this source commit and tag.');
  }
  if (platform === 'mac' && receipt.teamId !== context.teamId) throw new Error('The macOS receipt uses the wrong Apple team.');
  if (platform === 'win' && context.workflowRunId && receipt.workflowRunId !== context.workflowRunId) throw new Error('Windows assets were not verified by this workflow run.');
  const expected = await verifyRelease(dir, platform, context.version);
  if (!Array.isArray(receipt.assets) || receipt.assets.length !== expected.length) throw new Error('Release receipt has an incomplete asset list.');
  const seen = new Set();
  for (const asset of receipt.assets) {
    if (!expected.includes(asset.name) || seen.has(asset.name)) throw new Error('Release receipt contains an unexpected or duplicate filename.');
    seen.add(asset.name);
    const file = path.join(dir, asset.name);
    if ((await fs.stat(file)).size !== asset.size || await digest(file, 'sha256') !== asset.sha256) throw new Error(`Release asset changed after verification: ${asset.name}`);
  }
  return [...expected, receiptName(platform)];
}

async function writeChecksums(dir, context) {
  const macFiles = await verifyReceipt(dir, 'mac', context);
  const verification = JSON.parse(await fs.readFile(path.join(dir, 'macos-ci-verification.json'), 'utf8'));
  if (verification.workflowRunId !== context.workflowRunId || !/^\d+$/.test(context.workflowRunId) || !Array.isArray(verification.assets) || verification.assets.length !== macFiles.length) throw new Error('macOS signatures were not verified by this workflow run.');
  const seen = new Set();
  for (const asset of verification.assets) {
    if (!macFiles.includes(asset.name) || seen.has(asset.name) || await digest(path.join(dir, asset.name), 'sha256') !== asset.sha256) throw new Error('macOS assets changed after independent signature verification.');
    seen.add(asset.name);
  }
  const files = [...macFiles, ...await verifyReceipt(dir, 'win', context), 'macos-ci-verification.json'].sort();
  const lines = [];
  for (const file of files) lines.push(`${await digest(path.join(dir, file), 'sha256')}  ${file}`);
  await fs.writeFile(path.join(dir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
  return [...files, 'SHA256SUMS.txt'];
}

async function writeMacVerification(dir, context) {
  if (!/^\d+$/.test(context.workflowRunId)) throw new Error('A workflow run ID is required.');
  const files = await verifyReceipt(dir, 'mac', context);
  const assets = [];
  for (const name of files) assets.push({ name, sha256: await digest(path.join(dir, name), 'sha256') });
  await fs.writeFile(path.join(dir, 'macos-ci-verification.json'), `${JSON.stringify({ workflowRunId: context.workflowRunId, assets }, null, 2)}\n`);
}

module.exports = { validateContext, requireDraft, receiptName, writeReceipt, verifyReceipt, writeChecksums, writeMacVerification };
