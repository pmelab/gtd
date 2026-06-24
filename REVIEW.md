# Review: 63bd914

<!-- base: 63bd914789cc719bb64d275729c8320e932d0e96 -->

## Add semantic-release deps and config

Installs `semantic-release`, `@semantic-release/git`,
`@semantic-release/github`, and `@semantic-release/exec` as dev deps. The
`.releaserc.json` configures the full release pipeline: commit-analyzer
determines the next version, exec runs `npm version --no-git-tag-version` +
`npm run build`, git commits the bumped `package.json` back to main with
`[skip ci]`, and github creates the release with `dist/gtd.bundle.mjs` attached
as `gtd.bundle.mjs`. No `@semantic-release/npm` since this package is not
published to a registry.

- [ ] ./.releaserc.json#1

## Rewrite release workflow for semantic-release

Trigger changes from `tags: v*` to `branches: main`. Adds `fetch-depth: 0` to
the checkout (semantic-release needs full history and all tags to compute the
next version). Drops the manual `npm run build` + `gh release create` steps in
favour of `npx semantic-release`. Env var renamed from `GH_TOKEN` to
`GITHUB_TOKEN` to match what the GitHub plugin expects.

- [ ] ./.github/workflows/release.yml#2
- [ ] ./.github/workflows/release.yml#16

## Pin shim download URL to package.json version

The shim now reads `../package.json` at runtime, extracts `version`, and
constructs a pinned URL `releases/download/v${version}/gtd.bundle.mjs`. Falls
back to `releases/latest/download/...` only when the version is the
`0.0.0-development` placeholder. The existing `existsSync` short-circuit and
error-path messages are preserved.

- [ ] ./scripts/gtd.js#1
- [ ] ./scripts/gtd.js#8

## Update README for semantic-release flow

Replaces the old "Tag `vX.Y.Z` and push" manual instructions with the automatic
flow: push releasable Conventional Commits to `main`, the Release workflow runs
`npx semantic-release` which bumps `package.json`, builds, commits, tags, and
uploads the asset. Updates the shim description to mention version-pinned
downloads with `0.0.0-development` fallback.

- [ ] ./README.md#505
