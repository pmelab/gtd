# Review: 7bb1540

<!-- base: 7fd0e8761eee4255b2189c7d40edcce0938260f7 -->

Three packages land here, all subtractions from `gtd land`. **`gtd land` now
does strictly less: it never moves HEAD, never formats or validates a steering
file, and its plain output is prose instead of a runnable script.** The suite is
green (`npm test`, exit 0). The risks below are all about what moved out of gtd
and into the driver — and one of those moves has no landing pad.

## Package 1 — the initial-state collapse is gone

`gtd land` used to detect "this commit re-enters the initial state and the
process retained nothing" and emit a retain-history + mixed-reset instead of a
commit. That whole path is deleted, so no emitted script moves HEAD any more.
`settled` now has exactly one shape: a no-op at a `script` rest.

- [x] ./src/Edge.ts#924 — `collapsesWith`, `collapsesToInitialState`,
      `retainsNothing` and `retainHistoryStep` all deleted; `renderDecision` is
      now a pure synchronous function of its arguments with no git read and no
      failure mode
- [x] ./src/Edge.ts#1001 — `planStep` drops from `Effect.gen` to `Effect.sync`
      and no longer pulls `GitService`. Its signature still declares
      `RestRequirements` in the R channel, so callers see no change.
- [x] ./src/program.ts#284 — `planLanding` hardcodes `settled: false` for every
      commit decision
- [x] ./src/Git.ts#65 — `changedPathsSince` removed from the
      `GitReaderOperations` port, with its in-memory double and its whole 7-case
      contract group
- [x] ./src/testing/GitTiers.ts#328 — contract drops from 20 to 19 operations.
      The count in the doc comment was updated to match, which is the thing that
      usually rots here.
- [x] ./src/RetainedHistory.ts#7 — `retainHistory` deleted;
      `refs/worktree/gtd/history` is now written by `gtd abandon` alone
- [x] ./src/workflows/unified.yaml#1176 — `packages.item.closing` gains a `"C"`
      row routing to `$onNext`, so an already-clean sweep proceeds instead of
      stalling. This is a real behavior fix independent of the collapse removal.

**The cost is permanent bookkeeping commits.** A green
`gtd --entry fix-precheck` probe now leaves two commits in the log
(`gtd(human): fix-precheck` and `gtd(check): fix-precheck → idle`) where it
previously left none, and the driver halts at the following `idle` message rest
rather than exiting on `settled`. Four scenarios were rewritten to assert
exactly that — the trade is deliberate and documented, not accidental.

- [x] ./tests/integration/features/fix-entry.feature#26 —
      `commit count increased by 2` replaces `commit count is unchanged`
- [x] ./tests/integration/features/driver-doc.feature#1089 — same flip in the
      doc-tested driver scenario

## Package 2, Requirement A — steering-file format/validate left the landing script

`program.ts`'s `steeringModeSteps` is deleted. The landing script is now the
HEAD assertion plus the commit, nothing else. Formatting and validating a
`file:`+`mode:` steering file is a driver contract, run ahead of `gtd land`.

- [x] ./src/program.ts#209 — `buildRequiredScript` collapses to a single
      `Effect.succeed` over `renderDecision`
- [x] ./src/StepGuards.ts#45 — `deletesFile` un-exported; its
      `steeringModeSteps` caller is gone, and with it the "skip format when the
      diff deletes the file" special case that existed only because
      `prettier --write` exits non-zero on a missing path
- [x] ./docs/configuration.md#443 — states plainly that a driver skipping this
      can land a malformed or unformatted steering file

**Risk, and the sharpest one here: the shipped reference driver never validates
a `capture` beat, so a malformed human gate edit now lands silently.**
`gtd next --json` emits its `validate` field only at a `prompt` rest
(`emitsValidatablePrompt` requires `rendered.kind === "prompt"`), and the
minimal driver runs `$gtd_validate` only inside its `prompt` arm. A human
editing `.gtd/REQUIREMENTS.md` at `design.gate.answer` (mode `qa`) rests at a
`capture` beat: no `validate` field exists there, the driver runs nothing, and
`gtd land` no longer checks. The only tool that catches it is the standalone
`gtd validate`, which nothing in the shipped loop calls.

- [x] ./src/program.ts#550 — `emitsValidatablePrompt`, the gate that makes the
      documented mitigation unavailable at exactly the rests where a human
      hand-edits a mode-carrying file
- [x] ./tests/integration/features/validate.feature#170 — pins the new behavior:
      the malformed `design.gate.answer` edit _lands_, and `gtd validate` run
      separately is what fails. Read this scenario as the specification of the
      gap, not as coverage of it.
- [x] ./docs/configuration.md#446 — says to run it "off `gtd next --json`'s own
      `validate` field (or `gtd validate`)". The parenthetical is the only
      accurate half at a `capture` rest; consider stating that explicitly.
- [x] ./docs/driver.md#280 — the `capture` arm is documented as "the human
      already acted — just land it", unchanged. If the intent is that drivers
      validate capture beats, this loop is the place that has to say so.

Second-order: AGENTS.md's rule that every `.gtd/` file be an oxfmt fixed point
now rests entirely on husky → lint-staged running over the emitted
`git commit`'s staged files. That still holds for _formatting_ — lint-staged
does not care about `mode:`. It does not hold for _validity_, which nothing in
the landing path checks any more.

- [x] ./AGENTS.md#45 — the rewritten "One mechanism" paragraph is accurate about
      what gtd does, but reads as if husky only covers `file:`-without-`mode:`
      states. It covers both; the mode-carrying case just loses validation, not
      formatting.

Six scenarios flip from "refuses" to "lands", each with an inline comment naming
the package. Their titles were rewritten too, so a future reader will not
mistake them for regressions.

- [x] ./tests/integration/features/steering-modes.feature#298 — an invalid
      custom-mode file lands
- [x] ./tests/integration/features/steering-modes.feature#448 — a broken
      `format:` command can no longer block a commit
- [x] ./tests/integration/features/formatting.feature#64 — `gtd validate`
      inserted before `gtd land` in three scenarios; the long line now survives
      the capture
- [x] ./tests/integration/features/review-signoff-format-skip.feature#1 —
      retitled and rewritten; the scenario now proves the removal rather than
      the old skip

## Package 2, Requirement B — plain `gtd land` prints prose, not a script

Plain `gtd land` prints one sentence naming the commit subject. `--json`/`--sh`
carry the byte-identical script they always did.

- [x] ./src/OutcomeScript.ts#33 — `landProseText`; `COLLAPSED_TEXT` deleted
- [x] ./src/program.ts#361 — plain branch prints
      `landProseText(result.subject)`, or `noopText(result.state)` when nothing
      landed
- [x] ./README.md#69 — the quick-start loop switches to `gtd land --sh` +
      `eval` + pipe

**This is a silent breaking change for any existing driver.** `gtd land | sh`
now pipes prose into a shell, which commits nothing and exits 0 — the loop keeps
spinning on an unlanded turn with no error anywhere. Nothing detects the old
form; there is no deprecation warning and no failure mode that points at the
cause. Worth deciding whether this needs a major version bump or a transitional
error.

**Second defect: the prose drops the cost trailer.** `renderDecision` commits
`withCostTrailer(subject, cost, model)`, but the plain path prints
`result.subject` bare. A human following `gtd land --cost=1234`'s instruction
commits a message with no `gtd-cost:` trailer, so `it.processCost` and
`it.processCostByModel` under-count for the whole process — silently, and
unrecoverably once the commit lands.

- [x] ./src/Edge.ts#939 — `commitAll(withCostTrailer(...))`, the trailer the
      script path adds
- [x] ./src/program.ts#364 — `landProseText(result.subject)`, the prose path
      that does not

Doc sync for this requirement is thorough — the flag table's `help` rows, the
pinned `docs/cli.md` block, `gtd install`'s driver protocol text, and
`docs/driver.md`'s four affected paragraphs all moved together.

- [x] ./src/Cli.ts#331 — the `land` row's `details`, pinned equal to
      `docs/cli.md`'s `## Commands` block
- [x] ./src/Install.ts#93 — the header no longer claims gtd spawns a steering
      mode's `format:`/`validate:` subprocess
- [x] ./docs/driver.md#218 — the "prints ONE POSIX sh script" paragraph now
      carves out plain `gtd land` as the exception

## Package 3 — the missing-`C`-row warning

`validateDefinition` returns `{ errors, warnings }` instead of a bare error
array. One warning exists: a non-`prompt`, non-initial, non-`human`-actor state
that declares no `"C"` row. It never fails a load.

- [x] ./src/PatternMachine.ts#756 — `validateHasCRow`, with all three exemptions
      justified in its doc comment. The `human`-actor exemption is the
      non-obvious one and the comment earns it: the driver protocol lands a
      human gate's opening beat on every restart, so a `C` row there would
      author a real commit before the human acted.
- [x] ./src/PatternMachine.ts#797 — the `{ errors, warnings }` return; every
      caller updated
- [x] ./src/PatternConfig.ts#918 — `CompiledWorkflowConfig.warnings`, threaded
      out of `compileWorkflowConfig`
- [x] ./src/Commentary.ts#8 — `Narrator` gains `warn`, ungated by `verbose`, so
      a warning is not suppressed by default output mode
- [x] ./src/workflows/unified.yaml#877 — `build.review.deciding` documents why
      it accepts the warning: a clean tree there means `REVIEW.md` was never
      provisioned, and a `C` row would let it auto-approve an unreviewed round
- [x] ./src/workflows/unified.yaml#1316 — `unwind` documents its own: under
      `set +e`, `git revert --no-commit` leaves a clean tree on both a genuine
      no-op and a hard failure, and advancing would run the baseline check
      against an un-reverted tree

**Defect: two comments in `Config.ts` state the opposite of what the code
does.** The interface JSDoc says warnings are
`"[]" for the built-in default, which ships with none`, and the inline comment
says `the built-in default just happens to pass clean today`. Both are false.
The bundled template emits exactly two warnings — `unwind` and
`build.review.deciding` — and that is pinned in three places. This is the kind
of comment AGENTS.md says to delete rather than leave wrong.

- [x] ./src/Config.ts#46 —
      `"[]" for the built-in default, which ships with none`
- [x] ./src/Config.ts#283 — `just happens to pass clean today`
- [x] ./src/workflows/templates.test.ts#44 — pins the two warnings the comments
      deny exist
- [x] ./docs/configuration.md#436 — documents them correctly, which is what
      makes the comments' disagreement a clear defect rather than a judgment
      call

**Two smaller risks in how the warning is surfaced.** First, `runCommand` adds a
second, unmemoized `ConfigService.load` on every state-needing command purely to
read `.warnings` — extra config file IO per invocation, with a scoped no-op
`Narrator` to suppress the duplicate "config: layer …" narration. The comment
explains the workaround honestly; the cleaner fix is threading warnings out of
`dispatch`'s own load. Second, every `gtd` invocation against the bundled
template now writes two stderr lines, forever, and the reference driver does not
redirect gtd's stderr. `docs/configuration.md` calls the repetition intentional.

- [x] ./src/program.ts#1163 — the extra load, its `Narrator` override, and the
      warning emission
- [x] ./docs/configuration.md#432 — "repeats on every invocation … that
      repetition is intentional, not a bug"

## Test harness — driving `land` off a second `--sh` call

Because plain `gtd land` no longer emits a script, the e2e world drives every
bare `land` through a second, `--sh`-suffixed invocation and shell-unquotes
`gtd_script` out of the document.

- [x] ./tests/integration/support/world.ts#51 — `unquoteShAssignment`, a regex
      reversal of `Sh.ts`'s `shQuote`. It is a second, independent
      implementation of that quoting rule living in the test harness — if
      `shQuote` ever changes, nothing points here.
- [x] ./tests/integration/support/world.ts#278 — `driveLandWrite` invokes gtd
      twice per landing and restores the first call's `lastResult` so scenario
      assertions still describe the invocation they asked for. Sound only
      because plain `gtd land` performs no write; worth a glance to confirm you
      agree it stays that way.
- [x] ./tests/integration/support/steps/common.steps.ts#391 — new
      `stderr contains {string} exactly {int} times` step, which is what proves
      the warning prints once per invocation rather than once per internal load
- [x] ./tests/integration/features/missing-c-row-warning.feature#1 — new
      feature, two scenarios: one custom workflow with one warning, and the
      bundled template's exactly-two
