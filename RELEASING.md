# Releasing

Releases are built by GitHub Actions, not on a developer machine. macOS signing,
notarization, and packaging run on macOS, while Windows packaging runs on its
native runner. The resulting artifacts are collected into one GitHub Release.

## Cutting a release

1. Make sure `main`-bound work is merged and the tree is clean.
2. Set the version in `package.json`. The tag and that version should match.
3. Move the relevant `CHANGELOG.md` entries out of **Unreleased** into a
   section named for the version.
4. Commit, then tag and push:

   ```bash
   git tag v0.2.2
   git push origin v0.2.2
   ```

Pushing a `v*` tag starts the workflow. It requires a matching package version,
syntax checks, behavioral tests and a clean dependency audit. It packages both
platforms, verifies macOS signing/notarization, checks ZIP metadata hashes, and
uploads a draft. It downloads that draft and verifies every checksum before
publishing a release named after the tag with these assets:

| Asset | Platform |
| --- | --- |
| `CodexAccountSwitcher-<version>-arm64.dmg` | macOS, Apple Silicon |
| `CodexAccountSwitcher-<version>-x64.dmg` | macOS, Intel |
| `CodexAccountSwitcher-<version>-arm64.zip` | macOS auto-update payload |
| `CodexAccountSwitcher-<version>-x64.zip` | macOS auto-update payload |
| `latest-mac.yml` | macOS auto-update metadata |
| `CodexAccountSwitcher-Setup-<version>-x64.exe` | Windows 10/11, 64-bit |
| `SHA256SUMS.txt` | Checksums for the above |

To rebuild an existing tag without moving it, run the **Release** workflow
manually from the Actions tab and give it the tag name. Delete the existing
release first, or `gh release create` will refuse to overwrite it. A failed
upload/verification can leave a draft for investigation; do not mark it public
manually without repeating validation. Temporary Actions installer copies are
deleted only after verified publication, with one-day retention as a fallback.

## Public-repository gate

Before changing the repository visibility:

1. Merge the release candidate into `main`; the current default branch must
   contain the application, documentation, CI, and security policy.
2. Do not use the existing `v0.1.0` tag as the first public release: it
   predates the current Electron dependency hardening. Cut a new version from
   the merged `main` branch after validation, and clearly mark any older
   release assets as superseded.
3. Confirm the clean-tree checks in `CONTRIBUTING.md` and review the complete
   commit history for credentials or private data.
4. Enable branch protection on `main` after the repository is public. Require
   pull requests and passing CI before merging; do not allow direct pushes for
   routine changes.
5. Enable Dependabot security updates, secret scanning, and code scanning in
   the repository settings, then verify that the first scans complete.
6. Run `bash scripts/configure-public-repo.sh` after changing visibility to
   apply private reporting, secret protection, dependency security updates and
   required PR/CI checks. Verify the first public CodeQL and native packaging
   runs. The script intentionally refuses to change repository visibility.
7. Keep Windows signing status clearly labeled until Windows code signing is
   configured. macOS signing and notarization are required for distribution.

Changing visibility does not rewrite Git history. Treat every reachable commit,
tag, branch, release asset, and workflow log as public after the change.

## Apple signing and notarization

The macOS job expects these GitHub Actions secrets:

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12` certificate.
- `MAC_CSC_KEY_PASSWORD`: password used when exporting that certificate.
- `APPLE_API_KEY_BASE64`: base64-encoded App Store Connect API `.p8` key.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.

Export the certificate from Keychain Access and encode it without committing
either file:

```bash
base64 -i "Developer ID Application.p12" | pbcopy
base64 -i "AuthKey_KEYID.p8" | pbcopy
```

The workflow materializes the API key only on the ephemeral macOS runner,
passes the certificate to electron-builder, and fails before packaging if any
required secret is missing. The app's updater uses the signed ZIP artifacts and
`latest-mac.yml` attached to the GitHub Release.

The existing unsigned releases cannot self-update safely. Install a newly
signed and notarized release once; subsequent tagged releases can update it.

## Verifying a build locally

Packaging can be exercised without cutting a release. Each command only builds
its own platform:

```bash
npm run pack:win
```

```bash
npm run pack:mac -- -c.mac.forceCodeSigning=false -c.mac.identity=- -c.mac.notarize=false
npm run verify:release -- release mac
```

Output lands in `release/`, which is gitignored. The ad-hoc macOS output above
is a packaging smoke test, not a signed/notarized release. Normal `pack:mac`
requires signing and includes both DMG and ZIP targets. Do not attach smoke
artifacts to a public release.

Existing v0.2.1 and older installers are unsigned. Signing is a requirement for
the next release, not a claim about those old downloads. See
[Public readiness](docs/PUBLIC-READINESS.md).
