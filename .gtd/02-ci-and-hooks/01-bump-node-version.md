# Bump Node to 22 (test workflow + package.json engines)

## Description

`.github/workflows/test.yml` pins Node `20`, but the dependency tree
(`semantic-release`) requires `^22.14.0 || >= 24.10.0`, producing an engine
warning during `npm install`. `release.yml` already runs Node `22`. Align the
test workflow on `22` and raise the `engines` floor to `>=22` to match.

## Steps

1. In `.github/workflows/test.yml`, change the `actions/setup-node` step's
   `node-version` from `"20"` to `"22"`.
2. In `package.json`, change `"engines": { "node": ">=20" }` to
   `"engines": { "node": ">=22" }`.

## Acceptance criteria

- [ ] `test.yml` `setup-node` uses `node-version: "22"`
- [ ] `package.json` `engines.node` is `>=22`
- [ ] No engine warning on `npm install` under Node 22
- [ ] `npm test` passes locally

## Relevant file paths

- `.github/workflows/test.yml`
- `package.json` (only the `engines` field)

## Constraints

- Do NOT touch `scripts`, `devDependencies`, or `lint-staged` in `package.json`
  — those belong to task `02-add-precommit-hook.md` (runs in parallel; keep
  edits file-region-disjoint to `engines`).
- Leave all changes uncommitted.
