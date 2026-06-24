# Pin the shim download URL to its bundled package.json version

Edit `scripts/gtd.js` so that, when the bundle must be downloaded, it fetches
the release matching its own `package.json` version instead of always pulling
`latest`. Fall back to `latest` only when the version is the
`0.0.0-development` placeholder.

The shim lives at `scripts/gtd.js`; `package.json` is one level up
(`../package.json` relative to `import.meta.dirname`).

Implementation:

- Add `readFileSync` to the `node:fs` import.
- Read and parse `../package.json`, extract `version`.
- Construct the download URL:

```js
const pkg = JSON.parse(readFileSync(join(dir, "../package.json"), "utf8"))
const version = pkg.version
const downloadUrl =
  version && version !== "0.0.0-development"
    ? `https://github.com/pmelab/gtd/releases/download/v${version}/gtd.bundle.mjs`
    : "https://github.com/pmelab/gtd/releases/latest/download/gtd.bundle.mjs"
```

Keep the existing `existsSync(bundlePath)` guard untouched: a locally built
`scripts/gtd.bundle.mjs` short-circuits the download entirely, so dev workflows
are unaffected. Keep the existing error-path messages.

File-disjoint from the workflow task (`scripts/gtd.js` vs
`.github/workflows/release.yml`).

## Acceptance criteria

- [ ] `scripts/gtd.js` imports `readFileSync` from `node:fs`
- [ ] it reads `../package.json` and uses its `version`
- [ ] download URL is the pinned `releases/download/v${version}/...` form when
      version is set and not `0.0.0-development`
- [ ] download URL falls back to `releases/latest/download/...` when version is
      `0.0.0-development`
- [ ] the `existsSync` short-circuit and error messages are preserved
- [ ] `npm test` is green

## Files

- `/Users/pmelab/Code/gtd/gtd/scripts/gtd.js`
