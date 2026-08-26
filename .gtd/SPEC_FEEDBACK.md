# Package 1 spec feedback

Four problems. The first two are settled decisions the implementation violates;
the third is a user-facing message defect; the fourth is stale prose that now
contradicts its own file.

## 1. A `null`-valued leaf prints the literal string `null`

Settled decisions, package 1: "An **absent** optional field prints nothing and
exits 0 — never the string `null`."

`src/Select.ts`'s `toSelection` treats `null` as an ordinary object leaf
(`typeof null === "object"`) and returns `JSON.stringify(null)`, so it emits the
four bytes `null` plus a newline.

Reproduced against `dist/gtd.bundle.mjs` in a fresh repo at `idle` with a clean
tree:

- `gtd next --json=next` prints `null`, exit 0 (`BeatFields.next` is
  `... | null`)
- `gtd land --json=subject` at a no-op landing prints `null`, exit 0
- `gtd land --json=cost` at a no-op landing prints `null`, exit 0
- `gtd land --json=model` at a no-op landing prints `null`, exit 0

`LandFields`' own doc comment says `subject`/`cost`/`model` are "`null` (never
omitted) for a genuine no-op" — so **every one of `gtd land`'s three optional
fields hits this on the no-op path**, which is the common case a driver polls. A
driver testing `[ -z "$(gtd land --json=model)" ]` sees a non-empty string and
records the model `null`.

Decide and implement one of the two, consistently for both documents: either
`null` selects as `absent` (zero bytes, exit 0), or the settled decision's
"never the string `null`" is amended. `src/Select.test.ts` has no case for a
`null` leaf at all — add one either way.

## 2. `--json=next.target` exits 2 whenever `next` is `null`

Task 1: "Descending into an absent parent yields `absent`, not `unknown`, for
the whole remaining path ... reporting `unknown` would make a driver's
optional-field read fatal."

`next.target` is named verbatim as a canonical selector in the settled
decisions' grammar list. `resolveSegment` short-circuits to `absent` only for
`undefined`; for `null` it falls through to the final `return NOT_FOUND` (the
`typeof current === "object" && current !== null` guard excludes it), so the
whole path reports `unknown`.

Reproduced: `gtd next --json=next.target` at `idle` with a clean tree **exits
2** with `gtd: unknown --json selector "next.target"`. That is the exact
fatal-optional-read failure mode the absent-parent rule was written to prevent,
on the one nested selector the spec advertises. A driver reading `next.target`
once per beat dies on every beat where nothing matches.

`next` is `| null` rather than `?:` by design (`BeatFields.next` and
`nextField`), so this is not fixable in `Beat.ts` — the walk has to treat a
`null` parent the same way it treats an `undefined` one. Add a
`selectPath({ next: null }, "next.target") === { kind: "absent" }` case to
`src/Select.test.ts`, and an e2e scenario in `json-selector.feature`.

## 3. `--json=`'s usage message is degenerate and recommends the rejected form

`src/Cli.ts`'s `"optional"`-arity branch reuses the `arity: 1` message template.
`--json`'s row declares `valueHint: ""`, so the message interpolates to,
verbatim including the trailing space:

```
gtd: --json requires a value — use --json= or --json
```

Two defects in one line. It tells the user to use `--json=`, **which is the form
just rejected**. And it tells the user to use the space form `--json <value>`,
**which the settled decisions make a usage error on purpose** ("A bare `--json`
followed by a non-`--` token stays a usage error").

Task 3 asks for "same message shape as `arity: 1`" — that shape does not survive
a flag whose space form is illegal and whose `valueHint` is empty. Give the
`"optional"` branch its own message naming the only legal form (e.g.
`use --json=<path>`), and set `--json`'s `valueHint` to `<path>` so
`renderHelp()` and `docs/cli.md`'s pinned block stay derived rather than
hand-written. `Cli.test.ts:275` only asserts
`toContain("--json requires a value")`, so no pin blocks the fix — tighten it to
assert the full message.

## 4. `next-status-content-parity.feature` now asserts nothing it claims to

All three `--sh` assertions were correctly re-expressed against
`--json=content`, but the feature's title and narrative were not:

- Line 2, the `Feature:` line, still reads "gtd next's three encodings (plain,
  --sh, --json)". The file no longer runs `--sh` once.
- Lines 14-16 still claim "`--sh`'s own `gtd_content` variable carries the
  identical text too, proving the underlying `content` field — not merely the
  plain encoding — survives every encoder unchanged." Nothing in the file proves
  that any more.

Rewrite both to describe what the scenarios now do. Package 1 is required to be
green and coherent standing alone, and package 2 (which deletes `--sh`) must not
be the thing that retroactively makes this file honest.
