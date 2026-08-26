# Package 1 — `--json=<selector>` and the prose default

**Additive: nothing is removed.** `--sh` and every existing `--json` assertion
still pass when this package lands.

This package covers two merged requirements. Both center on `src/Cli.ts`,
`src/Beat.ts` and `src/program.ts`, and the second's `gtd land` prose has to
name `--json=script` — a value the first creates. Both are reproduced verbatim
below so each can be reviewed against its own spec independently.

## Requirement 1 — `--json` accepts an optional selector (PRODUCT)

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

## Requirement 2 — prose instruction output as the no-flag default (PRODUCT)

Reshape `renderBeatPlain` and `gtd land`'s plain branch into instructions a
human or an agent can act on directly.

- `gtd next` at `script`: prose naming the action, then the script.
- `gtd next` at `capture`: prose saying the edit is already made and `gtd land`
  will land it.
- `gtd next` at `message`: the gate's message, unchanged.
- `gtd next` at `stalled`: the diagnosis, unchanged.
- `gtd next` at `prompt`: bare content, unchanged.
- `gtd land`: prose naming what landed **and** pointing at `--json=script`,
  since the script is not reachable without it. Today's plain branch prints only
  a sentence and drops the script on the floor, which is why no driver can use
  it.

Acceptance: `gtd next` at a `script` rest contains the instruction sentence and
the script body; `gtd land` at a real landing names both the commit subject and
the way to get the script.

**Risk:** `next-status-content-parity.feature` pins plain output against `--sh`
output. That pin must be re-expressed against `--json`, not deleted.

## Settled decisions this package implements

- The selector is spelled `--json=<sel>` only. A bare `--json` followed by a
  non-`--` token stays a usage error — an optional-value flag that consumed a
  following token would have to guess at `gtd land --json --cost=5`.
- The grammar is a dotted key path using the document's own key names verbatim:
  `kind`, `content`, `session.id`, `next.target`, `costByModel`. **No alias
  table and no array indexing** — `changes.0.path` is jq, the dependency being
  removed.
- A scalar prints raw, unquoted, one line. A boolean prints `true`/`false`. A
  list prints one JSON-encoded entry per line. An **absent** optional field
  prints nothing and exits 0 — never the string `null`. An unknown selector is a
  usage error, exit 2.
- `--json` is non-repeatable and one selector yields exactly one value. A driver
  wanting three fields calls `gtd next` three times.
- **The exit code never carries `settled`, `idle` or `kind`** — `docs/cli.md`
  pins exit codes as a uniform 0/1/2 table that is never data.
- `gtd land --json=model` (read the recorded model back) and
  `gtd land --model=<name>` (record it) are different tokens. No flag is renamed
  and no existing caller changes.

## Task 1 — `src/Select.ts`, the selector walk

A new zero-import pure leaf taking the tier `src/Sh.ts` occupies today, keeping
that tier's rule: **no imports, no IO, total functions.** Keeping it out of
`Beat.ts` means the walk has no access to `RenderedRest` types and cannot grow a
field-specific special case.

```
export type Selection =
  | { readonly kind: "value"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown"; readonly path: string }

export const selectPath = (fields: unknown, path: string): Selection
```

Path splitting is a plain `.split(".")`. A segment that is all digits is an
ordinary key name and will simply be unknown.

**`text` never carries a trailing newline** — the caller adds exactly one, and
`absent` writes zero bytes.

**Descending into an absent parent yields `absent`, not `unknown`, for the whole
remaining path.** `--json=session.id` at a `script` rest prints nothing and
exits 0; the walk cannot prove `id` is a valid key of a `session` that is not
there, and reporting `unknown` would make a driver's optional-field read fatal.

**`selectPath` never throws.** A malformed path must not escape as an unhandled
`Error` and get reported as a gtd crash.

Paths: `src/Select.ts` (new), `src/Select.test.ts` (new).

- [ ] `selectPath` returns `value` with the raw string for a scalar leaf
- [ ] `selectPath` returns `value` with `true`/`false` for a boolean leaf
- [ ] `selectPath` returns `value` with one `JSON.stringify` per entry,
      newline-joined, for a list leaf
- [ ] `selectPath` returns `absent` for a key that is present with an
      `undefined` value
- [ ] `selectPath` returns `unknown` for a key that is missing from the object
- [ ] `selectPath` returns `absent` for the whole remaining path when a parent
      is present-but-`undefined`
- [ ] `selectPath` returns `unknown` for an all-digits segment against a list
- [ ] `selectPath` returns no trailing newline in any `value.text`
- [ ] `src/Select.ts` has zero imports

## Task 2 — make absent optionals present-with-`undefined` in `src/Beat.ts`

`beatFields`/`landFields` stop omitting absent optionals and assign `undefined`
instead: `label?: string` becomes `label: string | undefined`, the idiom
`NextMatch.action` already uses under `exactOptionalPropertyTypes`. Both
builders lose their spread-conditionals in favour of plain assignments.

**`JSON.stringify` drops `undefined`-valued keys, so `gtd next --json`'s bytes
and key order are unchanged** — the byte-identical acceptance criterion holds
with no golden-file exception. A present key then reads as `absent`, a missing
key as `unknown`. No key table is introduced, so nothing can drift out of sync
with `BeatFields`.

**`beatFields`' two conditional gates survive the rewrite as explicit
`undefined`s, not as dropped keys.** `session`/`validate` are still forced to
`undefined` unless `kind === "prompt"`, and `system` is still `undefined` when
its rendered value is the empty string — an empty `--system-prompt ""` would
silently delete the harness's own default instead of failing loudly. **Turning
those into unconditional assignments is the one way this refactor changes
behaviour.**

**Risk: the relaxed types no longer make omission visible in a signature.**
`label: string | undefined` reads as "always there, sometimes empty", which is
the opposite of the wire truth. Every one of `BeatFields`' optional fields —
`session`, `model`, `system`, `validate`, `label`, `memory`, `file`, `mode`,
`edges`, `cost`, `costByModel` — and `LandFields`' `subject`/`cost`/`model`
needs its doc comment to say the key is dropped from the JSON when `undefined`,
or the next reader adds a field with `?:` and silently makes it unselectable.

Paths: `src/Beat.ts`, `src/Beat.test.ts`.

- [ ] Every optional `BeatFields` key is declared `T | undefined`, not `?: T`
- [ ] Every optional `LandFields` key is declared `T | undefined`, not `?: T`
- [ ] `beatFields` and `landFields` build their result with plain assignments,
      no spread-conditionals
- [ ] `renderBeatJson`'s output for a rest with absent optionals is
      byte-identical to before the change, key order included
- [ ] `renderLandJson`'s output for a no-op landing is byte-identical to before
      the change
- [ ] `session` and `validate` are `undefined` when `kind !== "prompt"`, even
      when the caller passed one in
- [ ] `system` is `undefined` when its rendered value is the empty string
- [ ] Each optional field's doc comment states the key is dropped from the JSON
      when `undefined`

## Task 3 — the third arity mode in `src/Cli.ts`

`FlagRow.arity` widens from `0 | 1` to `0 | 1 | "optional"`. **The tokenizer
gains one generic branch, not a bespoke `--json` check** — `Cli.test.ts`'s
property test forces any flag handled outside the table to a usage error.

- `"optional"` with an `=`: the right-hand side is the raw value. An empty
  right-hand side (`--json=`) is a usage error, same message shape as
  `arity: 1`.
- `"optional"` with no `=`: records presence with no value and **never consumes
  the following token**. `gtd next --json kind` therefore parses `kind` as a
  positional, which `gtd next`'s `arity: "none"` rejects — exit 2.

`CliPlan`'s command variant replaces `readonly json: boolean` with:

```
export type JsonMode =
  | { readonly kind: "off" }
  | { readonly kind: "document" }
  | { readonly kind: "select"; readonly path: string }
```

**`CliPlan.usage.json` stays a plain boolean.** The structured failure envelope
is orthogonal to the selector and the requirement pins it as surviving; the
tokenizer's existing `jsonSeen` flag already feeds it and needs no change.

The `--sh` row's `conflicts: ["--json"]` keeps working unchanged — conflicts are
checked on `present`, which is arity-blind.

`decode` for `--json` returns the raw selector string. Selector help text lives
in the `--json` row's own `help` array, including the absent-parent rule, so
`renderHelp()` and `docs/cli.md`'s pinned `## Commands` block follow for free.

Paths: `src/Cli.ts`, `src/Cli.test.ts`, `docs/cli.md`.

- [ ] `FlagRow.arity` accepts `"optional"` and the tokenizer handles it
      generically
- [ ] `--json=kind` parses to `JsonMode` `select` with path `kind`
- [ ] `--json` alone parses to `JsonMode` `document`
- [ ] `--json` absent parses to `JsonMode` `off`
- [ ] `--json=` is a usage error, exit 2
- [ ] `--json kind` leaves `kind` as a positional and exits 2 on `gtd next`
- [ ] `--json` stays non-repeatable — a second occurrence is a usage error
- [ ] `CliPlan.usage.json` is still a boolean
- [ ] `--sh` and `--json` together are still a conflict error
- [ ] `docs/cli.md`'s `## Commands` block is pinned equal to `renderHelp()`'s
      output

## Task 4 — dispatch on the mode in `src/program.ts`

`runNextCommand` and `runLandCommand` take `json: JsonMode` instead of a boolean
and branch three ways.

**The `select` branch runs after the fields object is fully built**, so it
reduces the same document `document` would print — there is no second gathering
path and no shortcut that could skip a field's computation and make the two
disagree. **A selector never changes what gets computed, only what gets
printed**; a lazy `content` would break `gtd next --json=kind`'s claim to be the
same document.

`unknown` maps to the existing usage-error path: exit 2 via `ExitCodes.ts`'s
usage code, message on stderr, nothing on stdout. `absent` writes nothing and
falls through to the normal `EXIT_OK`.

The self-validation-command resolution in `runNextCommand` stays
`Effect.catchAll`-degraded and stays on the plain branch only.

Paths: `src/program.ts`, `src/program.test.ts`.

- [ ] `runNextCommand` and `runLandCommand` accept `JsonMode` and branch
      off/document/select
- [ ] The `select` branch reduces the same fields object the `document` branch
      renders
- [ ] An unknown selector exits 2, writes the message to stderr, and writes
      nothing to stdout
- [ ] An absent selector writes zero bytes to stdout and exits 0
- [ ] A `value` selection is written with exactly one trailing newline
- [ ] The self-validation-command resolution still runs only on the plain branch
      and still degrades on error

## Task 5 — prose default for `gtd next` and `gtd land`

`renderBeatPlain` gains a per-kind instruction line ahead of the existing header
block. **The instruction is a plain string constant per kind in `Beat.ts`, not a
template** — no `PatternTemplates.ts` involvement, no render that can throw.

- `script`: `Run this script:` then the header block then the script body.
- `capture`: prose stating the edit is already made and `gtd land` will land it.
- `message` and `stalled`: unchanged, byte for byte.
- `prompt`: unchanged — bare content plus the self-validation instruction. Those
  bytes are the agent's own input and gtd's bookkeeping must not be prefixed
  onto them. **The early return already in `renderBeatPlain` guarantees this; do
  not move the instruction above it.**

New `renderLandPlain(fields: LandFields): string` replaces `program.ts`'s inline
`landProseText`/`noopText` branch. It names the commit subject (or the no-op)
**and** points at `gtd land --json=script`, because the script is unreachable
from plain output. `landProseText`/`noopText` move into `Beat.ts` alongside it
so `program.ts` holds no output prose at all.

Paths: `src/Beat.ts`, `src/Beat.test.ts`, `src/program.ts`.

- [ ] `gtd next` at a `script` rest prints the instruction sentence, the header
      block, and the script body
- [ ] `gtd next` at a `capture` rest prints prose stating the edit is already
      made and `gtd land` will land it
- [ ] `gtd next` at a `message` rest is byte-identical to before the change
- [ ] `gtd next` at a `stalled` rest is byte-identical to before the change,
      including the `stalled at "<state>"` substring
- [ ] `gtd next` at a `prompt` rest is byte-identical to before the change —
      bare content plus the self-validation instruction, no header
- [ ] `renderLandPlain` names the commit subject at a real landing and points at
      `gtd land --json=script`
- [ ] `renderLandPlain` prints the no-op note when nothing landed
- [ ] `src/program.ts` contains no output prose literals

## Task 6 — e2e coverage and the parity pin

`json-selector.feature` is a new `@inmem` feature file. **Add no new npm script
and no new `turbo.json` task** — it runs under the existing e2e task. Compose
from the existing `Given the workflow` steps; write no one-off setup step.

**`next-status-content-parity.feature` pins plain output against `--sh` output,
and this package changes plain output.** Re-express that pin against `--json`
here — not in a later package, and not by deleting it. Leaving it breaks the
claim that this package is green on its own.

Paths: `tests/integration/features/json-selector.feature` (new),
`tests/integration/features/next-status-content-parity.feature`.

- [ ] `gtd next --json=kind` prints one bare word
- [ ] `gtd next --json` output is byte-identical to a golden document
- [ ] `gtd next --json=session.id` reaches the nested field
- [ ] `gtd next --json=label` at a rest with no `label:` prints nothing and
      exits 0
- [ ] `gtd next --json=changes` prints one JSON object per line
- [ ] `gtd next --json=idle` prints `true`
- [ ] `gtd next --json=nope` exits 2
- [ ] `gtd next --json kind` exits 2
- [ ] `gtd next --json=` exits 2
- [ ] `gtd land --json=script | sh` lands a turn
- [ ] `gtd land --json=model` and `gtd land --model=<name>` do not collide
- [ ] `next-status-content-parity.feature`'s five `--sh` assertions are
      re-expressed against `--json`
- [ ] The full suite is green with `--sh` still present and every pre-existing
      `--json` assertion untouched
