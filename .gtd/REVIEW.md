# Review: 9b576e8

<!-- base: 3ed769aaa947bcc3594f03343939b57832b15818 -->

Review checkbox ticks no longer survive a land. A new `gtd uncheck <file>`
command resets every `- [x]` file pointer in `.gtd/REVIEW.md` back to `- [ ]`,
the landing script at the human review gate runs it ahead of the commit, and
`build.review.deciding`'s sign-off-vs-feedback test drops its `[ ]`/`[x]`
normalization for a plain byte comparison.

## The `gtd uncheck <file>` command

A sixth standalone command: no workflow state, no config, `fs` only, runnable
from any directory. Missing file writes nothing, exits 0. Takes no `<mode>` — a
second positional is rejected as "too many arguments" so it can never be pointed
at qa-mode's answer boxes.

- [ ] ./src/Cli.ts#447 — the `uncheck` command row and its help text;
      `parseArgv` branch at #948 pulls the single positional
- [ ] ./src/program.ts#879 — `runUncheckCommand`: read, clear, write back only
      when the bytes actually changed, so an untouched file's mtime never moves
- [ ] ./src/program.ts#1132 — `standaloneKinds` grows from five to six, and
      `needsOf` returns `"fs"`
- [ ] ./docs/cli.md#87 — the pinned `## Commands` block, generated-equal to
      rendered help
- [ ] ./src/Cli.test.ts#491 — arity and scope cases, including "takes no mode
      argument"
- [ ] ./src/program.test.ts#1471 — behavior cases; the no-write case spies on
      `writeFile` to prove the unchanged path never writes
- [ ] ./tests/integration/features/command-surface.feature#167 — four end-to-end
      scenarios plus the `--json` rejection row

## `clearFilePointerTicks` and its regex

The tick-clearing primitive. A single anchored `gm` replace over the whole
document, deliberately not `split`/`join` — a split/join normalizes CRLF and
would turn a tick-only round into a whole-file diff on a CRLF checkout.

- [ ] ./src/ReviewDoc.ts#70 — `FILE_POINTER_TICK_RE`. Worth the closest read of
      the change: it mirrors `FILE_POINTER_RE` by lookahead but must use `[ \t]`
      and never `\s`, because in a `gm` pattern over the whole document `\s`
      matches `\n` and would let the token search cross onto a later line. Check
      the mirroring is exact — this regex and `FILE_POINTER_RE` are two
      hand-maintained copies of one shape, with no test pinning them equal to
      each other.
- [ ] ./src/ReviewDoc.ts#359 — `clearFilePointerTicks` itself: total,
      idempotent, line-wise so a structurally broken doc still gets cleared
- [ ] ./src/ReviewDoc.test.ts#1099 — 13 cases: `[X]` as well as `[x]`, indented
      pointer-shaped lines left alone, prose/heading/note `[x]` left alone, box
      with no token left alone, CRLF preserved, no trailing newline added,
      idempotence

**Gap:** the tests pin what the regex must not touch inside a well-formed doc,
but nothing covers a human note that itself opens with `- [x] ./something` at
column 0. That line gets silently rewritten as if it were a pointer. Low impact,
no test.

## Emitting the reset into the landing script

`renderDecision` prepends one `gtd uncheck '<file>'` step before `git add -A`.
The gate predicate is extracted so the guard and the emitted step share one
definition and cannot drift.

- [ ] ./src/StepGuards.ts#69 — `isHumanReviewGate` extracted and exported;
      `reviewDocGuard.appliesTo` now points at it
- [ ] ./src/Edge.ts#936 — the prepended step, emitted unconditionally at the
      gate (not only when a tick exists), and deliberately not wrapped in
      `fileExistsGuard` because that guard's `|| exit 0` would kill the whole
      script and skip the commit
- [ ] ./src/Edge.test.ts#1507 — three cases: emitted at the review gate, absent
      at a non-review human state, emitted even with no ticks to clear
- [ ] ./src/testing/EmittedScriptRecognizer.ts#476 — the `@inmem` recognizer
      re-runs the real `clearFilePointerTicks`, so in-memory scenarios see the
      same effect

**Risk, worth a decision:** this is a bare `gtd` invocation inside the
_required_ landing script, resolved by name on `$PATH` at run time, with no
`onFailure`. `assembleScript` prefixes `set -eu`, so any non-zero exit aborts
before the commit. Two concrete failures: a `gtd` on `$PATH` older than this
change treats `uncheck` as an unknown subcommand and exits 2, which means the
review gate can never land at all; and a driver that runs `gtd land` from
somewhere other than the repo root gets a relative `<file>` that does not
resolve — there the command is a silent no-op, not an error. Compare against the
existing convention that a mode's `format:`/`validate:` pair is run by the
DRIVER ahead of `gtd land` and never emitted into the landing script.

## Dropping the `sed` normalization from `deciding`

With no `[x]` able to reach a commit, the sign-off test compares
`.gtd/REVIEW.md` byte-for-byte across the human's commit. The
`sed -E 's/\[[ xX]\]/[_]/g'` normalization on both sides is gone, and the gate
message now tells the human ticks are cleared on land with no persisted trail.

- [ ] ./src/workflows/unified.yaml#725 — the `await-review` message gains the
      "landing clears every box" sentence
- [ ] ./src/workflows/unified.yaml#787 — the comparison itself, now two bare
      `git show` calls
- [ ] ./src/workflows/unified.yaml#885 — the `collecting` prompt drops "anything
      beyond a checkbox flip" from its actionability rule
- [ ] ./tests/shell/corpus/workflow.build.review.deciding.sh#25 — the pinned
      shell corpus, kept in step
- [ ] ./tests/integration/features/review-tick-reset.feature#1 — new `@live`
      feature, three scenarios: tick-only is sign-off and the tick is gone from
      disk; tick plus a note is feedback and reaches `collecting`; a ticked
      qa-mode answer survives its land untouched
- [ ] ./tests/integration/features/deciding-signoff.feature#19 — rewritten to
      land the human turn through `gtd land` instead of hand-committing a ticked
      file
- [ ] ./tests/integration/features/review-signoff-format-skip.feature#37 — same
      rewrite

**Coupling to check:** `deciding`'s correctness now depends on a step in a
different script having succeeded earlier. Any path that reaches this commit
without running the emitted uncheck — a hand-commit, a driver that stages and
commits itself, the stale-`gtd` case above — puts a `[x]` in the commit, and the
byte comparison reads it as a note. That misroutes a clean sign-off into a
feedback round. The old `sed` was tolerant of exactly that; the new form is not.
Both rewritten features above exist because the old hand-commit setup stopped
being valid, which is the same coupling showing up in the test suite.
