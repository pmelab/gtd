# Task: Surface the review base hash into the clean prompt

Make the literal `reviewBase` hash reach the **clean** prompt so the authoring
agent can fill the `# Review: <short-hash>` heading and `<!-- base: <full-hash> -->`
marker reliably.

## What to build

In `src/Prompt.ts`, extend the clean-state block (currently L197-199):

```ts
if (promptState === "clean" && context.refDiff !== undefined && context.refDiff.trim() !== "") {
  parts.push(...renderDiff("Changes to review (`git diff <base> HEAD`)", context.refDiff))
}
```

- The literal `context.reviewBase` hash must appear in the rendered clean prompt.
- Recommended: add a `Review base: <full-hash>` line and/or relabel the diff
  heading to embed the literal hash (e.g. ``git diff <reviewBase> HEAD``).
- `reviewBase` is already on `ResolveContext` (`src/Machine.ts` L179) — **no**
  machine or edge change is needed.
- Only emit the base-hash line when `context.reviewBase` is defined (guard like
  the existing `refDiff` guard).

## Acceptance criteria

- [ ] The rendered **clean** prompt contains the literal `context.reviewBase` string
- [ ] The base-hash line/label is omitted when `reviewBase` is undefined
- [ ] No changes to `src/Machine.ts` or `src/Events.ts`
- [ ] `bun test src/Prompt.test.ts` passes (coordinate label changes with task 03)
- [ ] `bun run typecheck` (or project equivalent) passes

## Files

- Edit: `/Users/pmelab/Code/gtd/gtd/src/Prompt.ts` (clean block ~L197-199; see
  `renderDiff` at L88)

## Constraints

- File-disjoint with all other tasks in this package. You own `src/Prompt.ts`
  only — do **not** touch the prompt markdown, tests, or README.
- The existing test `clean inlines refDiff under a review heading` passes
  `reviewBase: "abc1234"`; keep the `Changes to review` heading substring present
  (that test asserts `toContain("Changes to review")`) unless task 03 updates it
  in lockstep — prefer keeping it and adding the hash alongside.
