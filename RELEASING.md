# Releasing

Releases are built by GitHub Actions, not on a developer machine. A macOS DMG
can only be produced on macOS, so `.github/workflows/release.yml` builds the two
platforms on their own runners in parallel and collects both sets of installers
into a single GitHub Release.

## Cutting a release

1. Make sure `main`-bound work is merged and the tree is clean.
2. Set the version in `package.json`. The tag and that version should match.
3. Move the relevant `CHANGELOG.md` entries out of **Unreleased** into a
   section named for the version.
4. Commit, then tag and push:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

Pushing a `v*` tag starts the workflow. It lints, packages both platforms,
generates `SHA256SUMS.txt`, and publishes a release named after the tag with
these assets:

| Asset | Platform |
| --- | --- |
| `CodexAccountSwitcher-<version>-arm64.dmg` | macOS, Apple Silicon |
| `CodexAccountSwitcher-<version>-x64.dmg` | macOS, Intel |
| `CodexAccountSwitcher-Setup-<version>-x64.exe` | Windows 10/11, 64-bit |
| `SHA256SUMS.txt` | Checksums for the above |

To rebuild an existing tag without moving it, run the **Release** workflow
manually from the Actions tab and give it the tag name. Delete the existing
release first, or `gh release create` will refuse to overwrite it.

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
6. Keep unsigned builds clearly labeled until macOS signing/notarization and
   Windows code signing are configured.

Changing visibility does not rewrite Git history. Treat every reachable commit,
tag, branch, release asset, and workflow log as public after the change.

## Builds are unsigned

Code signing and notarization need the repository owner's signing identities and
credentials, so they are deliberately not configured. The workflow sets
`CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does not attempt to pick
up a keychain identity on the macOS runner.

The consequence is that both operating systems warn on first launch, and users
have to work around it — see **Install** in the README. If these builds are ever
distributed beyond people who know and trust the source, configure signing and
notarization first.

## Distribution status

Once the repository is public, release assets can be downloaded without GitHub
repository access. The current installers remain unsigned, so broad
distribution should wait for code signing and notarization. Until then, keep
the warning in the release notes and ask users to verify `SHA256SUMS.txt`.

## Verifying a build locally

Packaging can be exercised without cutting a release. Each command only builds
its own platform:

```bash
npm run pack:win
```

```bash
npm run pack:mac
```

Output lands in `release/`, which is gitignored.
