# Unify `gtd next` / `gtd land`: prose by default, one flag per field

Replace the two structured encodings (`--json`, `--sh`) with **prose output by
default plus one documented flag per field**, so a driver reads what it needs
with plain command substitution and no parser at all — no `jq`, no `eval`, no
`gtd_`-prefixed variables leaking into the driver's own namespace.

## Open Questions

### Does `--json` survive, or go away with `--sh`?

The sketch says "get rid of ... the jq dependency". Deleting `--sh` removes the
magic-variable half outright. `--json` is the other half — but it is also the
**only** structured failure envelope gtd has (`CliPlan.usage.json`, documented
in `docs/cli.md`), and it is the assertion vehicle for **~200 uses across 28 of
the e2e feature files** (`driver-json-status.feature` 54,
`machine-memory.feature` 36, `token-cost.feature` 13, `derived-sessions.feature`
13, `default-workflow.feature` 13, `command-surface.feature` 16, and 22 more).
Deleting it means rewriting essentially the whole integration suite onto
selector flags in one non-green-able step.

- [ ] Keep `--json` — it is the structured surface for non-shell drivers and the
      only machine-readable failure envelope; the sketch's goal is met by making
      the _reference driver_ jq-free, not by deleting the flag. Cheapest, and no
      e2e rewrite.
- [ ] Delete `--json` too — one output surface only (prose + selectors), no JSON
      encoder, no `renderBeatJson`/`renderLandJson`. Costs a full e2e rewrite
      and loses the structured error envelope.
- [ ] _your answer_

### How do `gtd land`'s selector flags avoid colliding with its existing `--cost=<n>` / `--model=<name>` inputs?

`gtd land` already takes `--cost=<n>` and `--model=<name>` as **inputs** (arity
1, recording the finished turn's token cost). The sketch names `--model` as a
**selector** (arity 0). Same name, two arities, one flag table row —
`src/Cli.ts` allows exactly one row per name, and arity-based disambiguation is
precisely the magic being deleted.

- [ ] Rename the selectors on `land` only where they clash — e.g. read the
      recorded values back as `--get cost` / `--get model` is rejected, so use
      `--print-cost` / `--print-model`. Keeps `--cost=<n>` stable for every
      existing caller.
- [ ] Drop `cost`/`model` from `land`'s selector set entirely — a driver that
      just passed `--cost=<n>` in already knows both values, so there is nothing
      to read back. No new names, no collision.
- [ ] _your answer_

## Answered Questions

### At a `prompt` rest, does the no-flag output get a prose wrapper?

No — it stays the bare rendered content (plus the self-validation instruction).
Those bytes are the agent's own input and prefixing gtd's bookkeeping onto them
is an existing documented invariant; the workflow template already renders the
"implement feature ..." instruction the sketch is asking for.

### At a `script` rest, does the no-flag output stay pipeable into `sh`?

No — it becomes prose ("Run this script: ..."), exactly as the sketch's own
`"run this script ..."` example asks. A driver reads the raw script from
`--content` instead, so nothing is lost.

### How does a driver learn `settled`/`idle` without `--sh`, given that running the landing script moves HEAD?

By reading the selectors **before** piping the script to `sh`. `gtd land` itself
never mutates — it only plans and prints — so `gtd land --settled` and
`gtd land --script` planned against the same untouched tree agree. The driver's
ordering rule is therefore: read every flag you need first, run the script last.

### Does a selector accept more than one field per invocation?

No — one selector per invocation, exactly one value on stdout, two selectors is
a usage error. Any multi-field output needs a separator convention, which is the
parsing the sketch is deleting.

### Is the exit code used to carry `settled`, `idle`, or `kind`?

No. `docs/cli.md` already pins exit codes as a uniform 0/1/2 table that is never
data; the selectors carry it instead.

## Concerns

### 1. Field selector flags on `gtd next` and `gtd land` — PRODUCT

One flag per field, printing that field's raw value and nothing else, so a
driver gets every value with plain `$(...)` substitution.

- `gtd next`:
  `--kind --content --idle --session-id --session-resume --model --system --validate --log --state --actor --label --memory --file --mode --edges --changes --next --cost --cost-by-model`
  — the full `BeatFields` set.
- `gtd land`: `--script --settled --idle --state --subject` plus whatever Q2
  settles for `cost`/`model`.
- An **absent** optional field prints nothing and exits 0 — not the string
  `null`, which is the `jq .file` trap `src/Install.ts` already warns about.
- A **boolean** field prints `true`/`false`. A **list** field (`edges`,
  `changes`, `cost-by-model`) prints one entry per line.
- Every selector is a row in `src/Cli.ts`'s flag table, scoped to `next`/`land`,
  conflicting with `--json`/`--sh` and with each other, and its help text lives
  in that row — `renderHelp()` and `docs/cli.md`'s pinned `## Commands` block
  follow for free.

Acceptance: `gtd next --kind` prints `prompt` and nothing else;
`gtd land --script | sh` lands a turn; `gtd next --label` at a rest with no
`label:` prints nothing and exits 0; `gtd next --kind --content` is a usage
error (exit 2).

Green on its own: nothing is removed yet, so `--json`/`--sh` and every existing
assertion still pass.

**Risk:** the new driver calls `gtd next` once per field instead of once per
beat. `gtd next` is documented no-mutation and poll-safe
(`poll-safety.feature`), so this is correct, but at a `prompt` rest each call
re-renders a full embedded diff — N invocations of the most expensive render in
the system. If the tree is edited between two of those calls the values
disagree; the driver must not write between reads.

### 2. Prose instruction output as the no-flag default — PRODUCT

Reshape `renderBeatPlain` and `gtd land`'s plain branch into instructions a
human or an agent can act on directly.

- `gtd next` at `script`: prose naming the action, then the script.
- `gtd next` at `capture`: prose saying the edit is already made and `gtd land`
  will land it.
- `gtd next` at `message`: the gate's message (unchanged).
- `gtd next` at `stalled`: the diagnosis (unchanged).
- `gtd next` at `prompt`: bare content (unchanged — see Answered Questions).
- `gtd land`: prose naming what landed **and** telling the reader to run the
  script, since the script is no longer reachable without a flag. Today's plain
  branch prints only a sentence and drops the script on the floor, which is why
  no driver can use it.

Acceptance: `gtd next` at a `script` rest contains the instruction sentence and
the script body; `gtd land` at a real landing names both the commit subject and
the `--script` flag.

**Risk:** `next-status-content-parity.feature` pins plain output against `--sh`
output. That pin has to be re-expressed against the selectors, not deleted.

### 3. Delete `--sh` and rewrite the reference driver — TECHNICAL

One concern, not two: deleting `--sh` without rewriting `docs/driver.md` reds
`driver-doc.feature`, which extracts and **executes** that doc's fenced block.

- Remove the `--sh` flag row, `renderBeatSh`, `renderLandSh`, `BEAT_SH_SHAPE`,
  `LAND_SH_SHAPE`, `src/Sh.ts` and `src/Sh.test.ts`. `src/Sh.ts`'s only non-test
  consumer is `src/Beat.ts`.
- `ShShapeFor<BeatFields>` is a **compile-time guard** — a field added to
  `BeatFields` with no shape entry is currently a type error. Deleting it
  removes that check; the selector table from concern 1 must carry the same
  exhaustiveness guarantee, or a new field silently gets no way to be read.
- Rewrite the minimal driver: no `eval`, no `unset` preamble, no `gtd_` names.
  The prompt still goes to the agent **on stdin** — `gtd next | claude -p` — for
  the same `ARG_MAX` reason (~1 MB macOS, 4 KB POSIX floor) the doc already
  documents. Keep the `--session-resume` hint-then-fallback dance: `resume` is a
  HINT, not a contract.
- Update `src/Install.ts`'s driver briefing and its `EDIT_COMMAND` (already
  jq-free, pinned by `Install.test.ts`).
- Update the 8 feature files touching `--sh`: `command-surface.feature` (13),
  `land.feature` (7), `driver-json-status.feature` (6),
  `next-status-content-parity.feature` (5), `ansi-free-stdout.feature` (4),
  `steering-modes.feature` (4), `tmpdir-and-git-dir.feature` (2),
  `validate.feature` (2).

Acceptance: `gtd --sh` is a usage error (exit 2); `driver-doc.feature` passes
against the rewritten paste; no file under `src/` or `docs/` mentions `gtd_`
assignments.

**Risk:** the doc-tested paste is spawned with only `$PATH` and `$HOME`. Any new
env dependency the rewrite grows is a scenario failure until it gets its own
Prerequisites section.

### 4. Settle the `--json` surface — PRODUCT

Gated on Q1. If `--json` is kept, this concern is documentation only:
`docs/cli.md` and `src/Install.ts` stop presenting it as the driver path and
present it as the structured surface for non-shell consumers, and the one `jq`
mention in `docs/cli.md:262` goes. If `--json` is deleted, this concern is the
full removal — flag row, `renderBeatJson`, `renderLandJson`, the JSON failure
envelope, and the ~200 assertions across 28 feature files rewritten onto
selectors.

Acceptance depends on the answer, so it is written after Q1 is folded in.

## Sketch fold-in

Everything the entry commit added is `.gtd/TODO.md` — the sketch above, no code.
It maps as: "prose instructions without flags" → concern 2; "dedicated,
documented flags to pull out specific properties (`--kind`, `--content`,
`--model`, ... whatever is necessary)" → concern 1; "get rid of magic shell
variables" → concern 3; "get rid of the jq dependency" → concern 4; "make the
loops more straightforward" → concern 3's driver rewrite, which is where the
simplification is actually observable.
