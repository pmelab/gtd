# Task: Update README build/release docs for the shim + dist/ flow

## Description

The build now outputs `dist/gtd.bundle.mjs` and `scripts/gtd.js` is a launcher
shim that downloads the bundle from GitHub Releases on first use. Update the
Development section of `README.md` (around lines 488–508) to match.

Changes:

- Line ~493: change the build comment from
  `npm run build        # tsup → scripts/gtd.js (checked in)`
  to reflect the new output, e.g.
  `npm run build        # tsup → dist/gtd.bundle.mjs (+ copy to scripts/)`.
- The `dev/` paragraph mentioning `tsup wipes scripts/ (clean: true)` is now
  stale in part — tsup wipes `dist/`, not `scripts/`, since `outDir` moved.
  Update that wording so it is accurate (the `dev/` helpers still live outside
  the build output dir; the reason is the build no longer targets `scripts/`).
- Replace the line ~507–508 paragraph
  ("`scripts/gtd.js` is committed to the repo so the skill installs zero-step.
  Rebuild it before tagging a release.") with the new story: `scripts/gtd.js` is
  a tiny launcher shim; the real bundle is downloaded automatically from the
  latest GitHub release on first invocation, or built locally via
  `npm run build`.
- Add a short "Releasing" note: tag `vX.Y.Z`, push the tag, and CI
  (`.github/workflows/release.yml`) runs tests, builds the bundle, and uploads
  it to a GitHub release as `gtd.bundle.mjs`.

Per the project convention, ensure the README accurately reflects the change.
Do NOT edit any file other than `README.md`.

## Acceptance criteria

- [ ] README build command comment references `dist/gtd.bundle.mjs`, not
      `scripts/gtd.js (checked in)`.
- [ ] Stale "tsup wipes scripts/" wording is corrected.
- [ ] The "committed to the repo so the skill installs zero-step" paragraph is
      replaced with the download-on-first-use / shim story.
- [ ] A "Releasing" note documents tag `vX.Y.Z` → push → CI builds + uploads the
      bundle.
- [ ] `npm run format:check` passes for README.md.

## Files

- `/Users/pmelab/Code/gtd/gtd/README.md`
