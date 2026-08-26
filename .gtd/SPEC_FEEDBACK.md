# Spec feedback — package 02 (landing script is only the commit)

Requirements A and B are both implemented and the suite is green. Six things are
wrong, all of them stale prose left behind by the deletion, plus one test file
that now proves nothing.

## 1. `AGENTS.md` still documents `steeringModeSteps` as live (blocking)

`AGENTS.md` is this repo's architecture contract, and two of its sections
describe a function this package deleted:

- **line 46-50** (`### .gtd/ is formatted, not ignored`) — "a state declaring
  both `file:` and `mode:` gets that mode's own
  `npx oxfmt --write <%= it.file %>` emitted into its step script ahead of the
  commit (`program.ts`'s `steeringModeSteps`)". That mechanism is gone; only the
  husky → lint-staged half is left, and the section's claim that "two mechanisms
  keep files there conforming" is now false.
- **line 333-347** (`## Step capture`, the guards bullet) — "`program.ts`'s
  `steeringModeSteps` emits the mode's own `format:`/`validate:` commands (over
  `src/SteeringMode.ts`) into the step script for the driver to run, ahead of
  the commit", plus the whole trailing sentence about the pair being "skipped
  for an attempt … AND for a step whose diff DELETES that `file:`
  (`deletesFile`, shared with the guards)". `deletesFile` is now private to
  `StepGuards.ts` with no `steeringModeSteps` caller, and nothing is emitted.
  The same bullet's "so e.g. a malformed steering file is never committed" is
  now wrong for the non-guard case — `validate.feature`'s own rewritten scenario
  pins that a malformed edit **does** land.

Rewrite both to say the format/validate pair is a driver contract via
`gtd next --json`'s `validate` field.

## 2. `tests/integration/features/styled-steering.feature` is now vacuous and was left untouched

Task 5 only asked that it pass, and it does — but it passes for the wrong reason
and its stated mechanism no longer exists.

- Its doc block (**lines 14-24**) justifies both scenarios being `@live` on "the
  seeded `qa`/`review` validator renders as a literal
  `gtd check <mode> '<file>'` COMMAND inside the step script `gtd land` runs
  ahead of its commit". No such command is emitted any more, so the `@live` PATH
  shim is no longer load-bearing for either scenario.
- Worse, **neither scenario validates anything now**. Scenario 1 rests at
  `design.triage` (agent `prompt`, `mode: qa`) and scenario 2 at
  `build.review.reviewing` (agent, review doc) — `reviewDocGuard` requires
  `actor === "human"` and `answerCompletenessGuard` requires an answer-gate
  state (`src/StepGuards.ts:65,95`), so no guard applies at either rest. A
  styled file that FAILS `gtd check qa`/`gtd check review` would land exactly
  the same way. The feature's whole claim — "`gtd land` must actually accept it
  through the real validator and advance, not just look plausible" — is no
  longer tested by it.

Either rewrite the scenarios to run the validator explicitly (`gtd validate`, or
`gtd next --json`'s `validate` field) before `gtd land`, or move the coverage to
states where a guard actually applies. Rewrite the doc block either way — do not
leave a file whose header states a mechanism that was deleted in the same
package.

## 3. Stale comment: `src/program.ts:553-559`

`renderSteeringModeCommandSteps`'s doc says it is "shared by
`resolveValidateScript` and `steeringModeSteps` so the two never drift on which
command gets the routable fix prompt". `steeringModeSteps` is deleted;
`resolveValidateScript` is the only caller left, so there is nothing to keep
from drifting. Fix the sentence or drop it.

## 4. Duplicated doc comment: `tests/integration/support/world.ts:425-438`

`runGtdLandPiped` now carries **two** stacked doc comments. The first (the old
one, lines 425-432) still describes the removed behaviour — "proves the
CAPTURE-THEN-PIPE landing form, not the bare `gtd land | sh` one-liner it
replaces … capture stdout and exit code first, then pipe the script into `sh`" —
which is not what the rewritten body does (it now captures a `--sh` document and
`eval`s it). Delete the first comment; keep the new one.

## 5. Stale comment: `src/Emit.ts:186`

`combinedScript`'s doc calls its output "A plain-text write command's single
pasteable script (`gtd land | sh`)". `gtd land`'s plain text is prose now. Name
a command that still prints the script plainly (`gtd --entry <state>`,
`gtd abandon`, `gtd restore`) or point at `gtd land --sh`.

## 6. `README.md:64-74` loop sketch ends in a bare `gtd land`

The README's headline driver loop calls `gtd land` with no capture and no pipe,
so as written it now prints one prose sentence and lands nothing. This is the
first driver code a reader sees, and `docs/driver.md` was updated in this
package while the README was not. Bring it in line — `gtd land --sh`, `eval`,
then pipe `$gtd_script` into `sh`, the same shape the `gtd next --sh` line above
it already uses.
