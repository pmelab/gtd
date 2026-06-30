# `format` command error handling & input validation (Group B)

Fix three related `format`-command bugs (#18, #19, #20). They touch
`src/main.ts` and `src/Format.ts` and share `formatting.feature`, so they are
one task.

## Files

- `src/main.ts` (the `format` subcommand dispatch, lines ~41-49)
- `src/Format.ts` (`formatFile` / `formatString`)
- `tests/integration/features/formatting.feature` (extend)
- `tests/integration/support/steps/formatting.steps.ts` (add steps only if a
  reusable one is missing)
- `README.md` (document non-md rejection, extra-arg rejection, nonzero exit)

## Bugs to fix

### #18 — `format` exits 0 on usage / IO errors

- Locations: `src/main.ts:43-48` (missing path argument returns void = exit 0)
  and `src/Format.ts:22-26` + the `Effect.catchAll` at `Format.ts:33-39` (a
  nonexistent file writes to stderr but returns void = exit 0).
- Make both **fail the Effect** (`Effect.fail(new Error(...))`) so the `main.ts`
  `catchAll` (lines 95-100) routes the message to stderr and exits 1.
- Note: this changes the existing "format subcommand skips missing files
  gracefully" scenario semantics (it currently asserts exit 0). Update that
  scenario to expect failure / exit 1 with the message on stderr, OR replace it.

### #19 — `format` silently corrupts non-markdown files

- Location: `src/Format.ts:5-9,17` — `parser: "markdown"` is applied
  unconditionally, so a `.ts` / `.json` file passed to `format` is reflowed as
  prose and corrupted.
- gtd only ever formats markdown (TODO.md / steering files). Restrict accepted
  input to `.md` / `.markdown` (case-insensitive) — reject any other extension
  with an error that fails the Effect (→ stderr, exit 1).
- Put the extension check where the path is known (either in `main.ts` before
  calling `formatFile`, or at the top of `formatFile`); keep `formatString`
  pure/parser-fixed.

### #20 — `format` extra trailing args silently ignored

- Location: `src/main.ts:41-48` reads only `process.argv[3]`.
- gtd only ever formats one file. Reject when **more than one** path argument is
  given: fail with a usage error (→ stderr, exit 1), consistent with #18.

## Constraints / edge cases

- Keep the single-file happy path working: the existing "format subcommand wraps
  long lines in place" scenario (`format TODO.md` → exit 0, stdout empty, lines
  wrapped) must still pass.
- All error paths must go through `main.ts`'s `catchAll` so the message is on
  **stderr** and the exit code is 1 — do not `process.exit` directly from
  `Format.ts`.
- `formatString` stays markdown-only and pure; the gating is about which paths
  are allowed to reach it.
- Do not break the pre-commit-hook formatting scenarios (they exercise the hook,
  not the subcommand, but live in the same feature file).

## Cucumber scenarios (add to / update in `formatting.feature`)

Per AGENTS.md: composable generic `Given` steps, real content in scenario text.
Reuse `Given a file {string} with:`, `When I run gtd with args {string}`,
`Then the exit code is {int}`, `Then stderr contains {string}`,
`Then stdout is empty`.

- Missing path arg: `When I run gtd with args "format"` → exit code 1, stderr
  names the missing-path usage error (#18).
- Nonexistent file: update the existing "skips missing files gracefully"
  scenario — `format does-not-exist.md` now → exit code 1 + stderr message
  (#18).
- Non-markdown file rejected: create a `notes.txt` (or `src/x.ts`) with content,
  `format notes.txt` → exit code 1 + stderr says the extension is not markdown,
  and the file content is unchanged (#19). Add a
  `Then the file {string} contains {string}` assertion (step exists) to prove no
  corruption.
- Extra args rejected: `format TODO.md extra.md` → exit code 1 + stderr usage
  error (#20), and TODO.md left unformatted/unchanged.
- A `.markdown` file is accepted (happy path for the allowed alternate
  extension): wraps in place, exit 0.

## Acceptance criteria

- [ ] Missing path arg fails the Effect → stderr + exit 1
- [ ] Nonexistent file fails the Effect → stderr + exit 1 (existing scenario
      updated accordingly)
- [ ] Non-`.md`/`.markdown` input rejected with a clear error → stderr + exit 1,
      file left unmodified
- [ ] `.md` and `.markdown` inputs accepted and formatted in place
- [ ] More than one path argument rejected with a usage error → stderr + exit 1
- [ ] Single-file happy path (`format TODO.md`) still exits 0, stdout empty,
      lines wrapped
- [ ] New/updated cucumber scenarios in `formatting.feature` for each bug
- [ ] Pre-commit-hook formatting scenarios still pass
- [ ] README updated (non-md rejection, extra-arg rejection, nonzero-exit
      semantics)
- [ ] Full test suite is green
