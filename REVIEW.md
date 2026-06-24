# Review: 2668212

<!-- base: 26682125aa4cc4f3bce7e45fee392d44be69841a -->

## Move build output to dist/

tsup now outputs `dist/gtd.bundle.mjs` instead of `scripts/gtd.js`. The entry
key is renamed to `gtd.bundle` and `outExtension` forces `.mjs` (needed because
`package.json` has `"type": "module"` which would otherwise produce `.js`). A
`postbuild` script copies the bundle to `scripts/gtd.bundle.mjs` for local dev,
and `pretest:e2e` triggers a build before cucumber runs so the shim has a bundle
without hitting the network.

- [ ] ./tsup.config.ts#1
- [ ] ./package.json#15

## Replace 18 MB bundle with launcher shim

`scripts/gtd.js` was the committed 18.5 MB built artifact. It is now a ~35-line
dependency-free ESM shim that resolves the real bundle at
`scripts/gtd.bundle.mjs` (via `import.meta.dirname`), downloads it from
`https://github.com/pmelab/gtd/releases/latest/download/gtd.bundle.mjs` on first
use (atomic write + chmod), and delegates via dynamic `import()`. Offline once
the bundle is present; exits with a clear fallback message on network failure.
The path stays `scripts/gtd.js` so SKILL.md and all bundled prompts need no
edits.

- [ ] ./scripts/gtd.js#1

## Tooling hygiene: track bundle not shim

`.gitignore` adds `scripts/gtd.bundle.mjs` and its `.tmp` staging path.
`.prettierignore` and `.gitattributes` move their entries from `scripts/gtd.js`
(now a hand-written shim that should be formatted and diffed) to
`scripts/gtd.bundle.mjs` (the generated artifact).

- [ ] ./.gitignore#41
- [ ] ./.prettierignore#1
- [ ] ./.gitattributes#1

## Add CI release workflow

`.github/workflows/release.yml` triggers on `v*` tags, gates behind the reusable
`Test` workflow, then builds `dist/gtd.bundle.mjs` and creates a GitHub release
uploading it as `gtd.bundle.mjs` — the exact asset name the shim's download URL
resolves to. Requires `permissions: contents: write` for `gh release create`.

- [ ] ./.github/workflows/release.yml#1

## Update README for new flow

The Development section is updated: build comment now references
`dist/gtd.bundle.mjs`, the stale "tsup wipes `scripts/`" sentence is corrected
to `dist/`, and the old "scripts/gtd.js is committed to the repo" paragraph is
replaced with the shim + auto-download story. A new "Releasing" note documents
tagging and the CI flow.

- [ ] ./README.md#490
- [ ] ./README.md#502
