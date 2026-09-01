# Architecture: reset review checkboxes at the review land

One concern, one package. No merges — there is nothing to merge a single concern
with, so there is no `## Merged Concerns` section.

## Open Questions

### Where does the tick reset run — in gtd's own process during `gtd land`, or as a step in the landing script it emits?

- [ ] In-process, in `planLanding` (`src/program.ts`) right after
      `enforceStepGuards` passes — no new CLI surface, no new emitted step, and
      `src/ReviewDoc.ts`'s rewrite is called directly. Cost: `gtd land` stops
      being a pure emitter and rewrites the working tree even when the driver
      never pipes the printed script into `sh`, so a previewed-then-abandoned
      land clears the human's boxes with no commit behind it
- [ ] As the first step of the emitted `required` script, ahead of `git add -A`,
      invoking a new standalone `gtd uncheck <file>` subcommand (a `sed -i`
      literal is not portable across GNU/BSD, so the step has to be a gtd
      invocation — the same way the seeded `gtd check <mode> '<file>'` already
      appears in emitted scripts). Mutation happens only when the script
      actually runs. Cost: a new public command, a new row in `docs/cli.md`'s
      pinned `## Commands` block, and `src/Cli.test.ts` +
      `tests/integration/features/command-surface.feature` churn
- [ ] _your answer_

### Does the sign-off comparison keep its `[ ]`/`[x]` normalisation as defence-in-depth, or drop it as dead code?

- [ ] Keep the `sed -E 's/\[[ xX]\]/[_]/g'` pipeline in
      `build.review.deciding`'s script (`src/workflows/unified.yaml`), with a
      comment saying the reset is now the primary mechanism. Zero test churn:
      `deciding-signoff.feature` and `review-signoff-format-skip.feature` both
      hand-commit a `[x]` `.gtd/REVIEW.md` as the human turn and keep passing
      untouched
- [ ] Drop it. No `[x]` can reach a commit through gtd's own landing path once
      the reset ships, and a normalisation whose only remaining job is to mask a
      broken reset is dead defence. Cost: both features above simulate the human
      turn with a hand-commit rather than `gtd land`, so both must be rewritten
      to land through `gtd land` — more faithful, but two `@live` scenarios
      rewritten
- [ ] _your answer_

## Reset review checkboxes when the review turn lands

**The whole change is one pure string rewrite plus one call site.** No new data
model, no new dependency, no new type — the rewrite is `string -> string`, and
the file it rewrites is already parsed by a module that ships today.

### File footprint

- `src/ReviewDoc.ts` — the rewrite itself, beside the `FILE_POINTER_RE` it
  reuses
- `src/ReviewDoc.test.ts` — unit coverage of the rewrite
- `src/StepGuards.ts` — the state selector, promoted to a shared export
- `src/program.ts` — the call site (both open-question branches land here; the
  second also touches `src/Cli.ts` and `docs/cli.md`)
- `src/workflows/unified.yaml` — the `await-review` message, the `collecting`
  prompt, and `deciding`'s script
- `tests/integration/features/review-tick-reset.feature` — new, `@live`
- `tests/integration/features/deciding-signoff.feature`,
  `tests/integration/features/review-signoff-format-skip.feature` — touched only
  if the second open question drops the normalisation

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

### Where it is called from

The call site is selected by the same predicate `reviewDocGuard` already uses —
`stateDef.actor === "human" && stateDef.mode === "review"`. Promote that
predicate to a single exported helper in `src/StepGuards.ts` (where
`REVIEW_MODE` already lives) so the guard and the reset cannot drift apart. The
file it rewrites is `rest.hints.file`, never a hard-coded `.gtd/REVIEW.md`, so a
custom workflow's own human review gate gets the same behaviour.

**Ordering is load-bearing in both directions, and getting it wrong deadlocks
the process.**

- **After the edge match.** `await-review` is a `message` state whose only edge
  is `"* **"` and which declares no `"C"` row. Reset the file before
  `rest.changes` is computed and a tick-only round goes clean — `step` returns
  `{kind: "noop"}` (`src/PatternMachine.ts`), `gtd land` commits nothing and
  exits zero, and the process sits at `await-review` forever with no way out.
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

It inherits `enforceStepGuards`'s bypasses: nothing runs for a `noop` decision
or an attempt commit. (An attempt commit is impossible at a `message` state
anyway — only `prompt` states produce one.)

### Error handling

- **File missing.** No-op, silently. The review-doc guard already refuses a
  _deleted_ `.gtd/REVIEW.md`, but a never-provisioned one still reaches here.
  In-process: treat `RepoFiles.working` returning `undefined` as nothing to do.
  In-script: emit the existing `fileExistsGuard(file)` builder ahead of the
  step.
- **File unreadable (EPERM and friends).** Loud failure, tree untouched, nothing
  committed. In-process that is an Effect failure formatted `gtd land: …`; in
  the emitted script `set -eu` aborts before `git add -A` ever runs.
- **Malformed document.** Not an error — see the line-wise note above.

### The three things that ship with it

- `build.review.deciding`'s tick normalisation in `src/workflows/unified.yaml`
  is no longer load-bearing. Its fate is the second open question above.
- `build.review.collecting`'s prompt drops its checkbox caveat. The rule becomes
  plainly "a note on `.gtd/REVIEW.md` is a concern" — delete the "anything
  beyond a checkbox flip, ticked or not (ticking only means 'I read this hunk',
  never sign-off)" clause.
- `await-review`'s message stops promising the tick persists. It says ticks are
  read-progress only, are cleared when you land, and are not kept.

### Scope guard

**`qa` mode's ticks must survive, and breaking that deadlocks every answer
gate.** `.gtd/REQUIREMENTS.md`'s and `.gtd/ARCHITECTURE.md`'s `- [x]` boxes ARE
the answer: `answerCompletenessGuard` refuses a step until exactly one option
per question is ticked, so clearing them would unanswer every question and
refuse the land forever. The selector above is what keeps them safe — it matches
on `mode: review`, and the rewrite lives in `src/ReviewDoc.ts`, which
`src/OpenQuestions.ts` never calls. A regression scenario pins it.

### Tests

Unit, `src/ReviewDoc.test.ts`: `[x]` and `[X]` both cleared; a `[x]` in prose or
inside a note untouched; pointer path and inline note preserved; CRLF line
endings preserved; trailing-newline state unchanged; idempotent; a `- [x]` with
no pointer token after it untouched.

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

No new Turborepo task: `src/**` and `tests/**` are already declared inputs of
the existing checks.

## Answered Questions

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

### Does the reset need a new library or data model?

No. It is a pure string rewrite with no new type, no new dependency, and no
persisted state — the smallest thing that can satisfy the concern.

### Does a missing `.gtd/REVIEW.md` fail the land?

No, it is a silent no-op. The deleted-file case is already refused by
`reviewDocGuard`; a never-provisioned file must not turn into a second refusal
path, because `build.review.deciding` already detects and routes that case
itself by the file's absence.

### Does the reset run on every review land, or only when the round is a sign-off?

Every review-mode human land, unconditionally. A sign-off is not knowable at
capture time — `deciding` decides it one turn later — and a feedback round must
commit its note without ticks just the same. With no ticks present the rewrite
is byte-identical and dirties nothing.
