# Test: add `buildPrompt()` cases for the missing auto-advance leaves

## Description

`src/Prompt.test.ts` exercises `buildPrompt` for several leaf states but lacks
explicit cases for four leaves that have section mappings in
`src/Prompt.ts` (`SECTIONS`) and carry the `auto-advance` tag in the machine:

- `execute`
- `cleanup`
- `decompose`
- `execute-simple`

Add one test per leaf asserting (a) the correct section content renders and
(b) the auto-advance partial is included when `autoAdvance: true`.

## What to build

Add four `it(...)` cases inside the existing `describe("buildPrompt", ...)` block
in `src/Prompt.test.ts`, using the existing `result(value, { autoAdvance, context })`
helper already defined in that file (do NOT add new helpers).

For the section assertion, grab a stable, leaf-specific string from each prompt
file under `src/prompts/` and assert `buildPrompt(...)` contains it. Read these
files to choose the exact substring — do NOT guess:

- `src/prompts/execute.md`
- `src/prompts/cleanup.md`
- `src/prompts/decompose.md`
- `src/prompts/execute-simple.md`

For the auto-advance assertion, assert the output contains `"Re-run gtd immediately"`
(the marker already used by the existing auto-advance tests in this file) when the
case is built with `autoAdvance: true`.

To prevent section cross-leak (mirroring the existing "renders exactly one section"
test), each case should also assert the output does NOT contain a distinctive
string from a different leaf's section.

Example skeleton (adapt the substrings to the real prompt content):

```ts
it("execute prompt renders its section and the auto-advance partial", () => {
  const out = buildPrompt(result("execute", { autoAdvance: true }))
  expect(out).toContain("<distinctive execute.md string>")
  expect(out).toContain("Re-run gtd immediately")
  expect(out).not.toContain("<distinctive string from another leaf>")
})
```

## Files

- `/Users/pmelab/Code/gtd/gtd/src/Prompt.test.ts` (add cases to the existing describe block)
- `/Users/pmelab/Code/gtd/gtd/src/Prompt.ts` (reference: `SECTIONS` mapping, `buildPrompt`)
- `/Users/pmelab/Code/gtd/gtd/src/prompts/{execute,cleanup,decompose,execute-simple}.md` (source the assertion substrings)
- `/Users/pmelab/Code/gtd/gtd/src/prompts/partials/auto-advance.md` (auto-advance partial)

## Constraints / edge cases

- Reuse the existing `baseContext` / `result` helpers; do not duplicate them.
- `execute` and `decompose` are package/TODO leaves — `result("execute", { autoAdvance: true })`
  with the default base context is sufficient; no special context is required for these
  prompt-rendering tests.
- Pick assertion substrings that are unique to each leaf so the cross-leak
  `not.toContain` assertion is meaningful.
- Per project AGENTS.md these are the test-coverage deliverable for the
  corresponding leaves; keep each `it` focused on one leaf.

## Acceptance criteria

- [ ] A test exists asserting the `execute` section renders and includes the auto-advance partial.
- [ ] A test exists asserting the `cleanup` section renders and includes the auto-advance partial.
- [ ] A test exists asserting the `decompose` section renders and includes the auto-advance partial.
- [ ] A test exists asserting the `execute-simple` section renders and includes the auto-advance partial.
- [ ] Each new test also asserts a different leaf's section does NOT leak in.
- [ ] Tests use the existing `result`/`baseContext` helpers.
- [ ] `npm test` (vitest) passes with the new cases.
