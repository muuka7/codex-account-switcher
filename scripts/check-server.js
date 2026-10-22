const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const name of fs.readdirSync(path.join(__dirname, '../src/server'))) {
  if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(__dirname, '../src/server', name)], { stdio: 'inherit' });
}
