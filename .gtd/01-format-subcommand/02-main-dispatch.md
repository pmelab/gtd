# Task: Wire `format` subcommand into main.ts

Add subcommand dispatch at the top of `program` in `src/main.ts`.

## Behaviour

- If `process.argv[2] === "format"`, treat `process.argv[3]` as the file path,
  run `Format.formatFile(path)`, and exit. Do **not** call `detect` or
  `buildPrompt` in this mode.
- Otherwise, keep the current behaviour exactly: `process.argv[2]` is the
  optional ref passed to `detect`.
- Keep the existing `Effect.provide(GitService.Live)` and
  `Effect.provide(NodeContext.layer)` plumbing — both paths need `FileSystem`
  from `NodeContext.layer`.
- Implement via a small switch / `if` on `process.argv[2]` inside `program`.

## Acceptance criteria

- [ ] `node scripts/gtd.js format <path>` invokes the formatter and exits 0.
- [ ] Existing usage (`node scripts/gtd.js`, `node scripts/gtd.js <ref>`) is
      unchanged.
- [ ] `format` with no path argument logs a stderr warning and exits 0
      (best-effort).
- [ ] Typechecks pass.

## Files

- `src/main.ts` (edit)
