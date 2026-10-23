# Releasing

macOS releases are signed and notarized on the maintainer's Mac using its
Keychain. GitHub Actions builds Windows, independently verifies the uploaded
macOS installers, and **automatically publishes after all verification passes**.
Apple private keys and notarization passwords do not need GitHub Secrets.
There is no self-hosted runner with access to this Mac.

## One-time setup on the signing Mac

Use Node.js 24 (`.nvmrc`) and authenticate the GitHub CLI with repository write
and Actions workflow access. The Mac needs a valid Developer ID Application
identity for the Apple team in `.github/release-policy.json` and at least 8 GiB
of free working space. This is a preflight minimum; large dependency downloads
may require additional space.

```bash
npm run release:setup
```

This selects the matching local signing identity and writes only non-secret
configuration to `~/.config/codex-account-switcher/mac-release.json` (mode 0600).
The default notarization profile is `codex-account-switcher-notary`. Enroll it
in a local terminal using Apple's interactive credential prompts:

```bash
xcrun notarytool store-credentials codex-account-switcher-notary --team-id XV69GQQN2L
```

Enter your Apple ID and an Apple app-specific password in Apple's prompt.
Do not send passwords in chat, pass them in command arguments, commit them, or
export the signing private key. Apple validates and saves the notarization
credentials in Keychain. An existing API-key-backed Keychain profile also works;
the release scripts only need the profile name. Check the complete setup:

```bash
npm run release:doctor
```

To use an existing profile or another working volume:

```bash
npm run release:setup -- --profile YOUR_PROFILE --output /Volumes/Builds/switcher-releases
```

If the profile lives in a specific Keychain, add `--keychain /absolute/path`.
Build outputs, downloads and temporary extraction files use the chosen working
volume. `npm ci` still installs dependencies in the source checkout, so that
volume also needs enough space for `node_modules`.

## Cutting a release

1. Merge the candidate into `main` and verify CI is green.
2. Update the version in `package.json` and `package-lock.json`, and move the
   relevant `CHANGELOG.md` entries into a versioned section. Commit and push.
3. On the signing Mac, use a clean checkout of that exact pushed `main` commit:

   ```bash
   npm run release:mac
   ```

This command checks Keychain/GitHub access and disk space, installs locked
dependencies, runs syntax checks, behavioral tests and both dependency audits,
then builds Intel and Apple Silicon DMGs and ZIPs. It checks the bundled Codex
runtimes, update metadata hashes, Developer ID signatures, expected Apple team,
stapled notarization tickets and Gatekeeper assessment. Each architecture's DMG
and ZIP must contain the same signed app.

Only after those checks does it create/push the matching version tag, upload a
draft with macOS assets and a source/hash receipt, and dispatch the **Release**
workflow. Invoking this command authorizes automatic publication when the
workflow passes; there is no further manual publication step.

GitHub builds and tests the Windows installer. A separate hosted Mac verifies
the uploaded macOS signatures and notarization without Apple credentials. Each
job records exactly which assets it verified. The publish job requires both
records to match the tag's source commit and the current workflow run, uploads
checksums, downloads everything again, and checks the files before publication.
Any failure leaves the release unpublished for investigation.

| Asset | Purpose |
| --- | --- |
| `CodexAccountSwitcher-<version>-arm64.dmg` | macOS, Apple Silicon |
| `CodexAccountSwitcher-<version>-x64.dmg` | macOS, Intel |
| `CodexAccountSwitcher-<version>-arm64.zip` | Apple Silicon update payload |
| `CodexAccountSwitcher-<version>-x64.zip` | Intel update payload |
| `latest-mac.yml` | macOS update metadata |
| `CodexAccountSwitcher-Setup-<version>-x64.exe` | Windows 10/11, 64-bit |
| `*-verification.json` | Source and asset verification records |
| `SHA256SUMS.txt` | Checksums for installers and verification records |

Installers move through **draft Release assets**, not Actions artifact uploads.
No installer artifact copies consume the Actions artifact-storage allowance.
The Windows installer remains unsigned and updates manually. The existing
v0.2.1 and older macOS installers are unsigned: install the first signed version
manually before relying on subsequent signed updates.

## Recovering from a failed attempt

The local command refuses existing output folders and remote tags, and never
erases a failed build. Inspect the error and retain the files for diagnosis.
If the tag and matching draft were uploaded successfully, rerun the **Release**
workflow from `main`, supplying that tag. All platform verification is repeated;
stale verification records from earlier runs cannot publish the release.

If upload failed before a matching draft was created, recover that draft only
from the verified local output and its macOS receipt, or bump the version and
start a fresh attempt. Do not manually publish an incomplete draft. Published
releases are never overwritten by these scripts; fixes require a new version.

## Public-repository gate

Before changing repository visibility:

1. Confirm the exact candidate commit has green validation and both native
   packaging smoke jobs. Do not use the old `v0.1.0` tag as a public candidate.
2. Review the complete history, tags, assets and workflow logs for private data.
   Generalizing current docs does not remove original deployment aliases,
   usernames and paths from older commits. Decide whether that non-secret
   metadata is acceptable before publication.
3. Change visibility only after the maintainer has made that decision.
4. Run `bash scripts/configure-public-repo.sh` as a repository administrator.
   It refuses private repositories and does not change visibility. It enables
   private reporting, secret scanning/push protection, dependency alerts and
   security updates, GitHub-owned/SHA-pinned Actions, external-workflow approval,
   and main protection requiring PRs and passing checks. The check sources are
   bound to GitHub Actions. The default is zero required approvals so the owner
   can merge checked PRs independently. Set `REQUIRED_APPROVALS=1` to require
   another reviewer when desired.
5. Verify the settings and the first public CodeQL and PR checks.
6. Complete a real signed distribution and update test before advertising
   signed releases or a verified update path.

See [Public readiness](docs/PUBLIC-READINESS.md) for evidence and remaining gates.

## Packaging smoke tests

These exercise packaging without tagging or publishing:

```bash
npm run pack:win
```

```bash
npm run pack:mac -- -c.mac.forceCodeSigning=false -c.mac.identity=- -c.mac.notarize=false
npm run verify:release -- release mac --packaged
```

Smoke output is gitignored and is not a distribution-trusted installer. Normal
`pack:mac` requires signing and notarization. Use `release:mac` for the full
verified publication flow.
