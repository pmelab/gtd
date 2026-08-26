# Simplify the emitted-script model — technical plan

`gtd land` becomes explainable in one sentence: **"it emits either one commit or
nothing."** Three packages, in order. The no-op landing stays — a clean tree at
a `script`/`message` rest with no `C` row still produces zero commits. **Only
the HEAD-moving case goes away.**

**No package adds a dependency, a CLI flag, a config key, or a turbo task.**
Every one of them is net-negative code.

## Open Questions

### Does `GitOperations.changedPathsSince` get deleted along with the collapse?

`retainsNothing` is its only production caller. Delete the collapse and the port
operation has none — only `src/testing/GitTiers.ts`'s 19-operation contract
still exercises it. fallow's reachability walk starts at `src/main.ts` and finds
the method through `GitService.Live`, so **the `deadcode` task will not flag it
either way** — this is a judgement call, not a forced one.

- [x] Delete it — drop to an 18-operation contract, editing `src/Git.ts`,
      `src/testing/GitDoubles.ts`, `src/testing/GitTiers.ts` and
      `src/testing/InMemRepo.ts`. Package 1 grows by four files; nothing tested
      is uncalled.
- [ ] Keep it — package 1 stays confined to the landing path. The contract keeps
      testing an operation no command calls, ready for the next caller.
- [ ] _your answer_

### How does the e2e harness drive a landing once plain `gtd land` prints prose?

`tests/integration/support/world.ts`'s `driveWriteCommand` runs
`lastResult.stdout` verbatim as the script. **36 feature files invoke
`gtd land`**, so prose on plain stdout breaks every one of them until the
harness reads the script from somewhere else.

- [x] `When I run gtd land` invokes `gtd land --sh` under the hood and drives
      `$gtd_script`; a new explicit step covers the prose assertions. One
      `world.ts` change, and only `land.feature` gains steps — but the phrase "I
      run gtd land" then no longer names the command it runs.
- [ ] Keep `When I run gtd land` literal and add a separate `--sh` step, then
      change every state-advancing scenario to the new step. Scenario text stays
      honest about what it runs, at the price of touching ~36 feature files.
- [ ] _your answer_

### Where does `validateDefinition`'s warning channel go?

`validateDefinition` today returns `readonly string[]` — errors only, merged
into the one thrown load-time error. Package 3 needs warnings that never throw.

- [x] Change the return type to `{ errors, warnings }`. One source of truth for
      every finding, at the cost of editing every call site
      (`src/PatternConfig.ts`, `src/Visualize.ts`, `src/Lsp.ts` and their
      tests).
- [ ] Add a sibling pure function `warnDefinition(def): readonly string[]` in
      the same module. Purely additive — no existing call site changes — but a
      future reader has two places to look for a rule.
- [ ] _your answer_

## Answered Questions

### Should `gtd land` stop emitting the steering-file `format:`/`validate:` commands?

Drop them. `land`'s script becomes nothing but the commit; the driver already
runs `gtd next --json`'s `validate` field in a fix loop before landing, so
validation still happens on the happy path — it just becomes a driver contract
instead of a gtd guarantee.

### Where does the prose form of `gtd land` live?

Plain `gtd land` prints the prose, and the script moves behind `--sh`/`--json`
only. A human running `gtd land` by hand gets an explanation instead of bash;
every driver reads its script from `--sh`/`--json` from then on.

### Where does the missing-`C`-row warning surface?

On stderr, every time a workflow is loaded. The author sees it on the next
command they run, at the price of repeating on every invocation until the
workflow is fixed.

### Does a warning ever go to stdout?

No. stdout stays the machine path on every command — `--json`/`--sh` documents
and the other commands' emitted scripts are all consumed by a program, so a
warning there would be parsed or executed.

### Do `--entry`, `abandon`, `restore` and `validate` also switch to prose?

No. The sketch scopes the prose form to `gtd land`; their plain stdout stays the
script a driver pipes to `sh`.

### Does deleting the collapse also delete `HISTORY_REF`?

No. `gtd abandon` still writes it and `gtd restore` still reads it. The collapse
is only its second writer; removing that makes `restore` purely `abandon`'s
inverse.

### Does `RetainedHistory.ts`'s `retainHistory` helper survive?

No — its only remaining callers are its own tests, and the `deadcode` task would
flag it. Delete it with the collapse.

### Does `LandResult.settled` keep its name once it has one source?

Yes. Renaming it is a breaking change to `--json`/`--sh` and to
`docs/driver.md`'s driver contract for no gain; only its documented meaning
narrows to "a no-op at a `script` rest".

### Does the prose concern wait for the format/validate concern?

Yes. With the format/validate pair gone from the landing script there are never
any pre-commit commands left to number, so the prose is a single sentence.
Building concern 3 after concern 2 means writing it once.

### Does deleting the collapse change `src/testing/EmittedScriptRecognizer.ts`?

No — and the requirements' blast-radius list is **wrong** on this point.
`runAbandonCommand` (`program.ts:487-490`) emits the identical
`updateRef(HISTORY_REF, tip)` + `mixedResetTo(startParentHash)` pair, so both
recognizer branches keep a live production caller. Touching them would red
`abandon.feature`.

### Does `renderDecision` stay an Effect over `GitOperations`?

No. The collapse branch held its only two git reads (`resolveRef` and
`retainsNothing`'s `changedPathsSince`); what remains is `commitAll` over an
already-rendered subject, a pure string build. It becomes a plain function
`(rest, decision, cost, model) => readonly EmitStep[]`, and `buildStepScripts`'s
`Effect.catchAll` render-failure fallback goes with it — with no git call and no
template render left, there is no failure mode to catch. Leaving an unused `git`
parameter behind would be dead weight, so this is part of package 1, not a
follow-up.

### Which module owns the prose sentence?

`src/OutcomeScript.ts`, as a `landProseText(subject)` formatter beside the
existing `FMT_*` siblings. Its neighbours are already ANSI-free and
format-pinned, which is exactly what `ansi-free-stdout.feature` asserts about
plain stdout.

### What does plain `gtd land` print for a no-op or a refusal?

The no-op prints its existing `noopText(state)` line — the same text the outcome
block prints today, so nothing new is authored for that branch. A refusal is
unchanged: `Cli.ts`'s envelope writes it to stderr with exit 1, and stdout stays
byte-empty.

### Where is the missing-`C`-row warning emitted?

`program.ts`'s `runCommand`, inside the block that already runs exactly once per
invocation when `needsOf(kind) === "state"`. **`ConfigService.load` is not
memoized** — it re-runs on every `yield*`, and a single `gtd land` loads config
several times, so warning there would print duplicates and force a dedupe set.
`runCommand` needs neither. Consequence to accept: `gtd visualize`
(`needsOf: "config"`) and `gtd lsp` (`"none"`) print no warning.

### Does `gtd lsp` surface the missing-`C`-row warning as a diagnostic?

No. `lsp` diagnoses steering-file contents against a mode's parser; it never
loads a workflow definition (`needsOf: "none"`). The warning is CLI-only.

### Does dropping `steeringModeSteps` lose the unknown-mode-name refusal?

No. A state whose `mode:` names no entry in the workflow's own `modes:` map is
already a `validateDefinition` finding, thrown at load time before any command
reaches the landing path. `steeringModeSteps`'s own `unknownModeMessage` failure
was unreachable defence.

### How is `--json`/`--sh`'s `script` proven byte-identical across package 2?

A unit test in `src/program.test.ts` pins one rest's `--json` `script` field
against the string the commit steps produce, asserted independently of
`runLandCommand`'s plain branch. Prose and script then cannot drift into each
other.

## Merged Concerns

Requirements concerns 2 and 3 merge into **package 2**. Both center on the same
three functions in `src/program.ts`'s landing region (`steeringModeSteps`,
`buildRequiredScript`, `runLandCommand`), the same `Cli.ts` help row, the same
`docs/cli.md`/`docs/driver.md` blocks and the same `land.feature`. Concern 3
does not merely consume an interface concern 2 creates — it rewrites the output
of the very function concern 2 shortens, so shipping them apart means writing
the prose branch twice. Both requirements carried verbatim below.

### Merged: requirements concern 2 — The landing script is only the commit

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

### Merged: requirements concern 3 — Plain `gtd land` explains itself

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

## Packages

### Package 1 — `gtd land` never moves HEAD

**What goes:** every piece of the initial-state collapse, and the git reads it
was the only reason for.

`src/Edge.ts` — delete `collapsesWith`, `collapsesToInitialState`,
`retainHistoryStep` and `retainsNothing`; delete `renderDecision`'s collapse
branch, leaving
`[{ kind: "gitWrite", command: commitAll(...) }, commitDecisionOutcome(decision)]`
as its whole body. `renderDecision` then loses its `git` parameter and its
`Effect` wrapper (see the answered question above), and `buildStepScripts` loses
its `Effect.catchAll`. `EMPTY_TREE` stays — line 377 still needs it for
`startParentHash`.

`src/program.ts` — `planLanding`'s commit branch sets `settled: false` outright
instead of awaiting `collapsesToInitialState`; `buildRequiredScript` drops its
`GitService` yield. `LandResult.settled`'s doc comment narrows to the one shape.

`src/RetainedHistory.ts` — delete `retainHistory`. `HISTORY_REF`,
`readRetainedHistory`, `restorability` and `clearRetainedHistory` all stay:
`abandon`/`restore` are untouched.

`src/OutcomeScript.ts` — delete `COLLAPSED_TEXT` (Edge.ts was its only caller).

**Data model:** no type changes. `StepPlan`, `LandResult` and `EmittedScripts`
keep their shapes; only `settled`'s documented meaning narrows.

**Error handling:** strictly fewer failure modes. Two git reads leave the
landing path, and `renderDecision` becomes total. Nothing new can fail.

**Library choices:** none. This package only deletes.

**Primary paths:** `src/Edge.ts`, `src/program.ts`, `src/RetainedHistory.ts`,
`src/OutcomeScript.ts` — plus `src/Install.ts`'s briefing (the `settled` "two
shapes" line at 186), `AGENTS.md`'s `collapsesWith` paragraph,
`docs/configuration.md`, `docs/driver.md:519`, and the tests:
`src/Edge.test.ts`, `src/program.test.ts`, `src/RetainedHistory.test.ts`,
`src/OutcomeScript.test.ts`, and `land.feature`, `retained-history.feature`,
`smoke.feature`, `fix-entry.feature`, `driver-doc.feature`,
`driver-json-status.feature`, `machine-memory.feature`, `summary.feature`,
`deciding-signoff.feature`. Explicitly NOT
`src/testing/EmittedScriptRecognizer.ts` (see above), and NOT `abandon.feature`.

**The prices, stated plainly and not to be traded away:**

- `gtd --entry fix-precheck` against a green suite leaves **two commits** in the
  log instead of none. That is accepted, not a regression to fix later.
- `LandResult.settled` loses one of its two sources. It now means only "a no-op
  at a `script` rest" — `Edge.ts`'s `noOpSettles` becomes its sole decider.
- `HISTORY_REF` loses its second writer; `restore` becomes purely `abandon`'s
  inverse.

**Acceptance:** an e2e scenario entering `fix-precheck` against a green suite
ends with the entry commit and the probe commit both present in the log, and
`gtd land --json` reporting `settled: false`. Today the same scenario ends at
the process start hash with nothing in the log.

### Package 2 — The landing script is only the commit, and plain `gtd land` explains itself

**What goes:** `steeringModeSteps` in `src/program.ts`, whole. What lands in its
place is prose on plain stdout.

`src/program.ts` — `buildRequiredScript` collapses to
`emitScripts(headPreconditions(...), renderDecision(...)).required`; its
`isAttemptDecision` skip disappears with the steps it was skipping (an attempt
and an ordinary commit now emit the same shape). `runLandCommand`'s else-branch
writes `landProseText(result.subject)` instead of `result.script`. `deletesFile`
keeps its `StepGuards.ts` caller, so it stays. `resolveSelfValidateCommand`,
`renderSteeringModeCommandSteps` and `fixPromptInstruction` all stay —
`gtd next --json`'s `validate` field is built from them and is untouched.

`src/OutcomeScript.ts` — add `landProseText(subject)`, one `FMT_*`-style
formatter: `commit everything with this message: <subject>`, newline-terminated,
ANSI-free.

`src/Cli.ts` — rewrite the `land` command row's `details`: plain output is the
prose, `--json`/`--sh` carry the script. No flag row is added, so the flag table
and its property test are untouched.

**Data model:** no type changes. `LandResult` keeps `script`; plain output stops
reading it, `--json`/`--sh` keep it byte-identical.

**Error handling:** one failure mode leaves the landing path —
`steeringModeSteps`'s `unknownModeMessage` refusal, already unreachable behind
`validateDefinition`'s load-time check. The `set -euo pipefail` abort risk that
`deletesFile` and the working-tree-absence check existed to dodge disappears
with the commands themselves.

**Library choices:** none.

**Primary paths:** `src/program.ts`, `src/OutcomeScript.ts`, `src/Cli.ts` — plus
`docs/cli.md`'s `## Commands` block (pinned equal to `renderHelp()`),
`docs/driver.md` (the two `gtd land | sh` mentions at 230 and 317),
`src/Install.ts`'s briefing, and `tests/integration/support/world.ts` (whichever
shape the harness open question settles on). Tests: `src/program.test.ts`,
`src/Cli.test.ts`, `src/OutcomeScript.test.ts`, `land.feature`,
`steering-modes.feature`, `review-signoff-format-skip.feature`,
`formatting.feature`, `styled-steering.feature`, `ansi-free-stdout.feature`.

**The risk, in one line: a driver that skips `gtd next --json`'s `validate`
field can now commit a malformed `.gtd/REVIEW.md`, and the review loop deadlocks
on it** — not the agent, the loop.

### Package 3 — Warn on a missing `C` row

`validateDefinition` has no warning channel at all today; this package adds the
channel and its first warning together.

**The rule (pure, in `src/PatternMachine.ts`):** a state warns when it declares
no `C` row, its content kind is not `prompt`, and it is not the workflow's
initial state. Both exclusions are load-bearing: a `prompt` state's clean step
is an ATTEMPT by design, and a `C` row on the initial state would author a
commit on every bare driver invocation.

**The channel (`src/Commentary.ts`):** add `warn` to the `Narrator` service,
written to the same stderr sink **ungated** — unlike `narrate`, it ignores the
`verbose` flag the layer was built with. One method on a service every command
path already has in context, rather than a second service and a second layer
wiring. `@inmem` e2e scenarios capture it in the buffer they already capture
narration and errors into.

**The emission site (`src/program.ts`):** `runCommand`'s existing
`needsOf(kind) === "state"` block, one line per warning, ahead of `dispatch`.
Exactly once per invocation, no dedupe needed.

**Data model:** one new `Narrator` method; the warning itself is a plain string,
like every `validateDefinition` finding.

**Error handling: never an error.** The no-op is a legitimate authoring choice,
so this surfaces the decision — it does not force one. Exit code stays 0 and
stdout stays byte-clean.

**Library choices:** none.

**Primary paths:** `src/PatternMachine.ts`, `src/Commentary.ts`,
`src/program.ts` — plus tests: `src/PatternMachine.test.ts`,
`src/program.test.ts`, a `Commentary` test for the ungated write, and one new
e2e feature (a workflow whose non-initial `script` state declares no `C` row).
No `turbo.json` task, no `inputs` change, no `src/Cli.ts` edit.

**Acceptance:** a workflow whose non-initial `script` state declares no `C` row
loads successfully, exits 0, prints one warning naming that state on stderr and
nothing extra on stdout; the bundled `unified.yaml` produces none.

## Out of scope

The three things that keep `land`'s emitted script a script rather than a bare
`git commit`, and are not up for removal: **the `expectedHead` assertion, the
`index.lock` retry, and the empty-commit hook fallback** (`--allow-empty`, then
`--no-verify` on a hook rejection).

Also unchanged: **calling `land` is itself the assertion that a beat was
dispatched** — that is what the empty attempt commit records and `stalledAt`
reads.
