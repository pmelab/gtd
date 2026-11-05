# Quality

## "A pick never clears" keeps the free-form tick outside the format contract's round-trip test

_From lens spec-challenge. The judge called it design (p=0.72)._

Spec decision (REQUIREMENTS Concern 3): a free-form pick "only moves, never
clears". Built as `freeFormApply` refusing `checked: false` with
`anchor-not-found` (`src/steering/freeform.ts`).

Invariant it conflicts with: `src/steering/contract.test.ts`'s "round-trips
every tick" case, the pin `FORMATS.md` says every format's writer is held to.
For each ticked node it writes `checked: false` and requires the bytes to
change, then `checked: true` and requires the original bytes back. The spec's
own Impact section said "free-form now joins it". It can't: under this decision
the `off` write throws `off refused: anchor-not-found`.

So the change left free-form at `["free-form", freeFormFormat, false]` ("has no
ticks to read"). `view` still reports no `checked` on any free-form node, and
the screen reads box state from its own markdown render, not from the format's
read. As a result, the format's one new writer (a tick, which `FORMATS.md` lists
as a breaking-change surface) has no fixture or contract coverage. The contract
test still says free-form has no ticks, but the phone now writes them. The
refusal reason is also wrong: `anchor-not-found` for an anchor that resolves,
when the real refusal is a policy (the pick never clears).

Resolve it one of two ways:

- **Enforce never-clear in the client.** `TaskBox` already ignores a tap on a
  ticked box, so `apply` can support `checked: false`. Then expose `checked` on
  free-form task items, add a ticked `free-form/` fixture and flip the flag to
  `true`.
- **Keep the refusal in the format.** Add a dedicated reason for it and a
  free-form contract case pinning the pick-one write's byte-exact round trip.

- [ ] fix
