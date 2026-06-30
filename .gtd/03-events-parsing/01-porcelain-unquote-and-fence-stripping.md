# Git porcelain unquoting & code-fence stripping (Group C)

Fix two parsing bugs in `src/Events.ts` (#11, #12). Both edit the same source
file (different functions) and both affect steering/marker detection, so they
are one task.

## Files

- `src/Events.ts` (only source file — `parsePorcelainPaths` ~line 53,
  `stripCode` ~line 69)
- `tests/integration/features/grilling.feature` and/or a new
  `tests/integration/features/events-parsing.feature` (the marker-detection
  behavior is most naturally exercised through the Grilling state)
- `tests/integration/support/steps/*.ts` (reuse existing steps; add generic ones
  only if needed)
- `README.md` (if any documented behavior changes — likely minimal)

## Bugs to fix

### #11 — quoted git paths misclassify steering vs code

- Location: `src/Events.ts:46-52` (the `parsePorcelainPaths` map does raw
  `line.slice(3)`).
- Git C-quotes porcelain paths that contain non-ASCII / space / special chars:
  the path field is wrapped in `"` with backslash escapes (`\n`, `\t`, `\"`,
  `\\`, and octal `\NNN` bytes that must be reassembled and UTF-8 decoded).
- Without unquoting, a `TODO.md`-with-a-space path or a unicode steering
  filename is mis-parsed, so `isGtdPath` / `isSteeringFile`
  (`src/Events.ts:237-238`) misclassify it as code, flipping `codeDirty`.
- Add an unquote step: if the path field starts with `"`, strip the surrounding
  quotes and decode the C-escapes (collect octal-escape bytes into a buffer and
  UTF-8 decode them so multi-byte unicode is reconstructed correctly). Otherwise
  use the raw field.
- After unquoting, `isGtdPath` / `isSteeringFile` must match correctly.

### #12 — unclosed code fence fails to strip the open-question marker

- Location: `src/Events.ts:63` (`stripCode`). The current fence regex
  `^(`{3,}|~{3,})[^\n]_\n[\s\S]_?\n\1[^\n]*` requires a matching **closing**
  fence, so a marker inside an *unclosed\* fence (running to EOF) is NOT
  stripped.
- Consumed at `Machine.ts:486` via `todoMarkerPresent` (`src/Events.ts:256`): an
  unstripped marker inside an unclosed fence falsely trips the open-question
  STOP.
- Make the fence regex also match an unterminated fence that runs to
  end-of-string: alternate the terminator between a matching closing fence and
  EOF (e.g. `(?:\n\1[^\n]*|$)`).
- Verify inline-code stripping (the `` `...` `` replace) still works and that a
  _closed_ fence still strips correctly.

## Constraints / edge cases

- Do not regress the existing grilling scenarios: an open marker outside any
  fence must still STOP; a marker inside a _closed_ fenced code block must still
  be ignored.
- C-unquoting must be limited to fields that actually start with `"` — plain
  ASCII paths (the common case) must be untouched.
- Octal escapes for multi-byte UTF-8 must be reassembled at the byte level
  before decoding (decoding each `\NNN` independently produces mojibake).
- Keep `parsePorcelainPaths` returning the same `{ status, path }` shape.

## Cucumber scenarios

Per AGENTS.md: composable generic `Given` steps, real file content/paths in the
scenario text, one commit per setup step. Reuse
`Given a commit {string} that adds {string} with:`,
`Given a file {string} with:`, `When I run gtd`, etc. The file-with-space and
unicode-filename setup may require a generic step that accepts an arbitrary path
string — check `common.steps.ts` first; the existing `a file {string} with:`
step likely already accepts any path.

For #11 (porcelain unquoting) — exercise via the Grilling/steering path so the
classification is observable through gtd's state:

- A steering file whose name contains a **space** (e.g. a TODO-area file
  `"my notes.md"` under `.gtd/` or a steering path) is correctly classified as
  steering, not code — assert gtd resolves to the steering-driven outcome (not a
  code-dirty / build outcome).
- A steering file with a **unicode** name (e.g. `café.md` in a steering
  location) is classified correctly. (Pick paths/states that make the
  steering-vs-code distinction observable in stdout / the resulting commit
  subject; mirror how `grilling.feature` asserts on `the last commit subject`
  and stdout task headers.)

For #12 (unclosed fence) — add to `grilling.feature`:

- A `TODO.md` containing the `<!-- user answers here -->` marker **inside an
  unclosed code fence** (no closing ``` before EOF) must NOT trip the
  open-question STOP — gtd treats the marker as stripped (converges / iterates
  instead of stopping). Show the fenced content verbatim in the scenario.
- Regression: a marker inside a properly **closed** fence is still ignored
  (already implied by existing behavior — add an explicit scenario if not
  covered).

## Acceptance criteria

- [ ] `parsePorcelainPaths` C-unquotes quoted path fields (space, special chars,
      octal/UTF-8 multibyte) and leaves plain paths untouched
- [ ] A space-containing steering path is classified as steering, not code
- [ ] A unicode-named steering path is classified correctly
- [ ] `stripCode` strips a marker inside an unclosed (EOF-terminated) fence
- [ ] `stripCode` still strips closed fences and inline code spans
- [ ] New cucumber scenarios cover quoted/unicode paths and the unclosed-fence
      marker case
- [ ] Existing grilling/review/illegal-combination scenarios still pass
- [ ] README updated if any documented behavior changed
- [ ] Full test suite is green
