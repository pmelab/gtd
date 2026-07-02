# Config: add `squash: boolean` (default `true`, opt-out)

Add a `squash` config flag mirroring `agenticReview` **exactly**. It defaults to
`true` (every finished process is squashed unless the user sets `squash: false`
in `.gtdrc`). It is a per-resolve guard, so it is read at the edge in
`gatherEvents` (Package 02 task 02) and passed as `ResolvePayload.squashEnabled`
— it is NOT a `Context`-tag layer (per AGENTS.md "Config Values vs. Mode Flags").

## Files

- `src/Config.ts` (edit)
- `src/Config.test.ts` (edit — add coverage mirroring the `agenticReview` cases)

Do NOT touch `src/Events.ts` (task 02) or `src/Machine.ts` (Package 01). The
`ResolvePayload.squashEnabled` field already exists after Package 01.

## What to change in `src/Config.ts`

Mirror `agenticReview` at every site:

1. Default constant next to `DEFAULT_AGENTIC_REVIEW`:
   ```ts
   const DEFAULT_SQUASH = true
   ```
2. Schema field in `ConfigSchema` (next to `agenticReview`):
   ```ts
   squash: Schema.optional(Schema.Boolean),
   ```
3. `ConfigOperations` interface field:
   ```ts
   readonly squash: boolean
   ```
4. `toOperations` wiring:
   ```ts
   squash: decoded.squash ?? DEFAULT_SQUASH,
   ```

`onExcessProperty: "error"` is already set in `ConfigService.Live`, so `squash`
must be a declared schema key (step 2) or valid configs are rejected.

## What to change in `src/Config.test.ts`

Find the existing `agenticReview` test cases and add parallel ones for `squash`:

- Default when absent → `true`.
- Explicit `squash: false` in a loaded config → `false`.
- Explicit `squash: true` → `true`.
- (If the file tests type rejection) a non-boolean `squash` value is rejected by
  the schema.

## Acceptance criteria

- [ ] `ConfigSchema` accepts an optional boolean `squash`.
- [ ] `ConfigOperations.squash` is a `boolean`; `toOperations` defaults it to
      `true` via `DEFAULT_SQUASH`.
- [ ] `Config.test.ts` covers default-true, explicit-false, explicit-true.
- [ ] `npx vitest run src/Config.test.ts` passes.
