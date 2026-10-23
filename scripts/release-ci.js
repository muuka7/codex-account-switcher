const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateContext, requireDraft, writeReceipt, verifyReceipt, writeChecksums, writeMacVerification } = require('./release-manifest');

async function main() {
  const [command, directory] = process.argv.slice(2);
  if (!['check-draft', 'record-windows', 'record-macos', 'checksums'].includes(command) || !directory) throw new Error('Expected check-draft, record-windows, record-macos or checksums and an asset directory.');
  const dir = path.resolve(directory);
  const context = {
    version: require('../package.json').version,
    tag: process.env.RELEASE_TAG,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    teamId: require('../.github/release-policy.json').macTeamId,
    workflowRunId: process.env.GITHUB_RUN_ID,
  };
  validateContext(context);
  const release = JSON.parse(execFileSync('gh', ['release', 'view', context.tag, '--json', 'isDraft,tagName'], { encoding: 'utf8' }));
  requireDraft(release, context);
  if (command === 'check-draft') await verifyReceipt(dir, 'mac', context);
  else if (command === 'record-windows') {
    const assets = await writeReceipt(dir, 'win', context);
    execFileSync('gh', ['release', 'upload', context.tag, ...assets.map(name => path.join(dir, name)), '--clobber'], { stdio: 'inherit' });
  } else if (command === 'record-macos') {
    await writeMacVerification(dir, context);
    execFileSync('gh', ['release', 'upload', context.tag, path.join(dir, 'macos-ci-verification.json'), '--clobber'], { stdio: 'inherit' });
  } else {
    const files = await writeChecksums(dir, context);
    for (const name of await fs.readdir(dir)) {
      if (!files.includes(name)) throw new Error(`Unexpected release asset: ${name}`);
    }
    if (!(await fs.stat(path.join(dir, 'SHA256SUMS.txt'))).isFile()) throw new Error('Checksum creation failed.');
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
