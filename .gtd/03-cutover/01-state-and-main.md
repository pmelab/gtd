# Task: Rewrite `detect()` and `main.ts` to drive the machine

Flip `src/State.ts` and `src/main.ts` onto the event-sourced pipeline.

## What to build

1. **`src/State.ts`**:
   - `detect()` becomes: `gatherEvents()` (from `src/Events.ts`) → `resolve(events)`
     (from `src/Machine.ts`) → return `{ value, context, autoAdvance }`.
   - Drop the `branches: Branch[]` model and the old `State` shape; export the new
     return type (value = leaf id, context = machine context, autoAdvance: boolean).
   - Remove `refArg` parameter and ALL ref-arg handling (review-mode branch).
   - Remove `diffAddsTodoMarker` (markers are now ordinary code).
   - Remove the now-duplicated `computeReviewBase` (lives in `Events.ts`).
   - Keep behavior parity with the old decision tree for every surviving state.

2. **`src/main.ts`**:
   - Keep the `format` subcommand exactly as-is.
   - Remove ref-arg parsing; call `detect()` with no argument.
   - Adapt to the new `detect()` return type when calling `buildPrompt`.

## Acceptance criteria

- [ ] `detect()` takes no arguments and returns `{ value, context, autoAdvance }`
- [ ] No ref-arg code, no `diffAddsTodoMarker`, no `branches[]`, no duplicate
      `computeReviewBase` remain in `State.ts`
- [ ] `format` subcommand still works
- [ ] `npm run typecheck` + `npm run lint` pass (coordinate with the Prompt task)

## Files

- `src/State.ts`, `src/main.ts`
- Imports: `src/Events.ts`, `src/Machine.ts`

## Constraints

- This task pairs with the Prompt task (shared `detect()` return type) and the
  feature-test task; the package's testing subagent reconciles the integration.
