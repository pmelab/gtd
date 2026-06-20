# Task: Create Format module

Create `src/Format.ts` that exports a `formatFile(path: string)` Effect using
`FileSystem` from `@effect/platform` and bundled prettier.

## Behaviour

- Read file at `path` via `FileSystem.FileSystem`.
- If the file does not exist, write
  `gtd: skipped formatting <path>: not found\n` to stderr and succeed (exit 0
  semantics).
- Call
  `prettier.format(content, { parser: "markdown", printWidth: 80, proseWrap: "always" })`.
  Config is a hard-coded literal in this module — do **not** call
  `prettier.resolveConfig` (host `.prettierrc` is intentionally ignored).
- Write the formatted output back only if it differs from the original (avoid
  mtime churn).
- Wrap the whole effect in `Effect.catchAll` that writes
  `gtd: skipped formatting <path>: <message>\n` to stderr and succeeds.
  Formatting is best-effort.

## Imports

- `import prettier from "prettier"` (programmatic API).
- `FileSystem` import path must match `src/State.ts`.

## Acceptance criteria

- [ ] `src/Format.ts` exists and exports `formatFile`.
- [ ] Reads via `@effect/platform` `FileSystem`.
- [ ] Hard-coded prettier config object literal
      `{ parser: "markdown", printWidth: 80, proseWrap: "always" }`.
- [ ] Missing file path: stderr warning, success.
- [ ] Prettier throws: stderr warning, success (exit 0).
- [ ] Skips write when output equals input.
- [ ] Typechecks: `npm run typecheck` passes.

## Files

- `src/Format.ts` (new)
