# Retire the no-agent prompts and rewire `Prompt.ts`

The `cleanup`, `close-review`, and `code-changes` leaves are now executed by the
edge (no agent runs), so their prompt `.md` files and `Prompt.ts` wiring are
dead. Remove them and update `Prompt.test.ts` so vitest stays green. Also adapt
the `fix-tests` / `review-process` rendering to read its override from the leaf
context the machine now populates.

## Files (this task)

- `src/Prompt.ts`
- `src/Prompt.test.ts`
- DELETE `src/prompts/cleanup.md`, `src/prompts/close-review.md`,
  `src/prompts/code-changes.md`

> File-disjoint from sibling task `01-main-driver-loop.md` (`src/main.ts`).

## Changes (`src/Prompt.ts`)

- Remove the imports `cleanup`, `closeReview`, `codeChanges`
  (`Prompt.ts:7-8,13`) and their `SECTIONS` entries (`Prompt.ts:46-47,54`).
- `SECTIONS` is typed `Record<LeafState, string>`. Since `cleanup`,
  `close-review`, `code-changes` are still valid `LeafState` ids (the machine
  keeps them — they are action leaves the edge handles, never rendered), change
  `SECTIONS` to a `Partial<Record<LeafState, string>>` OR drop those three from
  the `LeafState`-keyed map by making the type
  `Record<Exclude<LeafState, "cleanup" | "close-review" | "code-changes">, string>`.
  Prefer the `Exclude` form so the compiler proves those leaves are never
  rendered. Guard the `else` branch in `buildPrompt` so a never-rendered action
  leaf can't index `SECTIONS` — these leaves never reach `buildPrompt` (the
  driver executes them), so an explicit `if (section === undefined) throw`/
  exhaustiveness note is acceptable.
- Add `fix-tests` to the renderable set: the machine now settles on a
  `fix-tests` LEAF (package 02). Today `fix-tests` is only reached via the
  `override` path. Keep the `override?.kind === "fix-tests"` rendering working
  (the driver passes the override built from `context.testOutput`), so NO change
  is strictly required to the fix-tests fence logic — verify it still renders.
- `review-process` rendering: unchanged — still driven by the
  `override.kind === "review-process"` path the driver supplies from
  `context.reviewDiff`/`recordSha`.

## Changes (`src/Prompt.test.ts`)

- DELETE the tests that render the retired sections:
  - `"cleanup prompt renders its section ..."` (asserts
    `Delete the empty \`.gtd/\` directory`).
  - the `close-review` describe/it group (`"close-review section renders the
    commit message prefix"`, `"... short-sha from REVIEW.md base marker"`,
    `"... includes the auto-advance partial"`, `"... does NOT contain another
    leaf's section"`).
  - the `code-changes` cases (`"Commit the uncommitted changes"` /
    `code-changes` autoAdvance ones around `Prompt.test.ts:63-95`).
- ADOPT (move here from `State.test.ts`, package 02) the test-gate→buildPrompt
  integration coverage as direct `buildPrompt` calls with the override built by
  hand:
  - green human-review → contains `format REVIEW.md`, no `Test gate failed`.
  - `{ kind: "fix-tests", testOutput }` override → contains `Test gate failed` +
    the output, no `format REVIEW.md`.
  - escalate leaf → contains `Escalate to the human`.
  (These no longer go through `selectPrompt`; build the override inline.)
- Keep all remaining buildPrompt tests (header, decompose, execute-simple,
  execute package rendering, review-process override, fix-tests override fences)
  green.

## Acceptance criteria

- [ ] `src/prompts/cleanup.md`, `close-review.md`, `code-changes.md` deleted.
- [ ] No imports/`SECTIONS` references to them remain in `Prompt.ts`.
- [ ] `SECTIONS` typing proves the three action leaves are never rendered.
- [ ] `fix-tests` and `review-process` still render via their override paths.
- [ ] `Prompt.test.ts` has no references to the deleted prompts and absorbs the
      moved test-gate→buildPrompt integration cases.
- [ ] `npm run test` green; `npm run typecheck` passes; `npm run lint` clean.

## Constraints / edge cases

- Do NOT remove `cleanup`/`close-review`/`code-changes` from `LeafState` in
  `Machine.ts` — they remain machine states (action leaves). This task only
  removes their RENDERING.
- The `auto-advance` partial import stays (still used by execute / decompose /
  etc.).
