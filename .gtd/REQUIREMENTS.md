# Simplify the emitted-script model

Goal: `gtd land` becomes explainable in one sentence — **"it emits either one
commit or nothing."** Four independent concerns, each landable alone, each
leaving the suite green on its own.

The no-op landing stays. A clean tree at a `script`/`message` rest with no `C`
row must still produce zero commits — that is what makes a bare driver
invocation on a clean repo do nothing, and `idle` depends on it. **Only the
HEAD-moving case goes away.**

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

## Concerns

### 1. `gtd land` never moves HEAD

PRODUCT — settled by the sketch, no question.

Remove the initial-state collapse: `collapsesWith`, `collapsesToInitialState`,
and `retainHistoryStep` in `src/Edge.ts`, plus the `mixedResetTo` branch in
`renderDecision`. A process re-entering the initial state having retained
nothing lands **an ordinary commit instead of rewinding**.

The prices, stated plainly and not to be traded away:

- `gtd --entry fix-precheck` against a green suite leaves **two commits** in the
  log instead of none. That is accepted, not a regression to fix later.
- `LandResult.settled` loses one of its two sources. It now means only "a no-op
  at a `script` rest" — `Edge.ts`'s `noOpSettles` becomes its sole decider, and
  `program.ts`'s `planLanding` no longer asks git anything to fill it.
- `HISTORY_REF` loses its second writer; `restore` becomes purely `abandon`'s
  inverse.

Acceptance: an e2e scenario entering `fix-precheck` against a green suite ends
with the entry commit and the probe commit both present in the log, and
`gtd land --json` reporting `settled: false`. Today the same scenario ends at
the process start hash with nothing in the log.

Blast radius to carry in the same concern, because each one reds the suite on
its own: `src/Install.ts`'s briefing text about `settled`'s two shapes,
`src/testing/EmittedScriptRecognizer.ts`'s mixed-reset recognition, AGENTS.md's
`collapsesWith` paragraph, `docs/configuration.md`, and the e2e features that
assert the collapse — `land.feature`, `retained-history.feature`,
`smoke.feature`, `fix-entry.feature`, `driver-doc.feature`,
`driver-json-status.feature`, `machine-memory.feature`, `summary.feature`,
`deciding-signoff.feature`.

### 2. The landing script is only the commit

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

### 3. Plain `gtd land` explains itself

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

### 4. Warn on a missing `C` row

PRODUCT — resolved: warnings go to stderr on every workflow load.

`validateDefinition` currently has no warning channel at all; every finding it
returns is merged into the one error `compileWorkflowConfig` throws at load
time. So this concern adds the channel and its first warning together: a
non-`prompt`, non-initial state that declares no `C` row.

- **Never a load-time error.** The no-op is a legitimate authoring choice, so
  this surfaces the decision — it does not force one.
- **Exempt the workflow's initial state explicitly.** A `C` row there would
  author a commit on every bare driver invocation.
- **Every warning goes to stderr, never stdout**, on every command that loads a
  workflow — which is every command whose `needsOf` is `"state"`. It repeats on
  every invocation until the workflow is fixed; that noise is accepted.
- Usually the omission is an oversight rather than a decision, and AGENTS.md
  already asks authors to make that call explicitly when adding a state.

Acceptance: a workflow whose non-initial `script` state declares no `C` row
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
