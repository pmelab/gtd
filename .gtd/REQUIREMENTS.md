# Requirements

## TECHNICAL: Simplify `condenseFailure`'s signature in `scripts/test-states.ts`

(critical: judge unsure)

Human note on `./scripts/test-states.ts#101-132`: please drop `i` (skip the call
for the first state in `runStates`), reuse `Seen` for the `seen` array, and pass
the rest as one options object instead of seven positional parameters.

`npm test` is green at loop-back start (all three release-flag states pass). The
round's other note — rename the `failuresOf` test whose title claimed "ignoring
... timing" — already landed in the nit fix; no work left for it.

- **Drop the `i` parameter and its `if (i === 0) return`**: `runStates` guards
  the `condenseFailure` call with `i > 0` instead
- **The first failing state still runs `failuresOf` and is still pushed onto
  `seen`** — the guard wraps only the `condenseFailure` call, never the
  `failuresOf` call or `seen.push`, or later states lose their "same failures
  as" match against state 0
- **Type `runStates`' `seen` array with `Seen`**: make `Seen` the element type
  (`{ label; failures }`), declare the array as `Seen[]` in `runStates` and take
  `readonly Seen[]` in `condenseFailure` — one definition of the shape, no
  inline copy
- **Pass the remaining inputs as one options object** (`state`, `output`,
  `mine`, `seen`, `condense`, `log`), destructured in the signature — no
  positional parameters left
- **No behaviour change**: pass/FAIL lines, condensed output, live streaming
  (state 0 only when condensing), and exit status stay identical; every existing
  `tests/tooling/test-states.test.ts` case stays green unchanged —
  `condenseFailure` is not exported, so no test edits are needed
