# Wire `stop.md` into `buildPrompt` in `src/Prompt.ts`

Import the new `stop.md` partial and prepend it for every human-gate state
(`!result.autoAdvance && promptState !== "clean"`). This makes the ⛔ banner
appear automatically for `await-review`, `escalate`, `idle`, and the grilling
stop-case — without touching individual prompt files.

## Acceptance criteria

- [ ] `src/Prompt.ts` imports `stopPartial` from `"./prompts/partials/stop.md"`
- [ ] `buildPrompt` prepends `stopPartial` (followed by `""`) to `parts` before
      `buildContextBlock(context)` when
      `!result.autoAdvance && promptState !== "clean"`
- [ ] `buildPrompt` does **not** prepend `stopPartial` when
      `result.autoAdvance === true`
- [ ] `buildPrompt` does **not** prepend `stopPartial` when
      `promptState === "clean"` (clean has `autoAdvance: false` but is not a
      human gate — it spawns a subagent)
- [ ] All existing tests pass (the test suite may still have one stale assertion
      from package 2; that is fixed in package 4)

## Files

- **Modify**: `src/Prompt.ts`

## Exact change

Replace the `parts` initialization block (currently lines 172–173):

```ts
const parts: Array<string> = [header, "", buildContextBlock(context)]
```

with:

```ts
const parts: Array<string> = [header, ""]
if (!result.autoAdvance && promptState !== "clean") parts.push(stopPartial, "")
parts.push(buildContextBlock(context))
```

And add the import near the top (after the existing `autoAdvance` import on line
11):

```ts
import stopPartial from "./prompts/partials/stop.md"
```

## Constraints / edge cases

- The condition must use `promptState` (the narrowed type), not `state`, to
  satisfy TypeScript's type checker.
- `clean` is the only `autoAdvance: false` state that is NOT a human gate (it
  tells the agent to re-run gtd after creating REVIEW.md). All other
  `autoAdvance: false` prompt states are human gates.
- The grilling stop-case (`grillingCase === "stop"`) already has
  `autoAdvance: false` in `Machine.ts:506`. The partial will be injected
  automatically — no special-casing needed.
- Do NOT modify `src/Prompt.test.ts` in this package.
