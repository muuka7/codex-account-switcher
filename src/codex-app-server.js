const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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
  errorCode = 'APP_SERVER_REQUEST_FAILED',
  errorMessage = 'Codex could not complete the requested check.',
}) {
  return new Promise((resolve, reject) => {
    const pathParts = [runtime.pathDir, process.env.PATH].filter(Boolean);
    const child = spawn(runtime.binaryPath, ['app-server'], {
      windowsHide: true,
      env: {
        ...process.env,
        PATH: pathParts.join(path.delimiter),
        CODEX_HOME: codexHome,
        CODEX_SQLITE_HOME: sqliteHome,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finishing = false;
    let closed = false;
    const closeWaiters = [];

    function markClosed() {
      closed = true;
      while (closeWaiters.length) closeWaiters.shift()();
    }

    function waitForClose(waitMs) {
      if (closed) return Promise.resolve();
      return Promise.race([
        new Promise((done) => closeWaiters.push(done)),
        new Promise((done) => setTimeout(done, waitMs)),
      ]);
    }

    async function stopChild() {
      try { child.stdin.end(); } catch {}
      if (!closed) child.kill();
      await waitForClose(1800);
      if (!closed) {
        child.kill('SIGKILL');
        await waitForClose(700);
      }
    }

    async function finish(error, value) {
      if (finishing) return;
      finishing = true;
      clearTimeout(timeout);
      await stopChild();
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
    child.once('close', (code) => {
      markClosed();
      if (!finishing) finish(appServerError(`The Codex usage runtime stopped unexpectedly (${code ?? 'unknown'}).`, 'APP_SERVER_EXITED'));
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 1000) stderr += chunk.toString('utf8').slice(0, 1000 - stderr.length);
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      while (stdout.includes('\n')) {
        const newline = stdout.indexOf('\n');
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }

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
        clientInfo: { name: 'codex-account-switcher', version: '0.2.0' },
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
  readRateLimits,
  resolveCodexRuntime,
};
