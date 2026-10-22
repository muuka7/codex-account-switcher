const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (entry.name.endsWith('.js')) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
for (const dir of ['src', 'scripts', 'test']) check(path.join(__dirname, '..', dir));
