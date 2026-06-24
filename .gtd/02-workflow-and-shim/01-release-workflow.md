# Rewrite the release workflow to use semantic-release

Replace the contents of `.github/workflows/release.yml`. The current workflow
triggers on `tags: v*` and manually builds + creates a release via `gh release
create`. The new workflow triggers on pushes to `main` and delegates everything
to semantic-release.

Exact new contents:

```yaml
name: Release

on:
  push:
    branches:
      - main

jobs:
  test:
    uses: ./.github/workflows/test.yml

  release:
    needs: test
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # semantic-release needs full history + tags
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install
      - run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Key changes:

- Trigger: `tags: v*` → `branches: main`.
- Add `fetch-depth: 0` to the checkout (semantic-release inspects full history
  and tags).
- Drop the separate `npm run build` and `gh release create` steps —
  `npm run build` now runs inside `.releaserc.json`'s `prepareCmd`.
- Keep `contents: write` only; reuse `test.yml` via `workflow_call`.
- The env var is `GITHUB_TOKEN` (was `GH_TOKEN`).

Depends on package 01 (semantic-release must be installed) and on
`.releaserc.json` existing.

## Acceptance criteria

- [ ] `.github/workflows/release.yml` triggers on `push` to `branches: main`
- [ ] checkout step sets `fetch-depth: 0`
- [ ] the release step runs `npx semantic-release` with `GITHUB_TOKEN` in env
- [ ] no `gh release create` and no standalone `npm run build` step remain
- [ ] `permissions` is `contents: write` only
- [ ] `npm test` is green

## Files

- `/Users/pmelab/Code/gtd/gtd/.github/workflows/release.yml`
