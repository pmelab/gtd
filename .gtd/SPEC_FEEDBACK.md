# Spec review — package 1 (`--json=<selector>` and the prose default)

The selector walk, the third arity mode, the `JsonMode` dispatch and the prose
default are all present and the suite is green. Six concrete gaps remain.

## 1. The `gtd land --json=script | sh` acceptance criterion has no test

Requirement 1's Acceptance and Task 6's checklist both name
**`gtd land --json=script | sh` lands a turn**. Nothing executes it.
`tests/integration/features/json-selector.feature:128` only asserts the printed
script _contains_ `git add -A` and `git commit` — an `@inmem` scenario, which
never runs a script.

Its `--sh` twin already exists and is the shape to copy:
`tests/integration/features/land.feature:292`, `@live`, "gtd land --sh, eval'd
and piped into sh, lands the turn".

This is load-bearing right now because **package 2 deletes `--sh`**. If the
`--json=script` twin is not written here, the only executed proof that gtd's
landing script actually lands anything disappears with `--sh`.

Add an `@live` scenario that pipes `gtd land --json=script` into `sh` and
asserts the commit landed.

## 2. `gtd next`'s and `gtd land`'s command help still describe the old plain output

Task 5 changed plain output; the command table's `details` rows did not follow,
and `docs/cli.md`'s `## Commands` block is pinned to `renderHelp()`, so the
shipped docs now misdescribe the shipped behaviour.

- `gtd land`'s row (`docs/cli.md:23-25`): "Plain (the default) prints one
  human-readable sentence naming the commit subject — not a script." It now
  prints **two** lines — the sentence plus `(run \`gtd land --json=script | sh\`
  to get the landing
  script)`. The pointer is the whole point of Task 5's `renderLandPlain` and the
  help does not mention it.
- `gtd next`'s row (`docs/cli.md:43-45`): "Plain (the default): a status
  summary, a blank line, then the step verbatim". At `kind: script` and
  `kind: capture` an instruction line (`Run this script:` /
  `The edit is already made — run \`gtd land\` to land it.`) now precedes the
  status summary. Unmentioned.

Fix both `details` arrays in `src/Cli.ts` and re-pin `docs/cli.md`.

## 3. The `--json` help omits the absent-parent rule

Task 3: "Selector help text lives in the `--json` row's own `help` array,
**including the absent-parent rule**". The row currently says only "An absent
optional field prints nothing and exits 0". The rule the spec singled out —
**descending through an absent or `null` parent yields absent for the whole
remaining path, not an unknown-selector error**, so a driver's
`--json=session.id` read at a `script` rest is never fatal — is not stated
anywhere in the help or in `docs/cli.md`. That is precisely the behaviour a
driver author needs to know before relying on an optional-field read.

## 4. `src/Select.ts` cites `.gtd/SPEC_FEEDBACK.md`, a file that gets deleted

`src/Select.ts:52` ends with "see .gtd/SPEC_FEEDBACK.md #1/#2". That file is
this workflow's private scratchpad — `closing` runs
`rm -f .gtd/SPEC_FEEDBACK.md`, so the citation is dangling the moment the
package closes. Shipped source must not reference a state file. Keep the
`null`-is-absent rationale (it is a real decision worth a comment) and drop the
pointer.

## 5. `report`'s doc comment in `src/Cli.ts` contradicts the line beneath it

`src/Cli.ts:1067` still claims: "Never reached for a USAGE error — those never
build a layer at all." Four lines later,
`io.exit(error instanceof SelectorUsageError ? EXIT_USAGE_ERROR : ...)` exists
exactly because a usage error _does_ now reach `report`. Correct the comment to
name the one exception (`SelectorUsageError`, raised after the layer is built
because the selector is resolved against the finished fields object).

## 6. Dead branches and a wrong comment in `toSelection`

`selectPath`'s loop returns `absent` on `undefined` **or** `null` after every
segment, including the last — so `toSelection` can never be called with either.
That makes two things wrong in `src/Select.ts`:

- `toSelection`'s first line,
  `if (value === undefined) return { kind: "absent" }`, is unreachable.
- Its doc comment says "scalars/booleans/**null** stringify directly". `null`
  never reaches it, and if it did, stringifying it would produce the literal
  string `null` — the exact output the settled decisions forbid.

Delete the dead branch and fix the comment. This file is a new zero-import pure
leaf held to `src/Sh.ts`'s tier rules; unreachable code and a comment that
describes forbidden behaviour do not belong in it.
