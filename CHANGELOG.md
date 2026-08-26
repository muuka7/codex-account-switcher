# Changelog

Notable changes to Codex Account Switcher. Dates are ISO-8601.

## 0.1.0 — 2026-08-26

First tagged release. Prebuilt, unsigned installers for macOS (Intel and Apple
Silicon) and Windows are attached to the release on GitHub.

### Release infrastructure

- Added `.github/workflows/release.yml`. Pushing a `v*` tag lints, packages on a
  macOS runner and a Windows runner in parallel, generates `SHA256SUMS.txt`, and
  publishes one GitHub Release carrying both platforms' installers. The workflow
  can also be run manually against an existing tag.
- The workflow uses only first-party actions and the preinstalled `gh` CLI, so
  the release path pulls in no third-party action code.
- Sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does not try to
  pick up a keychain signing identity on the macOS runner.
- Added `RELEASING.md` covering how to cut a release, why the builds are
  unsigned, and what private-repository distribution does and does not allow.
- Added an **Install** section to the README with the Gatekeeper and SmartScreen
  workarounds first-time users will hit.

### Interface redesign

The switcher was built like a dashboard: a persistent sidebar, three navigation
destinations, and a two-panel workspace that showed the same account twice and
required select-then-act before the primary action. In practice the app is
opened for a few seconds to pick an account, or never opened at all because a
global shortcut does the job. The interface is now shaped for that.

#### Structure

- Collapsed the sidebar and the Accounts / Shortcuts / Preferences views into a
  single screen. The account card is now the control itself: identity, plan,
  credential freshness, shortcut, a **Switch** button, and a **⋯** menu holding
  **Re-authenticate…**, **Change shortcut…** and **Remove account…**.
- Removed the detail panel. With two to four accounts, selecting a row before
  acting on it was a step that bought nothing, and the panel duplicated every
  field already visible in the list.
- Moved shortcuts, launch size, open-at-login, activity counts and the safety
  notes into one settings sheet behind a single gear button.
- Replaced the three competing add-account entry points (topbar button, pinned
  onboarding panel, inline import form) with one guided two-step dialog.
- Surfaced the "never use Codex's own Logout" warning inside that dialog, where
  it can prevent the mistake. It previously appeared only in the README.

#### Feedback and friction

- Replaced the single 170px status pill — which truncated error messages and was
  hidden entirely below 560px — with dismissible inline notices that hold a full
  sentence, plus an indeterminate progress bar during the close-swap-reopen
  cycle.
- Dropped the confirmation dialog on **Switch**. It is the routine action and is
  reversible by switching back. Confirmation is kept on the paths that are not:
  removing an account, re-authenticating, and clearing activity counts.
- Step 1 of the add-account dialog now stands in for its own confirmation
  instead of raising a second dialog that restated it.

#### Visual hierarchy

- The active account is the only card that is tinted, lifted and marked with a
  coloured rail, and the only one carrying a filled chip.
- **Switch** is outlined at rest and fills only on hover. A solid accent button
  on every inactive card was drawing the eye away from the active account, so
  emphasis landed on the wrong row.
- Credential freshness reads as words in the card's meta line as well as a
  coloured dot, so it does not depend on colour alone.

#### Design system

- Introduced tokens: one 4pt spacing scale, one type scale, and a semantic
  colour ramp replacing roughly sixty hardcoded hex values that had drifted into
  seven near-identical greys for "a border".
- The window now follows the operating system's light/dark setting, with a
  System / Light / Dark override under **Settings → Appearance**. The choice is
  stored per device in `localStorage`, not in `settings.json`.

#### Accessibility

- Real list semantics for the account list, replacing two tab stops per account
  where the shortcut was read aloud as part of the button name.
- Focus trap and focus restore in every dialog and in the settings sheet.
- Live regions for status and error messages.
- Text now meets WCAG AA contrast at every size. The previous smallest labels
  measured roughly 3.4:1 to 4.2:1.
- The add-account dialog's accessible name follows whichever step heading is
  visible.

#### Main process

- Added a read-only `state:live` IPC channel and a `getLiveAccount` bridge
  method, so the renderer can report which account Codex is signed in to without
  performing a switch. It returns only `present`, `email` and `planType`, all
  derived from the same local `auth.json` the switcher already reads. The
  renderer feature-detects it and degrades silently if it is absent.

#### Documentation

- Rewrote the README's **First use** and **Re-authenticating** walkthroughs,
  which named controls the redesign removed (**Import**, **Add another account
  safely**, **Re-auth**, **Complete re-auth**).
- Added an **Interface** section describing the single screen and what the
  active-card treatment, freshness dot and banners mean.
