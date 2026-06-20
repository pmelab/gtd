# Wire the new prompts into Prompt.ts

Register the `human-review` and `verified` prompts in `src/Prompt.ts` and add
`verify` to the auto-advance set.

DEPENDS ON tasks 01 and 02 in this package (the prompt files must exist) and on
package 02 (the `Branch` union must include `"human-review"` and `"verified"`).

## Files

- `src/Prompt.ts`

## Changes

1. Import the new prompt markdown files:
   - `import humanReview from "./prompts/human-review.md"`
   - `import verified from "./prompts/verified.md"`
   - If task 01 extracted a shared review-body partial, import it too and
     compose it for both `review-create` and `human-review` (coordinate with
     task 01's chosen approach).

2. Add both to the `SECTIONS: Record<Branch, string>` map:
   - `"human-review": humanReview`
   - `verified` The `Record<Branch, string>` type makes this map exhaustive —
     once package 02 adds the union members, these keys are REQUIRED for the
     file to typecheck.

3. Add `"verify"` to `AUTO_ADVANCE_BRANCHES`. Do NOT add `"human-review"` or
   `"verified"` — both are terminal and must STOP.

## Constraints

- Keep `SECTIONS` entries ordered consistently with the `Branch` union for
  readability.
- The `refDiff` context block in `buildContext` already renders when
  `state.refDiff` is set — no change needed there; `human-review` reuses it.

## Acceptance criteria

- [ ] `human-review` and `verified` prompts are imported and present in
      `SECTIONS`.
- [ ] `verify` is in `AUTO_ADVANCE_BRANCHES`; `human-review` and `verified` are
      not.
- [ ] `npm run typecheck` passes (the `Record<Branch, string>` exhaustiveness
      check is now satisfied).
