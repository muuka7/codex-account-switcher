const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ownedProcess, groupAlive } = require('../src/owned-process');
const { deviceLogin } = require('../src/server/device-login');

test('owned process shutdown stops a wrapper and its live descendant', { skip: process.platform === 'win32' }, async t => {
  const child = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process'); const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(p.pid);setInterval(()=>{},1000)`], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const owned = ownedProcess(child);
  t.after(() => owned.stop().catch(() => {}));
  const pid = await new Promise((resolve, reject) => { child.stdout.once('data', data => resolve(Number(data.toString().trim()))); child.once('error', reject); });
  assert.ok(pid > 0); await owned.stop();
  assert.equal(await groupAlive(child.pid), false);
});

test('structured device login emits the official code and completes without returning tokens', { skip: process.platform === 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-device-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const binary = path.join(dir, 'codex');
  await fs.writeFile(binary, `#!${process.execPath}\nconst readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));if(m.id===2){console.log(JSON.stringify({id:2,result:{loginId:'login-id',verificationUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-1234'}}));console.log(JSON.stringify({method:'account/login/completed',params:{loginId:'login-id',success:true}}));}});\n`, { mode: 0o700 });
  const events = [];
  await deviceLogin({ binary, home: dir, env: process.env, onCode: value => events.push(value), timeoutMs: 5000 });
  assert.deepEqual(events, [{ verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' }]);
});
