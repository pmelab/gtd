# Property test: add `squashing` to the exhaustive `ALLOWED` map

`src/Machine.property.test.ts` declares
`const ALLOWED: Record<GtdState, ReadonlyArray<EdgeAction["kind"] | "none">>`
(around line 137). Because it is keyed by `Record<GtdState, …>`, adding
`"squashing"` to the `GtdState` union (Package 01 task 01) makes this object
**fail to typecheck** until a `squashing` key is added. This task adds it and
keeps the property invariants green.

## Files

- `src/Machine.property.test.ts` (edit)

Do NOT touch any other file.

## What to change

1. Add a `squashing` entry to `ALLOWED`. The `squashing` state carries **no**
   `edgeAction`, so its allowed kinds are `["none"]`:

   ```ts
   squashing: ["none"],
   ```

2. Update the leading doc comment that says "exactly one of the 16 states comes
   back" → 17, if present (around line 22).

3. `STATES` is derived from `Object.keys(ALLOWED)`, so it picks up `squashing`
   automatically — no separate edit needed there.

4. The generated-payload arbitrary in this file (`arbPayload`, ~line 51) builds
   a **full `ResolvePayload` object literal field-by-field** inside `.map(...)`
   (it returns every field explicitly — it does NOT spread `DEFAULT_PAYLOAD`).
   `squashEnabled` is a **required** field on `ResolvePayload` after Package 01,
   so this literal WILL fail to typecheck until you add it. Add exactly:

   ```ts
   squashEnabled: false,
   ```

   in the returned object (alongside `agenticReviewEnabled`). Leave `squashBase`
   / `squashDiff` unset (they are optional). With `squashEnabled: false` the
   arbitrary never produces a `squashing` result, so the existing invariants
   (states set, allowed edge actions, determinism) all still hold and the
   `ALLOWED["squashing"] = ["none"]` entry only satisfies the exhaustive
   `Record<GtdState, …>` type. Do NOT wire `squashEnabled` to a random boolean —
   that would require also generating `squashBase`/`gtd: done`-HEAD combinations
   and updating `ALLOWED`/invariants, which is out of scope for this task.

## Acceptance criteria

- [ ] `ALLOWED` has a `squashing: ["none"]` entry (exhaustive `Record<GtdState>`
      compiles).
- [ ] Any "16 states" reference in the doc comment is updated to 17.
- [ ] The payload arbitrary compiles with the new `ResolvePayload` fields.
- [ ] `npx vitest run src/Machine.property.test.ts` passes.
