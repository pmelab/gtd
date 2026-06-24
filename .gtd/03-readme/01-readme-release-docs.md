# Update README release/build docs for semantic-release

Update `README.md` to document the new automated release flow and the
version-pinned shim. Two regions need editing.

## 1. The shim paragraph (around lines 507-509)

Currently:

> `scripts/gtd.js` is a tiny launcher shim; the real bundle
> (`dist/gtd.bundle.mjs`) is downloaded automatically from the latest GitHub
> release on first invocation, or built locally with `npm run build`.

Update it so it states the shim downloads the **version-pinned** bundle matching
its bundled `package.json` version (falling back to `latest` for the
`0.0.0-development` placeholder), still short-circuited by a locally built
bundle.

## 2. The "Releasing" section (around lines 511-514)

Currently:

> ## Releasing
>
> Tag `vX.Y.Z` and push the tag. CI (`.github/workflows/release.yml`) runs the
> tests, builds the bundle, and uploads `gtd.bundle.mjs` as a release asset.

Replace with documentation of the semantic-release flow:

- Releases are automatic: push releasable Conventional Commits (`fix:`, `feat:`,
  or breaking changes) to `main`.
- The Release workflow runs the tests, then `npx semantic-release`, which
  computes the next version from commit history, writes it into `package.json`,
  builds the bundle, commits the bump back to `main`
  (`chore(release): ... [skip ci]`), tags `vX.Y.Z`, and creates the GitHub
  release with `gtd.bundle.mjs` attached.
- Remove the manual `git tag vX.Y.Z && git push --tags` instruction entirely.
- Optionally note that the first release defaults to `v1.0.0` since no prior
  tags exist (a seed tag like `v0.1.0` can anchor a `0.x` line instead).

Keep the surrounding sections (Development, License) intact.

## Acceptance criteria

- [ ] README no longer instructs the user to manually tag and push
- [ ] README documents pushing releasable commits to `main` and semantic-release
      handling versioning/tagging/building/uploading
- [ ] README states the shim downloads the version-pinned bundle matching
      `package.json`, with the `latest` fallback
- [ ] `npm test` is green (docs-only change)

## Files

- `/Users/pmelab/Code/gtd/gtd/README.md`
