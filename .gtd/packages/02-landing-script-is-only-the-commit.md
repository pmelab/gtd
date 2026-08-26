# Package 2 — The landing script is only the commit, and plain `gtd land` explains itself

**This package carries two requirements**, merged upstream because both rewrite
the same three functions in `src/program.ts`'s landing region
(`steeringModeSteps`, `buildRequiredScript`, `runLandCommand`), the same
`src/Cli.ts` help row, the same `docs/cli.md`/`docs/driver.md` blocks and the
same `land.feature`. The second rewrites the output of the very function the
first shortens, so shipping them apart means writing the prose branch twice.
**Review each requirement independently against the tasks below.**

## Requirement A — The landing script is only the commit

PRODUCT — resolved: drop the steering-mode commands from the landing.

Drop `steeringModeSteps` from `program.ts`'s `buildRequiredScript`, so the
emitted `required` script is the HEAD assertion plus the commit and nothing
else. `steeringModeSteps` itself goes with it — `program.ts` has no other caller
— and `resolveSelfValidateCommand`, which `gtd next --json`'s `validate` field
is built from, stays exactly as it is.

**This is the only concern that trades away correctness rather than log noise:**
the steering-file format and validation stop being a gtd guarantee and become a
driver contract, biting only if the driver actually ran `gtd next --json`'s
`validate` field first. **A driver that skips validation can now commit a
malformed steering file** — a `.gtd/REVIEW.md` that no longer parses, and a
review loop that deadlocks on it.

Two things blunt that, and neither closes it: the four `enforceStepGuards`
guards are unaffected (they run inside `planLanding`, not in the emitted
script), so a malformed review doc that trips the review-doc guard is still
refused; and `.gtd/` is covered by husky → lint-staged running `oxfmt --write`
over staged files, so formatting-only drift is still caught on the way in.

Acceptance: at a rest declaring `file:` + `mode:` with a dirty steering file,
`gtd land`'s emitted script contains no `oxfmt`/`prettier`/`gtd check`
invocation — only the commit. Today it contains the mode's pair ahead of the
commit.

## Requirement B — Plain `gtd land` explains itself

PRODUCT — resolved: prose becomes the plain output, not a new flag.

Plain `gtd land` prints one human-readable sentence — "commit everything with
this message: `<subject>`" — instead of the script. `--json`/`--sh` keep the
`script` field **byte-identical**, so they stay the machine path. No new flag is
added: this is a change to `runLandCommand`'s existing else-branch, so
`src/Cli.ts`'s flag table gains no row.

**This is a breaking change for any driver piping `gtd land` into `sh`.** Two
things keep the damage small, and both must be verified rather than assumed:
`docs/driver.md`'s doc-tested minimal driver already reads its script from
`gtd land --sh` (line 411), and `docs/driver.md` already warns against a bare
`gtd land | sh` because it hands an empty script to a shell on a refusal.

Carry in the same concern: `Cli.ts`'s `land` help row (it currently documents
plain output as "prints ONLY the script … e.g. `gtd land | sh`"),
`docs/cli.md`'s `## Commands` block, which is pinned equal to `renderHelp()`'s
output, `docs/driver.md`'s two `gtd land | sh` mentions, `src/Install.ts`'s
briefing, and `land.feature`'s plain-output scenarios.

Acceptance: at a rest with a pending diff, plain `gtd land` prints no bash and
names the commit subject in a sentence, while the same invocation's `--json`
`script` field is unchanged from before the concern.

## Tasks

### Task 1 — Delete `steeringModeSteps` (Requirement A)

Delete `steeringModeSteps` from `src/program.ts`, whole. `buildRequiredScript`
collapses to
`emitScripts(headPreconditions(...), renderDecision(...)).required`, and its
`isAttemptDecision` skip disappears with the steps it was skipping — an attempt
and an ordinary commit now emit the same shape.

What stays: `deletesFile` (its `src/StepGuards.ts` caller is unaffected),
`resolveSelfValidateCommand`, `renderSteeringModeCommandSteps` and
`fixPromptInstruction` — `gtd next --json`'s `validate` field is built from them
and is untouched. The four `enforceStepGuards` guards run inside `planLanding`,
not in the emitted script, so they are unaffected.

One failure mode leaves the landing path: `steeringModeSteps`'s
`unknownModeMessage` refusal. It loses nothing — a state whose `mode:` names no
entry in the workflow's own `modes:` map is already a `validateDefinition`
finding thrown at load time, before any command reaches the landing path.

- [ ] `src/program.ts` declares no `steeringModeSteps`
- [ ] at a rest declaring `file:` + `mode:` with a dirty steering file,
      `gtd land --sh`'s script contains **no `oxfmt`, `prettier` or `gtd check`
      invocation** — only the HEAD assertion and the commit
- [ ] `gtd next --json`'s `validate` field is byte-identical to before
- [ ] `buildRequiredScript` has no attempt-vs-commit branch left

Paths: `src/program.ts`, `src/program.test.ts`

### Task 2 — Add the prose sentence (Requirement B)

Add `landProseText(subject)` to `src/OutcomeScript.ts` as one `FMT_*`-style
formatter: `commit everything with this message: <subject>`, newline-terminated,
ANSI-free like every sibling there.

`runLandCommand`'s else-branch writes `landProseText(result.subject)` instead of
`result.script`. A no-op prints its existing `noopText(state)` line — the same
text the outcome block prints today, so nothing new is authored for that branch.
A refusal is unchanged: `src/Cli.ts`'s envelope writes it to stderr with exit 1
and stdout stays byte-empty.

`--json`/`--sh` keep the `script` field **byte-identical**. Pin that with a unit
test asserting one rest's `--json` `script` field against the string the commit
steps produce, asserted independently of `runLandCommand`'s plain branch, so
prose and script cannot drift into each other.

- [ ] plain `gtd land` at a rest with a pending diff prints **no bash** and
      names the commit subject in one sentence
- [ ] plain `gtd land` at a no-op prints the existing no-op line
- [ ] a refusal writes to stderr with exit 1 and leaves stdout byte-empty
- [ ] `--json`'s `script` field is pinned by a test that does not go through
      `runLandCommand`'s plain branch
- [ ] `tests/integration/features/ansi-free-stdout.feature` passes — the prose
      carries no escape sequence
- [ ] `src/Cli.ts`'s flag table gains no row

Paths: `src/OutcomeScript.ts`, `src/OutcomeScript.test.ts`, `src/program.ts`,
`src/program.test.ts`

### Task 3 — Rewrite the `land` help row and the docs (Requirement B)

`src/Cli.ts`'s `land` command row currently documents plain output as "prints
ONLY the script … e.g. `gtd land | sh`". Rewrite its `details`: plain output is
the prose, `--json`/`--sh` carry the script.

`docs/cli.md`'s `## Commands` block is **pinned equal to `renderHelp()`'s
output**, so it must be regenerated in the same commit. `docs/driver.md`'s two
`gtd land | sh` mentions (lines 230 and 317) and `src/Install.ts`'s briefing
both describe the old plain output.

`docs/**` is in `test:unit`'s and both e2e tasks' `inputs`. `docs/driver.md`'s
"A complete minimal driver" section is doc-tested — its heading text and single
fence are load-bearing, and it already reads its script from `gtd land --sh` at
line 411, so the fence itself should need no change.

- [ ] `src/Cli.ts`'s `land` row describes prose as plain output
- [ ] `docs/cli.md`'s `## Commands` block equals `renderHelp()`'s output
- [ ] neither `docs/driver.md` nor `src/Install.ts` tells a reader to pipe plain
      `gtd land` into a shell
- [ ] `tests/integration/features/driver-doc.feature` passes — the doc-tested
      driver still runs
- [ ] `src/Cli.test.ts`'s unknown-flag property test still passes

Paths: `src/Cli.ts`, `src/Cli.test.ts`, `docs/cli.md`, `docs/driver.md`,
`src/Install.ts`, `src/Install.test.ts`

### Task 4 — Point the e2e harness at `--sh` (Requirement B)

`tests/integration/support/world.ts`'s `driveWriteCommand` runs
`lastResult.stdout` verbatim as the script. **36 feature files invoke
`gtd land`**, so prose on plain stdout breaks every one of them until the
harness reads the script from somewhere else.

`When I run gtd land` (`tests/integration/support/steps/common.steps.ts:225`)
invokes `gtd land --sh`, and `driveWriteCommand` drives `$gtd_script` out of
that document. **The 36 feature files that only advance state through `gtd land`
need no edit.** `land.feature` gains one new explicit step for the prose
assertions.

**Accepted price: the step phrase "I run gtd land" now runs `gtd land --sh`, not
`gtd land`** — a scenario reading that line cannot tell which of the two it got.

- [ ] `When I run gtd land` invokes `gtd land --sh` and drives `$gtd_script`
- [ ] no feature file that merely advances state through `gtd land` is edited
- [ ] `land.feature` has one new explicit step asserting plain `gtd land`'s
      prose
- [ ] `npm run test:e2e:inmem` and `npm run test:e2e:live` are both green

Paths: `tests/integration/support/world.ts`,
`tests/integration/support/steps/common.steps.ts`,
`tests/integration/features/land.feature`

### Task 5 — Update the steering-mode features (Requirement A)

These features assert the mode's `format:`/`validate:` pair appearing ahead of
the commit in the emitted script.

- [ ] `tests/integration/features/steering-modes.feature` passes with no
      format/validate command asserted in a landing script
- [ ] `review-signoff-format-skip.feature`, `formatting.feature` and
      `styled-steering.feature` all pass
- [ ] `npm test` is green

Paths: `tests/integration/features/steering-modes.feature`,
`tests/integration/features/review-signoff-format-skip.feature`,
`tests/integration/features/formatting.feature`,
`tests/integration/features/styled-steering.feature`

## The risk

**A driver that skips `gtd next --json`'s `validate` field can now commit a
malformed `.gtd/REVIEW.md`, and the review loop deadlocks on it** — not the
agent, the loop.

## Out of scope

Three things keep `land`'s emitted script a script rather than a bare
`git commit`, and are not up for removal: **the `expectedHead` assertion, the
`index.lock` retry, and the empty-commit hook fallback** (`--allow-empty`, then
`--no-verify` on a hook rejection).

`--entry`, `abandon`, `restore` and `validate` do **not** switch to prose. Their
plain stdout stays the script a driver pipes to `sh`.

This package adds no dependency, no CLI flag, no config key and no turbo task.
