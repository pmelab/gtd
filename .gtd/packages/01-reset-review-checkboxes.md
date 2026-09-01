# 01 — Reset review checkboxes when the review turn lands

## Requirement

At the point the `await-review` turn is captured, every `- [x]` / `- [X]`
pointer line in `.gtd/REVIEW.md` becomes `- [ ]` again. The human's notes, hunk
pointers, chunk headings, and the base comment are untouched — **only the box
character is reset.**

**The reset rewrites the file on disk, not just the committed blob.** The human
watches every box empty in their editor as `gtd land` runs. That is accepted:
the file is deleted on the very next turn anyway, so there is nothing to
preserve on disk past the land.

**The ticks are erased, and nothing records them anywhere else.** No list of
read hunks goes into the turn commit message, into `.gtd/REVIEW_RAW.md`, or into
any other file. A tick means "I read this hunk", never sign-off; once the round
closes nobody consults it. Accepted risk, stated plainly: **after this change
there is no record, in history or on disk, of which hunks the human read.**

**Three things follow from it, and all three ship together:**

- The tick-tolerance in the round's sign-off-vs-feedback decision (the
  `[ ]`/`[x]` normalisation before the two `REVIEW.md` blobs are compared) is no
  longer load-bearing, because no `[x]` can reach a commit.
- The feedback collector stops being told to ignore checkbox flips. Its rule
  becomes plainly "a note on `.gtd/REVIEW.md` is a concern" with no tick caveat.
- The `await-review` message stops promising the tick persists. It should say
  ticks are read-progress only, are cleared when you land, and are not kept.

**Acceptance:** a scenario where the human ticks boxes in `.gtd/REVIEW.md` and
changes nothing else, then lands — the file on disk carries no `[x]` after the
land, the review turn's commit shows no change to `.gtd/REVIEW.md`, and the
round is judged a clean sign-off, not feedback. It fails today (the commit
carries the flipped boxes) and passes after.

**Scope guard, and it is a real hazard:** this applies to `review` mode only.
`qa` mode's `- [ ]` boxes ARE the answer — an open question is answered iff
exactly one option is ticked, and clearing them would unanswer every question
and deadlock the answer-completeness gate. A regression test pinning that qa
ticks survive belongs in this package.

## Settled technical decisions

**The reset is a pure `string -> string` rewrite, applied by a new standalone
`gtd uncheck <file>` command, emitted as a step in the landing script.** No new
data model, no new dependency, no new type, no new exit code.

**`gtd land` stays a pure emitter.** Nothing mutates until the driver pipes the
printed script into `sh`, so a previewed-then-abandoned land leaves the human's
boxes alone.

## Task 1 — the rewrite

`clearFilePointerTicks(content: string): string`, exported from
`src/ReviewDoc.ts`, beside the `FILE_POINTER_RE` it reuses.

**Implement it as an anchored multiline regex replace over the whole string,
never `split(/\r?\n/)` + `join("\n")`.** A split/join implementation silently
normalises CRLF and so rewrites every line of a CRLF checkout's file — that
turns a tick-only round into a whole-file diff and defeats the entire change.
`src/Git.ts`'s `hashObjects` carries the same warning for the same reason: a
`text=auto` repo is where this fails, and it fails loudly as a fabricated "the
human edited something real".

**The rewrite is line-wise, not document-wise.** It never parses the review
document as a structure, so a structurally broken `.gtd/REVIEW.md` still gets
its ticks cleared and still lands. The reset must not become a second validator.

Paths: `src/ReviewDoc.ts`, `src/ReviewDoc.test.ts`.

- [ ] `clearFilePointerTicks` is exported from `src/ReviewDoc.ts` and rewrites
      the box of every `- [x]` / `- [X]` line that `FILE_POINTER_RE` accepts to
      `- [ ]`
- [ ] Path, inline note, continuation lines, indentation, chunk headings, the
      `<!-- base: … -->` comment, and the header all survive byte for byte
- [ ] `[X]` is cleared as well as `[x]`
- [ ] A `[x]` in prose, in a chunk heading, or inside a continuation note is
      left alone
- [ ] A `- [x]` line with no whitespace-delimited pointer token after the box is
      left alone
- [ ] CRLF line endings are preserved, and the file's trailing-newline state is
      unchanged
- [ ] The function is idempotent, total, and never throws
- [ ] Unit tests in `src/ReviewDoc.test.ts` cover each bullet above

## Task 2 — the `gtd uncheck <file>` command

A new standalone command shaped exactly like `gtd check <mode> <file>`: it
resolves no workflow state, reads no config, and runs from any directory with
the file given explicitly. It reads `<file>`, applies `clearFilePointerTicks`,
and writes the result back only when the bytes actually changed — an untouched
file is never rewritten, so its mtime never moves and no watcher fires for
nothing.

**It takes no `<mode>` argument, and must never grow one.** A
`gtd uncheck qa <file>` would clear the `- [x]` answers in a qa-mode file,
unanswer every open question, and refuse every subsequent land. The command
means review-mode file pointers and nothing else.

Exit codes stay the existing closed set: 0 on success and on a missing file, 2
for bad arity, 1 for an unreadable or unwritable file. `docs/cli.md`'s exit-code
table is unchanged; only its `## Commands` block moves, and it is regenerated
from `renderHelp()`, never hand-edited.

Paths: `src/Cli.ts`, `src/Cli.test.ts`, `src/program.ts`, `src/program.test.ts`,
`docs/cli.md`, `tests/integration/features/command-surface.feature`.

- [ ] `src/Cli.ts` carries an `uncheck` row in the command token table with
      arity `<file>`, plus its `Command` variant
- [ ] `src/program.ts` carries `runUncheckCommand` and its dispatch arm
- [ ] The command takes exactly one argument — no `<mode>` argument exists
- [ ] A file whose bytes are unchanged by the rewrite is not written back
- [ ] A missing file writes nothing and exits 0
- [ ] Bad arity exits 2; an unreadable or unwritable file exits 1 with a message
- [ ] `docs/cli.md`'s `## Commands` block is regenerated and equals
      `renderHelp()`; its exit-code table is untouched
- [ ] `tests/integration/features/command-surface.feature` covers the new
      command's surface

## Task 3 — emit the step into the landing script

`renderDecision` (`src/Edge.ts`) is the one place a decision becomes git
commands, and both landing surfaces route through it, so one edit covers every
caller. It prepends a single `{kind: "command"}` step — `gtd uncheck '<file>'`,
quoted through `shellQuote` — ahead of the existing `commitAll` step, when and
only when the resting state is the human review gate. `renderDecision` stays
pure: no git read, no new failure mode.

The step is selected by the same predicate `reviewDocGuard` already uses —
`stateDef.actor === "human" && stateDef.mode === "review"`. Promote that
predicate to a single exported helper in `src/StepGuards.ts` (where
`REVIEW_MODE` already lives) so the guard and the reset cannot drift apart. The
file it rewrites is `rest.hints.file`, never a hard-coded `.gtd/REVIEW.md`, so a
custom workflow's own human review gate gets the same behaviour.

**Never guard the step with `fileExistsGuard`.** That builder emits
`[ -f <file> ] || exit 0`, which exits the whole script 0 — on a missing
`.gtd/REVIEW.md` it would skip the commit and silently land nothing. The step is
unconditional; `gtd uncheck` absorbs the missing-file case itself.

**The step assumes `gtd` is on `$PATH`** — the same assumption the seeded
`gtd check <mode> '<file>'` validate command already makes in emitted scripts.

**Ordering is load-bearing in both directions, and getting it wrong deadlocks
the process.**

- **After the edge match.** `await-review` is a `message` state whose only edge
  is `"* **"` and which declares no `"C"` row. Reset the file before
  `rest.changes` is computed and a tick-only round goes clean — `step` returns
  `{kind: "noop"}` (`src/PatternMachine.ts`), `gtd land` commits nothing and
  exits zero, and the process sits at `await-review` forever with no way out.
  Emitting the step rather than mutating in-process satisfies this by
  construction.
- **Before `git add -A`.** The commit is `commitAll` (`src/GitScript.ts`); the
  reset has to be on disk before that line runs or the ticks land in the commit,
  which is the bug.

The resulting empty human-turn commit needs no new work: `commitAllowEmpty`
already passes `--allow-empty` and already retries `--no-verify` on git's own
empty-commit rejection.

**The reset runs on every review-mode human land, unconditionally — not only on
tick-only rounds.** A feedback round where the human ticked boxes and left a
note must commit the note without the ticks. On a round with no ticks the
rewrite is byte-identical, so it dirties nothing and changes no outcome.

Nothing is emitted for a `noop` decision or an attempt commit — `renderDecision`
is only ever called for a commit decision, and an attempt commit is impossible
at a `message` state anyway, since only `prompt` states produce one.

Paths: `src/Edge.ts`, `src/StepGuards.ts`.

- [ ] The human-review-gate predicate (`actor === "human"` and
      `mode === "review"`) is one exported helper in `src/StepGuards.ts`, used
      by both `reviewDocGuard` and the emitted step
- [ ] `renderDecision` prepends `gtd uncheck '<file>'` (quoted through
      `shellQuote`, path taken from `rest.hints.file`) ahead of `commitAll`,
      only at the human review gate
- [ ] `renderDecision` remains pure — no git read, no new failure mode
- [ ] The step is emitted unconditionally, never wrapped in `fileExistsGuard`
- [ ] No step is emitted at any other state, and none for a `noop` decision or
      an attempt commit
- [ ] The empty human-turn commit lands without any change to `commitAllowEmpty`

## Task 4 — the three workflow changes that ship with it

Paths: `src/workflows/unified.yaml`.

- [ ] `build.review.deciding`'s `sed -E 's/\[[ xX]\]/[_]/g'` tick normalisation
      is deleted, along with the comment explaining it — no `[x]` can reach a
      commit through gtd's own landing path once the reset ships, and a
      normalisation whose only remaining job is to mask a broken reset is dead
      defence
- [ ] `build.review.collecting`'s prompt drops its checkbox caveat — delete the
      "anything beyond a checkbox flip, ticked or not (ticking only means 'I
      read this hunk', never sign-off)" clause, leaving plainly "a note on
      `.gtd/REVIEW.md` is a concern"
- [ ] `await-review`'s message stops promising the tick persists: it says ticks
      are read-progress only, are cleared when you land, and are not kept

## Task 5 — tests

**Dropping the normalisation breaks two existing `@live` scenarios, and both
must be rewritten in this package.** `deciding-signoff.feature` and
`review-signoff-format-skip.feature` each hand-commit a ticked `.gtd/REVIEW.md`
as the human turn instead of landing it through `gtd land`; with the `sed` gone
that commit reads as a real edit and routes to feedback, not sign-off.

The new scenarios are `@live` because the emitted landing script and
`build.review.deciding`'s shell logic both have to actually execute.

Paths: `tests/integration/features/review-tick-reset.feature` (new),
`tests/integration/features/deciding-signoff.feature`,
`tests/integration/features/review-signoff-format-skip.feature`.

- [ ] New `@live` acceptance scenario: the human ticks boxes and changes nothing
      else, then lands — `.gtd/REVIEW.md` on disk carries no `[x]`, the review
      turn's commit shows no change to `.gtd/REVIEW.md`, and executing
      `build.review.deciding`'s script then landing reaches
      `gtd(check): build.review.deciding → idle`
- [ ] New `@live` feedback scenario: the human ticks boxes and adds a note — the
      commit carries the note and no `[x]`, and the round routes to
      `build.review.collecting`
- [ ] New `@live` qa regression scenario: at an answer gate (`mode: qa`) a
      ticked option survives the land untouched
- [ ] `deciding-signoff.feature` lands its human turn through `gtd land` instead
      of hand-committing a ticked file, and still reaches `idle`
- [ ] `review-signoff-format-skip.feature` lands its human turn through
      `gtd land` instead of hand-committing a ticked file, and still reaches
      `idle`
- [ ] No new Turborepo task — `src/**`, `tests/**` and `docs/**` are already
      declared inputs of the existing checks
