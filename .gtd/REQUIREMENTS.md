# Requirements

## TECHNICAL: Simplify `condenseFailure`'s signature in `scripts/test-states.ts`

(critical: judge unsure)

Human note on `./scripts/test-states.ts#101-132`: `condenseFailure` takes seven
positional parameters, `i` only to bail on the first state, and `Seen`
duplicates the inline type of `runStates`' `seen` array.

- **Drop the `i` parameter**: `runStates` skips the `condenseFailure` call for
  the first state (`i === 0`) instead
- **The first state must still be pushed onto `seen`** — skipping the call must
  not skip `seen.push`, or later states lose their "same failures as" match
  against it
- **Type `runStates`' `seen` array with `Seen`** (make `Seen` the mutable array
  type or derive the element type) — no second inline copy of the shape
- **Pass the remaining inputs as one options object**, not positional parameters
- **No behaviour change**: pass/FAIL lines, condensed output, and exit status
  stay identical; existing `tests/tooling/test-states.test.ts` cases stay green
  unchanged
