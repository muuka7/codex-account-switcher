const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ownedProcess } = require('./owned-process');

const TARGETS = Object.freeze({
  'darwin:x64': { packageName: '@openai/codex-darwin-x64', triple: 'x86_64-apple-darwin', binary: 'codex' },
  'darwin:arm64': { packageName: '@openai/codex-darwin-arm64', triple: 'aarch64-apple-darwin', binary: 'codex' },
  'win32:x64': { packageName: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc', binary: 'codex.exe' },
  'win32:arm64': { packageName: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc', binary: 'codex.exe' },
});

function executablePath(candidate) {
  const marker = `${path.sep}app.asar${path.sep}`;
  return candidate.includes(marker)
    ? candidate.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
    : candidate;
}

function resolveCodexRuntime({ platform = process.platform, arch = process.arch } = {}) {
  const override = process.env.CODEX_SWITCHER_CODEX_BINARY;
  if (override) {
    const binaryPath = path.resolve(override);
    if (!fs.existsSync(binaryPath)) throw Object.assign(new Error('The configured Codex runtime was not found.'), { code: 'RUNTIME_MISSING' });
    return { binaryPath, pathDir: null };
  }

  const target = TARGETS[`${platform}:${arch}`];
  if (!target) throw Object.assign(new Error(`Usage checks are not supported on ${platform} ${arch}.`), { code: 'RUNTIME_UNSUPPORTED' });

  // Packaging copies the target-specific runtime before code signing. This is
  // independent of which optional npm package was installed on the build host.
  if (process.resourcesPath) {
    const root = path.join(process.resourcesPath, 'codex-runtime');
    const binaryPath = path.join(root, 'bin', target.binary);
    if (fs.existsSync(binaryPath)) return { binaryPath, pathDir: path.join(root, 'codex-path') };
  }

  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${target.packageName}/package.json`);
  } catch {
    throw Object.assign(new Error('The bundled Codex usage runtime is unavailable. Reinstall or update the switcher.'), { code: 'RUNTIME_MISSING' });
  }

  const vendorRoot = path.join(path.dirname(packageJsonPath), 'vendor', target.triple);
  const binaryPath = executablePath(path.join(vendorRoot, 'bin', target.binary));
  const pathDir = executablePath(path.join(vendorRoot, 'codex-path'));
  if (!fs.existsSync(binaryPath)) {
    throw Object.assign(new Error('The bundled Codex usage runtime is incomplete. Reinstall or update the switcher.'), { code: 'RUNTIME_MISSING' });
  }
  return { binaryPath, pathDir: fs.existsSync(pathDir) ? pathDir : null };
}

function appServerError(message, code = 'APP_SERVER_ERROR') {
  return Object.assign(new Error(message), { code });
}

function appServerRequest({
  codexHome,
  sqliteHome = codexHome,
  method,
  params = {},
  timeoutMs = 30000,
  runtime = resolveCodexRuntime(),
  env = process.env,
  cwd,
  errorCode = 'APP_SERVER_REQUEST_FAILED',
  errorMessage = 'Codex could not complete the requested check.',
}) {
  return new Promise((resolve, reject) => {
    const pathParts = [runtime.pathDir, env.PATH].filter(Boolean);
    const child = spawn(runtime.binaryPath, ['app-server'], {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: {
        ...env,
        PATH: pathParts.join(path.delimiter),
        CODEX_HOME: codexHome,
        CODEX_SQLITE_HOME: sqliteHome,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const owned = ownedProcess(child);
    let stdout = '';
    let finishing = false;

    async function finish(error, value) {
      if (finishing) return;
      finishing = true;
      clearTimeout(timeout);
      try { await owned.stop(); } catch (stopError) { reject(stopError); return; }
      if (error) reject(error);
      else resolve(value);
    }

    function send(message) {
      if (!finishing && child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    const timeout = setTimeout(() => {
      finish(appServerError('The Codex usage check timed out.', 'APP_SERVER_TIMEOUT'));
    }, timeoutMs);

    child.once('error', () => finish(appServerError('The Codex usage runtime could not be started.', 'APP_SERVER_START_FAILED')));
    child.stdin.on('error', () => finish(appServerError('The Codex usage runtime connection closed.', 'APP_SERVER_EXITED')));
    child.once('close', (code) => {
      if (!finishing) finish(appServerError(`The Codex usage runtime stopped unexpectedly (${code ?? 'unknown'}).`, 'APP_SERVER_EXITED'));
    });
    child.stderr.on('data', () => {});
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 4 * 1024 * 1024) {
        finish(appServerError('Usage response exceeded the size limit.', 'APP_SERVER_REQUEST_FAILED'));
        return;
      }
      while (stdout.includes('\n')) {
        const newline = stdout.indexOf('\n');
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }

        if (message.id === 1 && message.error) {
          finish(appServerError('Codex could not initialize the usage connection.', 'APP_SERVER_REQUEST_FAILED'));
          continue;
        }
        if (message.id === 1 && message.result) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method, params });
          continue;
        }

        if (message.id === 2) {
          if (message.error) {
            finish(appServerError(message.error.message || errorMessage, errorCode));
          } else {
            finish(null, message.result || {});
          }
        }
      }
    });

    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codex-account-switcher', version: '0.3.0' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function readRateLimits(options) {
  return appServerRequest({
    ...options,
    method: 'account/rateLimits/read',
    errorCode: 'RATE_LIMITS_READ_FAILED',
    errorMessage: 'Codex could not read usage limits.',
  });
}

module.exports = {
  TARGETS,
  appServerRequest,
  readRateLimits,
  resolveCodexRuntime,
};
