# Task: Move tsup build output to `dist/gtd.bundle.mjs`

## Description

Change the tsup build so it no longer writes the bundle into `scripts/` (where
`clean: true` would wipe the committed launcher shim). The bundle must build to
`dist/gtd.bundle.mjs` instead.

- Set `outDir` to `dist`.
- Change `entry` from `{ gtd: "src/main.ts" }` to
  `{ "gtd.bundle": "src/main.ts" }` so the output filename is `gtd.bundle.mjs`.
- Keep `format: ["esm"]`, `platform`, `target`, `noExternal`, `splitting`,
  `loader`, and the shebang `banner` exactly as-is.
- Keep `clean: true` — it now only wipes `dist/` (already gitignored), which is
  safe.

`dist/` is already in `.gitignore`, so the build artifact stays untracked.

## Acceptance criteria

- [ ] `tsup.config.ts` has `outDir: "dist"`.
- [ ] `entry` is `{ "gtd.bundle": "src/main.ts" }`.
- [ ] Shebang `banner` and all other options are unchanged.
- [ ] `npm run build` produces `dist/gtd.bundle.mjs` with the shebang on line 1.
- [ ] `npm test` (vitest) passes.

## Files

- `/Users/pmelab/Code/gtd/gtd/tsup.config.ts`
