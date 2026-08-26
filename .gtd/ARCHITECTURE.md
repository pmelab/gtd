# Unify `gtd next` / `gtd land`: prose by default, `--json=<selector>` for one value

Two packages. **Package 1 adds the whole new output surface additively — the
`--json=<selector>` reduction and the prose default — removing nothing.**
**Package 2 deletes `--sh`, `src/Sh.ts` and every `jq` mention, and rewrites the
reference driver on top of the surface package 1 built.**

Package 2 consumes package 1's interface and cannot land first: the driver
rewrite has no `--json=kind` to read until package 1 ships, and
`driver-doc.feature` executes that doc's paste for real.

## Package 1 — `--json=<selector>` and the prose default

Merged from concerns 1 and 2 (see `## Merged Concerns`). Both center on
`src/Cli.ts`, `src/Beat.ts` and `src/program.ts`; concern 2's `gtd land` prose
also has to name `--json=script`, which concern 1 creates.

### Primary paths

- `src/Select.ts` (new), `src/Select.test.ts` (new)
- `src/Cli.ts` — the flag table's third arity mode, the `--json` row's help
- `src/Beat.ts` — `renderBeatPlain`, new `renderLandPlain`
- `src/program.ts` — `runNextCommand`, `runLandCommand`
- `docs/cli.md` — the pinned `## Commands` block follows `renderHelp()`
- `tests/integration/features/json-selector.feature` (new)

### `src/Select.ts` — a zero-import pure leaf

It takes over the tier `src/Sh.ts` occupies today and keeps that tier's rule:
**no imports, no IO, total functions.** One export.

```
export type Selection =
  | { readonly kind: "value"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown"; readonly path: string }

export const selectPath = (fields: unknown, path: string): Selection
```

Rendering per the settled grammar: a scalar prints raw and unquoted on one line;
a boolean prints `true` or `false`; a list prints one `JSON.stringify` per
entry, one per line; `absent` prints nothing. `text` never carries a trailing
newline — `program.ts` adds exactly one, and `absent` writes zero bytes.

Path splitting is a plain `.split(".")`. No array indexing, no alias table — a
segment that is all digits is an ordinary key name and will simply be unknown.

**Descending into an absent parent yields `absent`, not `unknown`, for the whole
remaining path.** `--json=session.id` at a `script` rest prints nothing and
exits 0; it does not try to prove `id` is a real key of a `session` that is not
there. Document this in the `--json` row's help.

**Absent and unknown are told apart by whether the key is PRESENT with an
`undefined` value.** `beatFields`/`landFields` stop omitting absent optionals
and assign `undefined` instead: `label?: string` becomes
`label: string | undefined`, the idiom `NextMatch.action` already uses under
`exactOptionalPropertyTypes`. Both builders lose their spread-conditionals in
favour of plain assignments. **`JSON.stringify` drops `undefined`-valued keys,
so `gtd next --json`'s bytes and key order are unchanged** — the byte-identical
acceptance criterion holds without a golden-file exception. `selectPath` then
reads a present key as `absent` and a missing key as `unknown`.

**Risk: the relaxed types no longer make omission visible in a signature.**
`label: string | undefined` reads as "always there, sometimes empty", which is
the opposite of the wire truth. Every one of `BeatFields`' optional fields —
`session`, `model`, `system`, `validate`, `label`, `memory`, `file`, `mode`,
`edges`, `cost`, `costByModel` — and `LandFields`' `subject`/`cost`/`model`
needs its doc comment to say the key is dropped from the JSON when `undefined`,
or the next reader adds a field with `?:` and silently makes it unselectable.

**`beatFields`' two conditional gates survive the rewrite as explicit
`undefined`s, not as dropped keys.** `session`/`validate` are still forced to
`undefined` unless `kind === "prompt"`, and `system` is still `undefined` when
its rendered value is the empty string — an empty `--system-prompt ""` would
silently delete the harness's own default instead of failing loudly. Turning
those into unconditional assignments is the one way this refactor changes
behaviour.

### `src/Cli.ts` — a third generic arity mode

`FlagRow.arity` widens from `0 | 1` to `0 | 1 | "optional"`. The tokenizer gains
one branch, not a bespoke `--json` check:

- `"optional"` with an `=`: the right-hand side is the raw value. An empty
  right-hand side (`--json=`) is a usage error, same message shape as
  `arity: 1`.
- `"optional"` with no `=`: records presence with no value and **never consumes
  the following token**. `gtd next --json kind` therefore parses `kind` as a
  positional, which `gtd next`'s `arity: "none"` rejects — exit 2, as pinned.

`CliPlan`'s command variant replaces `readonly json: boolean` with:

```
export type JsonMode =
  | { readonly kind: "off" }
  | { readonly kind: "document" }
  | { readonly kind: "select"; readonly path: string }
```

**`CliPlan.usage.json` stays a plain boolean** — the structured failure envelope
is orthogonal to the selector and the requirement pins it as surviving. The
tokenizer's existing `jsonSeen` flag already feeds it and needs no change.

The `--sh` row's `conflicts: ["--json"]` keeps working unchanged: conflicts are
checked on `present`, which is arity-blind. Package 1 removes nothing.

`decode` for `--json` returns the raw selector string. Help text for the
selector lives in the `--json` row's own `help` array, so `renderHelp()` and
`docs/cli.md`'s pinned block follow for free.

### `src/program.ts` — dispatch on the mode

`runNextCommand` and `runLandCommand` take `json: JsonMode` instead of a boolean
and branch three ways. The `select` branch runs **after** the fields object is
fully built, so it reduces the same document `document` would print — there is
no second gathering path and no shortcut that could skip a field's computation
and make the two disagree.

`unknown` maps to the existing usage-error path: exit 2 via `ExitCodes.ts`'s
usage code, message on stderr, nothing on stdout. `absent` writes nothing and
falls through to the normal `EXIT_OK`.

**A selector never changes what gets computed, only what gets printed.** Keep it
that way — a lazy `content` would break `gtd next --json=kind`'s claim to be the
same document.

### Prose default — `src/Beat.ts`

`renderBeatPlain` gains a per-kind instruction line ahead of the existing header
block. The instruction is a plain string constant per kind in `Beat.ts`, not a
template — no `PatternTemplates.ts` involvement, no render that can throw.

- `script`: `Run this script:` then the header block then the script body.
- `capture`: prose stating the edit is already made and `gtd land` will land it.
- `message` and `stalled`: unchanged, byte for byte.
- `prompt`: unchanged — bare content plus the self-validation instruction. The
  early return already in `renderBeatPlain` guarantees this; do not move the
  instruction above it.

New `renderLandPlain(fields: LandFields): string` replaces `program.ts`'s inline
`landProseText`/`noopText` branch. It names the commit subject (or the no-op)
**and** points at `gtd land --json=script`, because the script is unreachable
from plain output. `landProseText`/`noopText` move into `Beat.ts` alongside it
so `program.ts` holds no output prose at all.

### Error handling

No new failure mode. An unknown selector is a usage error decided in
`program.ts` after a total, non-throwing `selectPath` — `src/Select.ts` never
throws, so a malformed path cannot escape as an unhandled `Error` and be
reported as a gtd crash.

The self-validation-command resolution in `runNextCommand` stays
`Effect.catchAll`-degraded and stays on the plain branch only.

### Test plumbing

`json-selector.feature` is a new `@inmem` feature file. Per `AGENTS.md`, add no
new npm script or `turbo.json` task — it runs under the existing e2e task.
Compose from the existing `Given the workflow` steps; write no one-off setup
step.

Scenarios: `--json=kind` prints one bare word; `--json` output is byte-identical
to a golden document; `--json=session.id` reaches the nested field;
`--json=label` at a rest with no label prints nothing, exit 0; `--json=changes`
prints one JSON object per line; `--json=idle` prints `true`; `--json=nope`
exits 2; `--json kind` exits 2; `--json=` exits 2; `gtd land --json=script | sh`
lands a turn; `gtd land --json=model` and `gtd land --model=<name>` do not
collide.

`src/Select.test.ts` covers the walk directly — value shapes, absent parent,
unknown key, digit segments.

**Risk: the new driver calls `gtd next` once per value instead of once per
beat.** `gtd next` is documented no-mutation and poll-safe
(`poll-safety.feature`), so this is correct, but at a `prompt` rest each call
re-renders a full embedded diff — N invocations of the most expensive render in
the system. **If the tree is edited between two reads the values disagree; the
driver must not write between reads.**

**Risk: `next-status-content-parity.feature` pins plain output against `--sh`
output.** Package 1 changes plain output, so that pin breaks in package 1 and
must be re-expressed against `--json` there — not deferred to package 2 and not
deleted.

## Package 2 — delete `--sh`, rewrite the driver, drop `jq`

Concern 3 verbatim in scope. **This is one package, not three: deleting `--sh`
without rewriting `docs/driver.md` reds `driver-doc.feature`, which extracts and
executes that doc's fenced block.**

### Primary paths

- `src/Sh.ts`, `src/Sh.test.ts` — deleted outright
- `src/Beat.ts` — `renderBeatSh`, `renderLandSh`, `BEAT_SH_SHAPE`,
  `LAND_SH_SHAPE` and the `./Sh.js` import deleted
- `src/Cli.ts` — the `--sh` row deleted; the `--json` row's
  `conflicts: ["--sh"]` deleted with it
- `src/program.ts` — the `sh` parameter and both `else if (sh)` branches deleted
- `src/Install.ts` — the driver briefing and `EDIT_COMMAND`; three `jq` mentions
- `docs/driver.md` — the minimal-driver paste and its line-by-line walkthrough
- `docs/cli.md:262` — the "pipes stdout into `jq`" accepted-cost note
- 8 feature files: `command-surface.feature` (13 hits), `land.feature` (7),
  `driver-json-status.feature` (6), `next-status-content-parity.feature` (5),
  `steering-modes.feature` (4), `ansi-free-stdout.feature` (4),
  `tmpdir-and-git-dir.feature` (2), `validate.feature` (2)

### Deletion order

`src/Sh.ts`'s only non-test consumer is `src/Beat.ts`. Delete inside-out —
`Beat.ts`'s four exports first, then `Sh.ts`/`Sh.test.ts`, then the `Cli.ts`
row, then `program.ts`'s parameters — so the type checker names every remaining
reference instead of leaving a dangling import.

`gtd next --sh` becomes a bare unknown-option usage error, exit 2. **No removed-
flag message table is added**: `Cli.test.ts`'s property test already forces
every unrecognized `--` token to a usage error, and the migration note belongs
in `docs/cli.md` and `renderHelp()`'s `--json` row, not in a new `if`.

### The rewritten driver

No `eval`, no `unset` preamble, no `gtd_` names. Each value is one command
substitution:

```
kind="$(gtd next --json=kind)"
idle="$(gtd next --json=idle)"
```

Four things the rewrite must keep, each of which is a live failure if dropped:

- **The prompt goes to the agent on stdin.** `gtd next | claude -p` — argv is
  capped at roughly 1 MB on macOS and a POSIX floor of 4 KB (`ARG_MAX`), both
  reachable by an ordinary diff. At a `prompt` rest the no-flag output is the
  bare content, so the pipe needs no selector and costs no extra render.
- **The `session.resume` hint-then-fallback dance.** `resume` is a HINT derived
  from history, never a contract; try the hinted flag, fall back to the other.
- **Read every value before piping the landing script to `sh`.** `gtd land`
  itself never mutates, so `--json=settled` and `--json=script` planned against
  the same untouched tree agree — the ordering rule is what keeps them agreeing.
- **Absent optionals stay `${var:-}` / `${var:+...}`-guarded.** An absent field
  now prints an empty string rather than leaving the variable unset, so `set -u`
  no longer aborts — but the empty-vs-absent distinction still decides whether
  `--model` is passed at all, and an unguarded `--model ""` would silently
  override the harness default.

**Rewrite the line-by-line walkthrough below the fence too.** Every `eval`,
`unset`-preamble and `gtd_`-name sentence in it is now false prose sitting next
to correct code.

### Feature-file migration

`next-status-content-parity.feature`'s five `--sh` hits are re-expressed against
`--json` in package 1, not here. The remaining seven files are mechanical: drop
`--sh`-only scenarios, convert `--sh`-then-assert scenarios to the equivalent
selector read. `command-surface.feature` gains the `gtd next --sh` → exit 2
scenario.

### Error handling

Nothing new. Deletion only, plus one usage error that already had a code path.

Acceptance: `gtd next --sh` is a usage error, exit 2; `driver-doc.feature`
passes against the rewritten paste; **no file under `src/` or `docs/` mentions
`gtd_` assignments or `jq`** — verify with `grep -rn 'gtd_\|jq' src docs`, not
by reading.

**Risk: the doc-tested paste is spawned with only `$PATH` and `$HOME`.** Any new
env dependency the rewrite grows is a scenario failure until it gets its own
Prerequisites section in `docs/driver.md`.

**Risk: `docs/driver.md`'s heading text and single fence are load-bearing.**
`tests/integration/helpers/driver-doc.ts` extracts the block verbatim by the
`A complete minimal driver` heading and one fence — renaming the heading or
splitting the paste across two fences fails extraction, and reads as a driver
bug rather than a doc edit.

## Merged Concerns

Concerns 1 and 2 merged into package 1. Both center on `src/Cli.ts`,
`src/Beat.ts` and `src/program.ts`, and concern 2's `gtd land` prose has to name
`--json=script` — a value concern 1 creates. Splitting them would ship a
`gtd land` plain branch pointing at a flag that does not exist yet. Both
requirements are carried verbatim below so the per-package spec review still
covers each independently.

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

## Answered Questions

### How does the selector tell an ABSENT optional field apart from an UNKNOWN key, when `beatFields` omits absent optionals from the object entirely?

Every optional key is made explicitly present with an `undefined` value:
`label?: string` becomes `label: string | undefined`, and
`beatFields`/`landFields`' spread-conditionals become plain assignments.
`JSON.stringify` drops `undefined`-valued keys, so `gtd next --json`'s bytes and
key order are unchanged. A present key reads as absent, a missing key as
unknown. No key table is introduced, so nothing can drift out of sync with
`BeatFields`.

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

### Where does the selector walk live?

A new zero-import pure leaf, `src/Select.ts`, taking over the tier `src/Sh.ts`
vacates in package 2. Keeping it out of `Beat.ts` means the walk has no access
to `RenderedRest` types and cannot grow a field-specific special case.

### How does `JsonMode` reach the command handlers without breaking the usage envelope?

`CliPlan`'s command variant carries a `JsonMode` union; `CliPlan.usage.json`
stays a boolean fed by the tokenizer's existing `jsonSeen` flag. The failure
envelope and the success reduction are separate concerns and a shared type would
couple them for no gain.

### What does `--json=session.id` print at a rest with no `session` block?

Nothing, exit 0. Descending into an absent parent yields absent for the whole
remaining path — the walk cannot prove `id` is a valid key of a `session` that
is not there, and reporting `unknown` would make a driver's optional-field read
fatal. Documented in the `--json` row's help.

### Does removing `--sh` get a friendly deprecation message?

No — a bare unknown-option usage error, exit 2. A removed-flag message table is
new machinery for one flag; `Cli.test.ts`'s property test already covers the
exit code, and the migration note belongs in `docs/cli.md` and `renderHelp()`.

### Does the driver's per-value invocation count need a mitigation?

Only the cheap one already available: at a `prompt` rest the driver pipes the
no-flag `gtd next` for `content` rather than reading `--json=content`, so the
expensive full-diff render happens once for the agent's input instead of twice.
The remaining scalar reads stay separate invocations, as the settled
one-value-per-call rule requires.

### Which package fixes `next-status-content-parity.feature`?

Package 1. It changes plain output, so it breaks the pin and must land the
re-expression against `--json` in the same package — leaving it for package 2
means package 1 is not green on its own.
