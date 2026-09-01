# Architecture: reset review checkboxes at the review land

One concern, one package. No merges — there is nothing to merge a single concern
with, so there is no `## Merged Concerns` section.

## Reset review checkboxes when the review turn lands

**The whole change is one pure string rewrite, one new standalone CLI command
that applies it, and one extra step in the emitted landing script.** No new data
model, no new dependency, no new type, no new exit code — the rewrite is
`string -> string`, and the file it rewrites is already parsed by a module that
ships today.

### File footprint

- `src/ReviewDoc.ts` — the rewrite itself, beside the `FILE_POINTER_RE` it
  reuses
- `src/ReviewDoc.test.ts` — unit coverage of the rewrite
- `src/Cli.ts` — the `uncheck` row in the command token table and its `Command`
  variant
- `src/Cli.test.ts` — the command-table and pinned-help assertions
- `src/program.ts` — `runUncheckCommand` and its dispatch arm
- `src/StepGuards.ts` — the state selector, promoted to a shared export
- `src/Edge.ts` — `renderDecision`, where the reset step is prepended to the
  commit
- `src/workflows/unified.yaml` — the `await-review` message, the `collecting`
  prompt, and `deciding`'s script
- `docs/cli.md` — the pinned `## Commands` block, regenerated
- `tests/integration/features/review-tick-reset.feature` — new, `@live`
- `tests/integration/features/command-surface.feature` — the new command's
  surface
- `tests/integration/features/deciding-signoff.feature`,
  `tests/integration/features/review-signoff-format-skip.feature` — both
  rewritten to land the human turn through `gtd land`

### The rewrite

`clearFilePointerTicks(content: string): string`, exported from
`src/ReviewDoc.ts`. It rewrites the box of every `- [x]` / `- [X]` line that
`FILE_POINTER_RE` accepts to `- [ ]`, and changes nothing else — path, inline
note, continuation lines, indentation, chunk headings, the `<!-- base: … -->`
comment, and the header all survive byte for byte. It is idempotent, total, and
never throws.

**Implement it as an anchored multiline regex replace over the whole string,
never `split(/\r?\n/)` + `join("\n")`.** A split/join implementation silently
normalises CRLF and so rewrites _every_ line of a CRLF checkout's file — that
turns a tick-only round into a whole-file diff and defeats the entire change.
`src/Git.ts`'s `hashObjects` carries the same warning for the same reason: a
`text=auto` repo is where this fails, and it fails loudly as a fabricated "the
human edited something real".

**The rewrite is line-wise, not document-wise.** It never parses the review
document as a structure, so a structurally broken `.gtd/REVIEW.md` still gets
its ticks cleared and still lands. The reset must not become a second validator.

### The `gtd uncheck <file>` command

A new standalone command, shaped exactly like `gtd check <mode> <file>`: it
resolves no workflow state, reads no config, and runs from any directory with
the file given explicitly. It reads `<file>`, applies `clearFilePointerTicks`,
and writes the result back only when the bytes actually changed — an untouched
file is never rewritten, so its mtime never moves and no watcher fires for
nothing.

**It takes no `<mode>` argument, and must never grow one.** A
`gtd uncheck qa <file>` would clear the `- [x]` answers in
`.gtd/REQUIREMENTS.md`, unanswer every open question, and refuse every
subsequent land. The command means review-mode file pointers and nothing else.

Exit codes are the existing closed set: 0 on success and on a missing file, 2
for bad arity, 1 for an unreadable or unwritable file. `docs/cli.md`'s exit-code
table is unchanged; only its `## Commands` block moves, and it is regenerated
from `renderHelp()`, not hand-edited.

### Where the step is emitted

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
  construction: nothing runs until the driver pipes the script into `sh`, long
  after the decision is made.
- **Before `git add -A`.** The commit is `commitAll` (`src/GitScript.ts`); the
  reset has to be on disk before that line runs or the ticks land in the commit,
  which is the bug.

The resulting empty human-turn commit needs no new work: `commitAllowEmpty`
already passes `--allow-empty` and already retries `--no-verify` on git's own
empty-commit rejection.

**The reset runs on every review-mode human land, unconditionally — not only on
tick-only rounds.** A feedback round where the human ticked boxes _and_ left a
note must commit the note without the ticks. On a round with no ticks the
rewrite is byte-identical, so it dirties nothing and changes no outcome.

Nothing is emitted for a `noop` decision or an attempt commit — `renderDecision`
is only ever called for a commit decision, and an attempt commit is impossible
at a `message` state anyway, since only `prompt` states produce one.

### Error handling

- **File missing.** `gtd uncheck` writes nothing and exits 0. The review-doc
  guard already refuses a _deleted_ `.gtd/REVIEW.md`, but a never-provisioned
  one still reaches the step, and `build.review.deciding` already detects and
  routes that case itself by the file's absence.
- **File unreadable or unwritable.** `gtd uncheck` exits 1 with a message; the
  landing script's `set -eu` aborts before `git add -A` ever runs, so the tree
  is untouched and nothing is committed.
- **Malformed document.** Not an error — see the line-wise note above.

### The three things that ship with it

- `build.review.deciding`'s `sed -E 's/\[[ xX]\]/[_]/g'` tick normalisation in
  `src/workflows/unified.yaml` is deleted, along with the comment explaining it.
  No `[x]` can reach a commit through gtd's own landing path once the reset
  ships, and a normalisation whose only remaining job is to mask a broken reset
  is dead defence.
- `build.review.collecting`'s prompt drops its checkbox caveat. The rule becomes
  plainly "a note on `.gtd/REVIEW.md` is a concern" — delete the "anything
  beyond a checkbox flip, ticked or not (ticking only means 'I read this hunk',
  never sign-off)" clause.
- `await-review`'s message stops promising the tick persists. It says ticks are
  read-progress only, are cleared when you land, and are not kept.

**Dropping the normalisation breaks two existing `@live` scenarios, and both
must be rewritten in this package.** `deciding-signoff.feature` and
`review-signoff-format-skip.feature` each hand-commit a ticked `.gtd/REVIEW.md`
as the human turn instead of landing it through `gtd land`; with the `sed` gone
that commit reads as a real edit and routes to feedback, not sign-off. Rewrite
both to land the human turn with `gtd land` — the more faithful setup, and the
one that exercises the reset.

### Scope guard

**`qa` mode's ticks must survive, and breaking that deadlocks every answer
gate.** `.gtd/REQUIREMENTS.md`'s and `.gtd/ARCHITECTURE.md`'s `- [x]` boxes ARE
the answer: `answerCompletenessGuard` refuses a step until exactly one option
per question is ticked, so clearing them would unanswer every question and
refuse the land forever. Two things keep them safe — the step is emitted only
for `mode: review`, and the rewrite lives in `src/ReviewDoc.ts`, which
`src/OpenQuestions.ts` never calls. A regression scenario pins it.

### Tests

Unit, `src/ReviewDoc.test.ts`: `[x]` and `[X]` both cleared; a `[x]` in prose or
inside a note untouched; pointer path and inline note preserved; CRLF line
endings preserved; trailing-newline state unchanged; idempotent; a `- [x]` with
no pointer token after it untouched.

Unit, `src/Cli.test.ts` and `src/program.test.ts`: `uncheck` appears in the
command table and the rendered help; bad arity exits 2; a missing file exits 0
and writes nothing; an unchanged file is not rewritten.

`@live` e2e, new `tests/integration/features/review-tick-reset.feature` —
`@live` because the emitted landing script and `deciding`'s shell logic both
have to actually execute:

- **Acceptance.** The human ticks boxes in `.gtd/REVIEW.md` and changes nothing
  else, then lands. `.gtd/REVIEW.md` on disk carries no `[x]`; the review turn's
  commit shows no change to `.gtd/REVIEW.md`; executing `deciding`'s script and
  landing reaches `gtd(check): build.review.deciding → idle` — a clean sign-off,
  not feedback. It fails today (the commit carries the flipped boxes).
- **Feedback round still works.** The human ticks boxes _and_ adds a note; the
  commit carries the note and no `[x]`, and the round routes to `collecting`.
- **`qa` regression.** At an answer gate (`mode: qa`, `.gtd/REQUIREMENTS.md`) a
  ticked option survives the land untouched.

No new Turborepo task: `src/**`, `tests/**` and `docs/**` are already declared
inputs of the existing checks.

## Answered Questions

### Where does the tick reset run — in gtd's own process during `gtd land`, or as a step in the landing script it emits?

As a step in the emitted script. `renderDecision` (`src/Edge.ts`) prepends
`gtd uncheck '<file>'` ahead of `git add -A`, invoking a new standalone
subcommand — a `sed -i` literal is not portable across GNU and BSD, so the step
has to be a gtd invocation, the same way the seeded `gtd check <mode> '<file>'`
already appears in emitted scripts. `gtd land` stays a pure emitter: a
previewed-then-abandoned land leaves the human's boxes alone, because nothing
mutates until the driver runs the script. The cost is a new public command, a
regenerated `## Commands` block in `docs/cli.md`, and the command-surface tests.

### Does the sign-off comparison keep its `[ ]`/`[x]` normalisation as defence-in-depth, or drop it as dead code?

Drop it. No `[x]` can reach a commit through gtd's own landing path once the
reset ships, and a normalisation whose only remaining job is to mask a broken
reset is dead defence. The cost is real and is part of this package:
`deciding-signoff.feature` and `review-signoff-format-skip.feature` both
hand-commit a ticked `.gtd/REVIEW.md` as the human turn, so both must be
rewritten to land it through `gtd land`.

### Should the record of which hunks the human read survive the round at all?

No — erase them, and record them nowhere. A tick only ever meant "I read this
hunk", never sign-off, and nothing downstream reads it once the round closes;
keeping it is exactly the churn this change removes. **After this change there
is no record, in history or on disk, of which hunks the human read.**

### Does the human's own copy of the file visibly clear, or only the commit?

The file on disk clears at `gtd land`. Boxes empty in the human's open editor as
the turn commits, which is acceptable because the next turn deletes the file.

### Is the `package-lock.json` change in the entry commit part of the intent?

No. The entry commit dropped two transitive `mongoose` lock entries — ordinary
`npm install` churn that rode along with the note. It carries no intent and is
not a concern.

### Which files' checkboxes does "after a finished human review" mean?

`.gtd/REVIEW.md` only. It is the sole `review`-mode file a human ever edits —
the workflow has exactly one human state in that mode — and the sketch's phrase
"handled by the review collection" names the feedback collector, which reads
that file and nothing else.

### Which lines does the reset touch?

Only lines `FILE_POINTER_RE` (`src/ReviewDoc.ts`) accepts — a list marker, a
box, then a whitespace-delimited pointer token. A `[x]` in prose, in a chunk
heading, or inside a continuation note is left alone. Reusing the parser's own
regex is what keeps the reset and the format from disagreeing about what a
pointer line is.

### Does `gtd uncheck` take a `<mode>` argument like `gtd check` does?

No — one argument, the file, and review-mode pointer semantics baked in. A
`gtd uncheck qa <file>` would clear the answers in `.gtd/REQUIREMENTS.md` and
deadlock every answer gate, so the generality is a hazard with no use.

### Does the reset need a new library, data model, or exit code?

No. It is a pure string rewrite with no new type, no new dependency, and no
persisted state, and the new command reuses the existing closed exit-code set —
the smallest thing that can satisfy the concern.

### Does a missing `.gtd/REVIEW.md` fail the land?

No. `gtd uncheck` writes nothing and exits 0, and the step is emitted
unconditionally rather than wrapped in `fileExistsGuard` — that builder's
`|| exit 0` would skip the commit itself. The deleted-file case is already
refused by `reviewDocGuard`, and `build.review.deciding` already detects a
never-provisioned file by its absence.

### Does the reset run on every review land, or only when the round is a sign-off?

Every review-mode human land, unconditionally. A sign-off is not knowable at
capture time — `deciding` decides it one turn later — and a feedback round must
commit its note without ticks just the same. With no ticks present the rewrite
is byte-identical and dirties nothing.
