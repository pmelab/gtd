# Create `.releaserc.json` semantic-release config

Create a new `.releaserc.json` at the repo root configuring semantic-release to
release from `main`, write the next version into `package.json`, build the
bundle, commit the bumped `package.json` back, and create a GitHub release with
the bundle attached.

Exact contents:

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

Rationale:

- `@semantic-release/exec` `prepareCmd` writes the version into `package.json`
  (the shim reads this at runtime) and then builds the bundle.
- `@semantic-release/git` commits the bumped `package.json` back to `main`;
  `[skip ci]` prevents re-triggering CI.
- `successComment: false` / `failComment: false` keeps the workflow needing only
  `contents: write`.

This file is brand new — it is file-disjoint from the dependency install task
(`package.json` / `package-lock.json`), so the two run in parallel.

## Acceptance criteria

- [ ] `/Users/pmelab/Code/gtd/gtd/.releaserc.json` exists with the contents above
- [ ] Valid JSON (parses cleanly)
- [ ] `branches` is `["main"]`
- [ ] Plugin array order is exec → git → github after the two analyzer plugins
- [ ] `npm test` is green (config file alone changes no behavior)

## Files

- `/Users/pmelab/Code/gtd/gtd/.releaserc.json` (new)
