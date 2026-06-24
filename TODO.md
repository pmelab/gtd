---
status: complete
---

# Automated releases with semantic-release + version-pinned shim

Use semantic-release to automatically cut a versioned GitHub release on every
push to `main` that contains releasable commits (`fix:`, `feat:`, or breaking
changes). Update the launcher shim to download the pinned release matching its
own `package.json` version instead of `latest`.

## What needs to happen

### 1. Install semantic-release and plugins

Add dev dependencies:

- `semantic-release` — core
- `@semantic-release/commit-analyzer` +
  `@semantic-release/release-notes-generator` (bundled with core, but list
  explicitly since we customize the plugin array)
- `@semantic-release/git` — commits the bumped `package.json` back to `main`
- `@semantic-release/github` — creates the GH release and uploads assets
- `@semantic-release/exec` — runs `npm run build` and bumps the version in
  `package.json` during `prepare`

No `@semantic-release/npm` — see Resolved Q2; we are not publishing to npm and
do not want `@semantic-release/npm`'s side effects (lockfile updates, npm auth
checks). `@semantic-release/exec` writes the version instead.

### 2. Configure semantic-release (`.releaserc.json`)

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/exec",
      {
        "prepareCmd": "npm version ${nextRelease.version} --no-git-tag-version --allow-same-version && npm run build"
      }
    ],
    [
      "@semantic-release/git",
      {
        "assets": ["package.json"],
        "message": "chore(release): ${nextRelease.version} [skip ci]"
      }
    ],
    [
      "@semantic-release/github",
      {
        "assets": [{ "path": "dist/gtd.bundle.mjs", "name": "gtd.bundle.mjs" }],
        "successComment": false,
        "failComment": false
      }
    ]
  ]
}
```

Notes:

- `prepareCmd` writes the next version into `package.json`
  (`npm version --no-git-tag-version`), then builds. The shim reads this version
  at runtime, so the committed `package.json` must carry the released version.
- `@semantic-release/git` commits the bumped `package.json` back to `main`. The
  `[skip ci]` suffix is belt-and-suspenders (see Resolved Q1/Q6).
- `successComment: false` / `failComment: false` disables issue/PR comments so
  `issues: write` and `pull-requests: write` are not needed (see Resolved Q5).
- The release tag is `v${version}` by default (semantic-release's default
  `tagFormat`), which matches the shim's pinned URL.

### 3. Replace the manual release workflow with semantic-release

Rewrite `.github/workflows/release.yml`:

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

- Trigger changes from `tags: v*` to `branches: main`.
- `fetch-depth: 0` is required — semantic-release inspects full git history and
  all tags to compute the next version.
- Only `contents: write` permission needed (Resolved Q5).
- `npm run build` runs inside `prepareCmd`, not as a separate step.
- Keep `test.yml` as-is; reuse it via `workflow_call`.

### 4. Update the shim to use a pinned version URL

Change `scripts/gtd.js` to read `package.json` version at runtime and construct
a pinned download URL. The shim is at `scripts/gtd.js`, sibling to the bundle it
manages (`scripts/gtd.bundle.mjs`); `package.json` is one level up.

```js
import { readFileSync } from "node:fs"
// ...
const pkg = JSON.parse(readFileSync(join(dir, "../package.json"), "utf8"))
const version = pkg.version
const downloadUrl =
  version && version !== "0.0.0-development"
    ? `https://github.com/pmelab/gtd/releases/download/v${version}/gtd.bundle.mjs`
    : "https://github.com/pmelab/gtd/releases/latest/download/gtd.bundle.mjs"
```

- Fall back to `latest` when version is `0.0.0-development` (Resolved Q3).
- Keep the existing `existsSync` guard: a locally built `scripts/gtd.bundle.mjs`
  (via `postbuild`) short-circuits any download, so dev workflows are unaffected
  regardless of the pinned URL.

### 5. Bootstrap the first release

`git tag -l` and `gh release list` are both empty — no tags, no releases exist.

- semantic-release defaults the first release to `v1.0.0` when no prior tag is
  found (Resolved Q4). It does NOT need a seed tag.
- This jumps `0.1.0` → `1.0.0`. If a `0.x` pre-1.0 line is desired instead, a
  seed tag (e.g. `git tag v0.1.0 <commit> && git push --tags`) anchors
  semantic-release to bump from `0.1.0`. Default behavior (jump to `1.0.0`) is
  acceptable for this tool and requires no manual step.
- The first merged PR with a `fix:`/`feat:` commit cuts the first release.

### 6. Update README

Document the new release flow: push releasable commits to `main`,
semantic-release handles versioning, tagging, building, and uploading the bundle
asset. Remove any manual `git tag vX.Y.Z && git push --tags` note. Note that the
shim downloads the version-pinned bundle matching its bundled `package.json`.

## Resolved

**Q1 / Q6 — chore(release) commit loop:** GitHub Actions does not create new
workflow runs from events (including pushes) made with the default
`GITHUB_TOKEN`. So the `chore(release):` push from `@semantic-release/git` will
not re-trigger the Release workflow — no infinite loop. The `[skip ci]` suffix
in the commit message is added as defense-in-depth in case the workflow is ever
moved to a PAT/deploy key.

**Q2 — npm plugin vs version bump:** `@semantic-release/npm` exists to publish
to a registry; with `npmPublish: false` it still runs npm-specific logic
(lockfile/auth handling) we don't want for a non-published package. Using
`@semantic-release/exec` `prepareCmd` with `npm version --no-git-tag-version` to
write the version, paired with `@semantic-release/git` to commit it, is the
cleaner fit. Dropped `@semantic-release/npm` entirely.

**Q3 — shim sentinel:** `0.0.0-development` is the conventional semantic-release
placeholder, but in this repo `package.json` currently holds `0.1.0` and after
the first release will hold a real version, so the live fallback is rarely hit.
The `existsSync` guard already covers local dev (a built bundle is used as-is).
Checking `version !== "0.0.0-development"` is sufficient and simpler than
probing the GH API for release existence; if the pinned URL 404s, the existing
error path already tells the user to run `npm run build`.

**Q4 — first bootstrap:** No tags exist. semantic-release computes the first
release as `v1.0.0` from scratch; no seed tag required. Accepting the `1.0.0`
jump; documented the seed-tag alternative for staying on `0.x`.

**Q5 — issues:write permission:** Not needed. `@semantic-release/github`
requires only `contents: write` to publish a release; `issues: write` /
`pull-requests: write` are only for its success/fail comment feature. Disabling
`successComment`/`failComment` keeps the workflow at `contents: write` alone.
