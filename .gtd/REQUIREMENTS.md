# Unify `gtd next` / `gtd land`: prose by default, `--json=<selector>` for one value

Replace the two structured encodings with **prose output by default and a
`--json` that takes an optional selector**, reducing its own document to one raw
value. A driver reads what it needs with plain command substitution — no `jq`,
no `eval`, no `gtd_`-prefixed variables in the driver's namespace. `--sh` goes;
`--json` stays and grows the selector.

## Answered Questions

### Does `--json` survive, or go away with `--sh`?

It survives and grows an optional selector: `--json` alone keeps emitting
today's full document byte-for-byte, `--json=<selector>` reduces it to a simple
value. This is the human's own answer and it is the cheapest of the three —
every one of the ~200 existing `--json` assertions across 28 e2e feature files
keeps passing untouched, and the structured failure envelope
(`CliPlan.usage.json`) survives.

### How do `gtd land`'s selector flags avoid colliding with its existing `--cost=<n>` / `--model=<name>` inputs?

There is no collision left to avoid. The selector is a value of `--json`, not a
flag name, so `gtd land --json=model` (read the recorded model back) and
`gtd land --model=<name>` (record it) are different tokens. No flag is renamed
and no existing caller changes.

### Is the selector spelled `--json=<sel>` or `--json <sel>`?

`--json=<sel>` only. An optional-value flag that consumed a following token
would have to guess at `gtd land --json --cost=5`, and guessing is the magic
being deleted. A bare `--json` followed by a non-`--` token stays a usage error.

### What is the selector's grammar?

A dotted key path into the JSON document, using the document's own key names
verbatim — `kind`, `content`, `session.id`, `next.target`, `costByModel`. No
`cost-by-model` alias (one vocabulary, no mapping table to drift) and no array
indexing (`changes.0.path` is jq, which is the dependency being removed).

### What does a selector print for each value shape?

A scalar prints raw, unquoted, one line. A boolean prints `true`/`false`. A list
prints one JSON-encoded entry per line. An **absent** optional field prints
nothing and exits 0 — never the string `null`, which is the `jq .file` trap
`src/Install.ts` already warns about. An unknown selector is a usage error,
exit 2.

### At a `prompt` rest, does the no-flag output get a prose wrapper?

No — it stays the bare rendered content plus the self-validation instruction.
Those bytes are the agent's own input and prefixing gtd's bookkeeping onto them
is an existing documented invariant; the workflow template already renders the
"implement feature ..." instruction the sketch asks for.

### At a `script` rest, does the no-flag output stay pipeable into `sh`?

No — it becomes prose ("Run this script: ..."), exactly as the sketch's own
`"run this script ..."` example asks. A driver reads the raw script from
`--json=content` instead, so nothing is lost.

### How does a driver learn `settled`/`idle` without `--sh`, given that running the landing script moves HEAD?

By reading the selectors **before** piping the script to `sh`. `gtd land` itself
never mutates — it only plans and prints — so `gtd land --json=settled` and
`gtd land --json=script` planned against the same untouched tree agree. The
driver's ordering rule: read every value you need first, run the script last.

### Does a selector accept more than one field per invocation?

No — `--json` is non-repeatable and one selector yields exactly one value.
Multi-field output needs a separator convention, which is the parsing being
deleted. A driver wanting three fields calls `gtd next` three times.

### Is the exit code used to carry `settled`, `idle`, or `kind`?

No. `docs/cli.md` already pins exit codes as a uniform 0/1/2 table that is never
data; the selector carries it instead.

## Concerns

### 1. `--json` accepts an optional selector — PRODUCT

`--json` becomes the one machine surface, readable without a parser.

- `gtd next --json` and `gtd land --json` are unchanged — same document, same
  bytes, same key order.
- `gtd next --json=kind` prints `prompt`. `gtd land --json=script | sh` lands a
  turn. `gtd next --json=session.id` reaches the nested field.
- The reduction walks the **already-built** `BeatFields`/`LandFields` object by
  key path. There is no second field table to maintain, so a field added to
  `BeatFields` is selectable the moment it lands — no exhaustiveness guard to
  write and none to lose.
- `src/Cli.ts`'s `FlagRow.arity` is `0 | 1` today, and an `arity: 0` flag given
  `=` is rejected as an unknown option. This needs a **third generic arity
  mode** in the table — optional value, read only from the `=` form, never
  consuming a following token — not a bespoke `if` for `--json`. `Cli.test.ts`'s
  property test forces any flag handled outside the table to a usage error.
- Selector help text lives in the `--json` row, so `renderHelp()` and
  `docs/cli.md`'s pinned `## Commands` block follow for free.

Acceptance: `gtd next --json=kind` prints one bare word; `gtd next --json`
output is byte-identical to before the change; `gtd next --json=label` at a rest
with no `label:` prints nothing and exits 0; `gtd next --json=nope` exits 2;
`gtd next --json kind` exits 2.

Green on its own: nothing is removed, so `--sh` and every existing `--json`
assertion still pass.

**Risk:** the new driver calls `gtd next` once per value instead of once per
beat. `gtd next` is documented no-mutation and poll-safe
(`poll-safety.feature`), so this is correct, but at a `prompt` rest each call
re-renders a full embedded diff — N invocations of the most expensive render in
the system. If the tree is edited between two reads the values disagree; the
driver must not write between reads.

### 2. Prose instruction output as the no-flag default — PRODUCT

Reshape `renderBeatPlain` and `gtd land`'s plain branch into instructions a
human or an agent can act on directly.

- `gtd next` at `script`: prose naming the action, then the script.
- `gtd next` at `capture`: prose saying the edit is already made and `gtd land`
  will land it.
- `gtd next` at `message`: the gate's message, unchanged.
- `gtd next` at `stalled`: the diagnosis, unchanged.
- `gtd next` at `prompt`: bare content, unchanged — see Answered Questions.
- `gtd land`: prose naming what landed **and** pointing at `--json=script`,
  since the script is not reachable without it. Today's plain branch prints only
  a sentence and drops the script on the floor, which is why no driver can use
  it.

Acceptance: `gtd next` at a `script` rest contains the instruction sentence and
the script body; `gtd land` at a real landing names both the commit subject and
the way to get the script.

**Risk:** `next-status-content-parity.feature` pins plain output against `--sh`
output. That pin must be re-expressed against `--json`, not deleted.

### 3. Delete `--sh`, rewrite the reference driver, drop `jq` from the docs — TECHNICAL

One concern, not three: deleting `--sh` without rewriting `docs/driver.md` reds
`driver-doc.feature`, which extracts and **executes** that doc's fenced block.

- Remove the `--sh` flag row, `renderBeatSh`, `renderLandSh`, `BEAT_SH_SHAPE`,
  `LAND_SH_SHAPE`, `src/Sh.ts` and `src/Sh.test.ts`. `src/Sh.ts`'s only non-test
  consumer is `src/Beat.ts`.
- Rewrite the minimal driver: no `eval`, no `unset` preamble, no `gtd_` names —
  just `kind="$(gtd next --json=kind)"` and friends. The prompt still goes to
  the agent **on stdin** (`gtd next | claude -p`) for the same `ARG_MAX` reason
  the doc already documents: roughly 1 MB on macOS, 4 KB POSIX floor, both
  reachable by an ordinary diff. Keep the `session.resume` hint-then-fallback
  dance — `resume` is a HINT, not a contract.
- Update `src/Install.ts`'s driver briefing and its `EDIT_COMMAND` (already
  jq-free, pinned by `Install.test.ts`). Its three `jq` mentions become the
  selector, and `docs/cli.md:262`'s "pipes stdout into `jq`" accepted-cost note
  goes with them.
- Update the 8 feature files touching `--sh`: `command-surface.feature` (13),
  `land.feature` (7), `driver-json-status.feature` (6),
  `next-status-content-parity.feature` (5), `ansi-free-stdout.feature` (4),
  `steering-modes.feature` (4), `tmpdir-and-git-dir.feature` (2),
  `validate.feature` (2).

Acceptance: `gtd next --sh` is a usage error, exit 2; `driver-doc.feature`
passes against the rewritten paste; no file under `src/` or `docs/` mentions
`gtd_` assignments or `jq`.

**Risk:** the doc-tested paste is spawned with only `$PATH` and `$HOME`. Any new
env dependency the rewrite grows is a scenario failure until it gets its own
Prerequisites section.

## Sketch fold-in

Everything the entry commit added is `.gtd/TODO.md` — the sketch, no code. It
maps as: "prose instructions without flags" → concern 2; "dedicated, documented
flags to pull out specific properties (`--kind`, `--content`, `--model`, ...
whatever is necessary)" → concern 1, with the human's answer collapsing that
flag-per-field set into one `--json=<selector>`; "get rid of magic shell
variables" and "get rid of the jq dependency" → concern 3; "make the loops more
straightforward" → concern 3's driver rewrite, where the simplification is
actually observable.
