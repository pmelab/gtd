# Task: Add config caps + new model-state keys (additive)

Extend `src/Config.ts` so the new machine's caps and the new agent states can be
configured, **purely additively** — keep every existing field/key so the old
pipeline (`Prompt.ts`, `Events.ts`, `TestRunner.ts`) and all existing tests stay
green. The cutover package removes the now-dead old keys later.

Spec pointers:

- `TODO.md` → "Modules to rewrite → **src/Config.ts**" and Resolved Q "Caps as
  config" + Q "Which new states are subagent-spawning".
- Defaults: `fixAttemptCap` = 3, `reviewThreshold` = 3, `agenticReview` = true.

## What to add (additive)

1. **Caps as config:**
   - Add `fixAttemptCap?: number` to `ConfigSchema`, default 3, exposed on
     `ConfigOperations` as `fixAttemptCap: number`.
   - Add `reviewThreshold?: number` to `ConfigSchema`, default 3, exposed as
     `reviewThreshold: number`. (This is the rename target for
     `agenticReviewMaxCycles`, but **keep `agenticReviewMaxCycles` too** for now
     so the old edge keeps compiling — both fields coexist this package.)
   - Keep `testCommand`, `agenticReview` (boolean kill-switch), and the
     cosmiconfig walk-up/merge exactly as-is.

2. **New model-state keys (additive):** the new machine's agent states are
   `grilling`, `decompose`, `building`, `fixing`, `agentic-review`, `clean`.
   `decompose` already exists — keep it. Add the other five to:
   - the `ModelState` union,
   - the `stateTier` map: `grilling`→`planning`, `building`→`execution`,
     `fixing`→`execution`, `agentic-review`→`planning`, `clean`→`planning`,
   - `ModelStatesSchema` (each a new optional `Schema.String`),
   - keep `builtinTierDefault` unchanged (still `planning`/`execution`).
   **Keep all existing keys** (`new-todo`, `modified-todo`, `execute`,
   `spec-review`, `spec-fix`) so `Prompt.ts` still resolves. The union
   temporarily holds both old and new keys.

## Constraints / edge cases

- Additive only: `npm run test` and `npm run test:e2e` must stay green.
- `ModelStatesSchema` keeps `onExcessProperty: "error"` semantics via
  `Schema.decodeUnknown(...,{ onExcessProperty: "error" })` in
  `ConfigService.Live`; adding new **optional** keys must not break existing
  configs that omit them, and must still reject genuinely unknown keys.
- The repo's own `.gtdrc` only sets `testCommand` — confirm it still decodes.

## Files

- Modify: `src/Config.ts`
- Modify: `src/Config.test.ts` (add tests for `fixAttemptCap` /
  `reviewThreshold` defaults + overrides, and model resolution for the five new
  states + per-state overrides; keep all existing tests passing)

## Acceptance criteria

- [ ] `ConfigOperations` exposes `fixAttemptCap` (default 3) and
      `reviewThreshold` (default 3); both honour config-file overrides.
- [ ] `agenticReviewMaxCycles` and all existing model keys remain present and
      behave unchanged.
- [ ] `resolveModel("grilling"|"building"|"fixing"|"agentic-review"|"clean")`
      resolves to the correct tier defaults and respects `models.states.*` and
      `models.planning`/`models.execution` overrides.
- [ ] Unknown config keys are still rejected.
- [ ] `npm run test` and `npm run test:e2e` pass.
