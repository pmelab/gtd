# Task: Replace scripts/gtd.js (18.5 MB bundle) with a tiny launcher shim

## Description

`scripts/gtd.js` is currently an 18.5 MB committed bundle. Replace its entire
contents with a small (~30 line), dependency-free Node ESM launcher shim. This
is the entrypoint that the skill, SKILL.md, and all bundled prompts already
invoke (`node scripts/gtd.js [...]`), so the path MUST stay `scripts/gtd.js` and
the shim MUST forward argv (including the `format <file>` subcommand), env, and
cwd unchanged.

The shim must:

- Resolve paths relative to its own dir via `import.meta.dirname` (Node 20+),
  never `process.cwd()`.
- Locate the real bundle at `scripts/gtd.bundle.mjs` (sibling, gitignored).
- If the bundle is absent: download it via built-in `fetch` from
  `https://github.com/pmelab/gtd/releases/latest/download/gtd.bundle.mjs`, write
  atomically to `scripts/gtd.bundle.mjs.tmp` then rename to
  `scripts/gtd.bundle.mjs`, and `chmod 0o755` it.
- On download failure (network error or non-OK HTTP status): write a clear
  stderr message including the manual fallback URL above AND the
  `npm run build` instruction, then `process.exit(1)`.
- After ensuring the bundle exists, dynamically `import()` it
  (`import(pathToFileURL(bundlePath).href)`), so argv/env/cwd flow through
  unchanged. The bundle is a normal ESM entry that reads `process.argv`.
- Work fully offline once the bundle is present (no fetch when the file exists).

Implementation notes:

- Use only Node built-ins: `node:fs`, `node:fs/promises`, `node:path`,
  `node:url`. No npm dependencies.
- Keep it readable and prettier-formattable — this file is now hand-written and
  WILL be formatted/diffed (it is removed from `.prettierignore`/`.gitattributes`
  by the sibling tasks).
- Replace the file completely (use Write, not Edit — the current content is an
  18.5 MB minified bundle).

Do NOT edit `.gitignore`, `.prettierignore`, or `.gitattributes` here — sibling
tasks own those.

## Acceptance criteria

- [ ] `scripts/gtd.js` is a small (<2 KB) hand-written ESM launcher shim, no npm
      deps.
- [ ] Uses `import.meta.dirname` to resolve `scripts/gtd.bundle.mjs`.
- [ ] Downloads from
      `https://github.com/pmelab/gtd/releases/latest/download/gtd.bundle.mjs`
      via `fetch`, writes to `scripts/gtd.bundle.mjs.tmp`, then renames + chmods.
- [ ] Imports the existing bundle without a network call when present.
- [ ] Download failure prints fallback URL + `npm run build` hint to stderr and
      exits non-zero.
- [ ] After `npm run build` (which leaves `scripts/gtd.bundle.mjs` present),
      `node scripts/gtd.js` and `node scripts/gtd.js format <file>` work offline.
- [ ] `npm test` (vitest) passes.

## Files

- `/Users/pmelab/Code/gtd/gtd/scripts/gtd.js` (full rewrite)
