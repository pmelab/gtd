# Simplify the emitted-script model

Goal: `gtd land` becomes explainable in one sentence — **"it emits either one
commit or nothing."** Four independent concerns, each landable alone, each
leaving the suite green on its own.

The no-op landing stays. A clean tree at a `script`/`message` rest with no `C`
row must still produce zero commits — that is what makes a bare driver
invocation on a clean repo do nothing, and `idle` depends on it. **Only the
HEAD-moving case goes away.**

## Open Questions

### Should `gtd land` stop emitting the steering-file `format:`/`validate:` commands?

- [x] Drop them — `land`'s script becomes nothing but the commit. The driver
      already runs `gtd next --json`'s `validate` field in a fix loop before
      landing, so validation still happens on the happy path; it just becomes a
      driver contract instead of a gtd guarantee.
- [ ] Keep them — a malformed steering file must be unlandable regardless of
      which driver is running, so the format/validate pair stays inside the
      landing script and `land` stays a script rather than a sentence.
- [ ] _your answer_

### Where does the prose form of `gtd land` live?

- [ ] A new flag (`gtd land --prose`) — plain `gtd land` keeps printing the
      script verbatim, so `gtd land | sh`, `docs/driver.md`'s doc-tested minimal
      driver, and every existing driver keep working untouched.
- [x] Plain `gtd land` prints prose and the script moves behind `--sh`/`--json`
      only — a human running `gtd land` by hand gets an explanation instead of
      bash, at the price of a breaking change to every piping driver.
- [ ] _your answer_

### Where does the missing-`C`-row warning surface?

- [x] On stderr, every time a workflow is loaded — the author sees it on the
      next command they run, at the price of repeating on every invocation until
      the workflow is fixed.
- [ ] Only through `gtd lsp` diagnostics on the workflow file — zero CLI noise,
      surfaced where the author is editing, but invisible to anyone who never
      opens an editor.
- [ ] _your answer_

## Answered Questions

### Does a warning ever go to stdout?

No. stdout stays the machine path on every command — plain `gtd land`'s stdout
is piped to `sh`, so a warning there would be executed as bash.

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

Yes. The prose form has to name "any remaining pre-commit commands" — if the
format/validate pair leaves the landing script, there are none and the prose is
one line. Build it after that question is resolved so it is written once.

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

PRODUCT — see the first open question.

Drop `steeringModeSteps` from `program.ts`'s `buildRequiredScript`, so the
emitted `required` script is the HEAD assertion plus the commit and nothing
else. **This is the only concern that trades away correctness rather than log
noise:** the steering-file format and validation stop being a gtd guarantee and
become a driver contract, biting only if the driver actually ran
`gtd next --json`'s `validate` field first. The four `enforceStepGuards` guards
are unaffected — they run inside `planLanding`, not in the emitted script, so a
malformed review doc is still refused.

Acceptance: at a rest declaring `file:` + `mode:` with a dirty steering file,
`gtd land`'s emitted script contains no `oxfmt`/`prettier`/`gtd check`
invocation — only the commit. Today it contains the mode's pair ahead of the
commit.

If the answer is "keep them", this concern disappears entirely rather than
shrinking, and concern 3's prose has to keep naming numbered pre-commit steps.

### 3. A prose form of `gtd land`

PRODUCT — see the second open question.

`land --json` already carries `subject`, so nothing new has to be computed.
Print "commit everything with this message: …" plus any remaining pre-commit
commands as numbered steps. **Free — it cannot regress anything**, because the
`script` field in `--json`/`--sh` stays byte-identical and stays the machine
path.

`src/Cli.ts` owns the whole shell: a new flag is one row in the flag table with
its own `help`, never a new `if`, and `docs/cli.md`'s `## Commands` block is
pinned equal to `renderHelp()`'s output — so the doc update lands in the same
concern.

Acceptance: at a rest with a pending diff, the prose output names the commit
subject in a sentence a human can follow, and the same invocation's `--json`
`script` field is unchanged from before the concern.

### 4. Warn on a missing `C` row

PRODUCT — see the third open question.

`validateDefinition` currently has no warning channel at all; every finding it
returns is merged into the one error `compileWorkflowConfig` throws at load
time. So this concern adds the channel and its first warning together: a
non-`prompt`, non-initial state that declares no `C` row.

- **Never a load-time error.** The no-op is a legitimate authoring choice, so
  this surfaces the decision — it does not force one.
- **Exempt the workflow's initial state explicitly.** A `C` row there would
  author a commit on every bare driver invocation.
- Usually the omission is an oversight rather than a decision, and AGENTS.md
  already asks authors to make that call explicitly when adding a state.

Acceptance: a workflow whose non-initial `script` state declares no `C` row
loads successfully and produces one warning naming that state; the bundled
`unified.yaml` produces none.

## Out of scope

The three things that keep `land` a script rather than a sentence, and are not
up for removal: **the `expectedHead` assertion, the `index.lock` retry, and the
empty-commit hook fallback** (`--allow-empty`, then `--no-verify` on a hook
rejection).

Also unchanged: **calling `land` is itself the assertion that a beat was
dispatched** — that is what the empty attempt commit records and `stalledAt`
reads.
