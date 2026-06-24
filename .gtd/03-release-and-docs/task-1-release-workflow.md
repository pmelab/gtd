# Task: Add CI release workflow that builds and uploads the bundle

## Description

Create `.github/workflows/release.yml`. On `v*` tags it must run the test suite,
build `dist/gtd.bundle.mjs`, and publish a GitHub release with the bundle
attached as the asset the launcher shim downloads.

Requirements:

- `on: push: tags: ["v*"]`.
- Reuse the existing `Test` workflow (`.github/workflows/test.yml` already
  declares `workflow_call:`) as a gating job via `uses: ./.github/workflows/test.yml`.
- A `release` job that `needs:` the test job, with `permissions: contents: write`
  (required for `gh release create`).
- Release job steps:
  - `actions/checkout@v4`
  - `actions/setup-node@v4` with `node-version: "20"`
  - `npm install`
  - `npm run build` (produces `dist/gtd.bundle.mjs`)
  - `gh release create "$GITHUB_REF_NAME" dist/gtd.bundle.mjs ...` — the uploaded
    asset filename MUST be `gtd.bundle.mjs` (matching the shim's
    `releases/latest/download/gtd.bundle.mjs` URL). If `gh` would otherwise name
    the asset by its full path, use the `dist/gtd.bundle.mjs#gtd.bundle.mjs`
    label syntax or upload from a path whose basename is `gtd.bundle.mjs`
    (it already is). Set `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` in the env for
    the `gh` step.
- Keep the existing `test.yml` untouched.

> The first release tag must be created manually to bootstrap
> (`git tag v0.1.0 && git push --tags`); the workflow only triggers on `v*`
> tags. This is operational, not part of this task.

## Acceptance criteria

- [ ] `.github/workflows/release.yml` exists and is valid YAML.
- [ ] Triggers on `v*` tag pushes.
- [ ] Calls the reusable `Test` workflow via `uses: ./.github/workflows/test.yml`.
- [ ] `release` job has `permissions: contents: write` and `needs:` the test job.
- [ ] Builds the bundle then runs `gh release create` uploading
      `dist/gtd.bundle.mjs` as asset `gtd.bundle.mjs`, with `GH_TOKEN` set.
- [ ] `npm test` (vitest) passes (unaffected).

## Files

- `/Users/pmelab/Code/gtd/gtd/.github/workflows/release.yml` (new)
