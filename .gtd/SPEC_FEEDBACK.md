# Spec feedback — package 02 (landing script is only the commit)

Requirements A and B are implemented and the suite is green. Both of the
previous round's findings are fixed: `ansi-free-stdout.feature` gained a
`gtd land --sh` leg that still carries `printf '\033[...'` source, and
`land.feature`'s piped scenario is retitled and now runs `--sh` through `sh`.

One thing is still wrong: **two documentation blocks outside the three files
Task 3 enumerated still describe the emitted landing script running the mode's
`format:`/`validate:` pair** — the exact guarantee Requirement A removed. Both
state the deleted mechanism as live, and neither is pinned by a test, so the
green suite does not catch them.

## 1. `docs/configuration.md:423-449` documents the deleted landing steps (blocking)

The section "The normalization-only contract on `format:`" describes the removed
`steeringModeSteps` behaviour as current, in two places:

- **Lines 430-432:** "which may be before OR after an emitted script's own
  `format:` line has run (the script runs `format:` then `validate:` then the
  commit — see `src/SteeringMode.ts`'s `renderSteeringCommands`)". The emitted
  landing script has no `format:` line any more — `buildRequiredScript` is now
  `emitScripts(headPreconditions(...), renderDecision(...)).required` and
  nothing else. The whole "no guaranteed ordering between gtd decided and the
  script formatted" argument this paragraph builds is about an ordering that no
  longer exists on the landing path.
- **Lines 444-449:** "One case never runs your `format:` (or `validate:`) at
  all: a step whose diff DELETES the state's own `file:` … Emitting the command
  anyway would make such a step unlandable". That carve-out went with
  `steeringModeSteps`. `gtd land` now runs the mode's commands in NO case, not
  just the deletion case — `src/program.test.ts:2043` and
  `review-signoff-format-skip.feature` both assert the new, unconditional shape,
  so the doc contradicts the tests.

Rewrite both paragraphs to the shipped rule: the mode's `format:`/`validate:`
pair is a driver contract run ahead of `gtd land` (`gtd next --json`'s
`validate` field, or `gtd validate`), never part of the landing script. Keep the
normalization-only contract itself — it still binds, because a driver that runs
`format:` before landing can still move bytes a guard reads — but state it
against the driver's own pre-land run, not against "an emitted script's own
`format:` line".

## 2. `docs/internals.md:222-223` claims a `gtd land` gate that formats and validates (blocking)

The sentence reads: "`gtd validate`'s emitted script and the `gtd land` gate
still format and validate it like any other mode." The `gtd land` half is false
as of Requirement A — a custom-mode file (`prose` and friends) gets no
formatting and no validation from `gtd land` at all now, which is precisely the
risk the package's own "The risk" section names. `steering-modes.feature`'s two
rewritten scenarios assert the opposite of what this line tells a reader.

Cut the `gtd land` half, or replace it with `gtd next --json`'s `validate`
field, so the one line a reader lands on for "who checks my custom mode" names
the surface that actually does.

## Not blocking, but worth one line while you are in there

`src/Install.ts:98` tells an agent "The one subprocess gtd ever spawns itself is
a steering mode's own `format:`/`validate:` command, during a land-capture
guard." No guard spawns that command — `formatSteeringFile`/
`validateSteeringFile` have no production caller on the landing path at all (and
had none before this package either, so this is pre-existing, not a regression).
It is the same false picture as the two blocking items and sits in the briefing
an agent reads first.
