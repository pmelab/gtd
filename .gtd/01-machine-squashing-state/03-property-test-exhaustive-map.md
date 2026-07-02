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

4. The generated-payload arbitrary in this file (check how it builds
   `ResolvePayload`) may not set the new `squashBase` / `squashDiff` /
   `squashEnabled` fields. If the payload arbitrary spreads `DEFAULT_PAYLOAD`
   (or builds from it), `squashEnabled` defaults to `false` and no `squashing`
   result is generated — the `ALLOWED["squashing"] = ["none"]` entry is then just
   there to satisfy the exhaustive `Record` type. If the arbitrary constructs the
   payload field-by-field, ensure it either omits the squash fields (falling back
   to defaults) or, if it enumerates every field, adds `squashEnabled` (default
   `false`) so existing invariants hold. Inspect the file and choose the minimal
   change that keeps it compiling and passing.

## Acceptance criteria

- [ ] `ALLOWED` has a `squashing: ["none"]` entry (exhaustive `Record<GtdState>`
      compiles).
- [ ] Any "16 states" reference in the doc comment is updated to 17.
- [ ] The payload arbitrary compiles with the new `ResolvePayload` fields.
- [ ] `npx vitest run src/Machine.property.test.ts` passes.
