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

## Builds are unsigned

Code signing and notarization need the repository owner's signing identities and
credentials, so they are deliberately not configured. The workflow sets
`CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does not attempt to pick
up a keychain identity on the macOS runner.

The consequence is that both operating systems warn on first launch, and users
have to work around it — see **Install** in the README. If these builds are ever
distributed beyond people who know and trust the source, configure signing and
notarization first.

## Who can download from a private repository

Release assets on a private repository are not public. Anyone downloading them
must be signed in to GitHub with access to the repository, and download URLs are
not anonymously fetchable, so they cannot be pasted to someone without access.

To share a build:

- **With a few people** — add them as collaborators on the repository. They can
  then open the Releases page and download normally.
- **With anyone** — either make the repository public, or publish the installers
  from a separate public repository. Do the latter only after reading
  `SECURITY.md`, and only with signed builds.

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
