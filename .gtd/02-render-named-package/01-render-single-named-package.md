# Task: Render a single-named-package execute prompt with inlined task contents

Rewrite the execute prompt so it pinpoints the ONE lowest-numbered package and
inlines the FULL CONTENTS of that package's task `.md` files directly, making
the prompt self-contained — the agent never opens `.gtd/` or chooses a package.
Consumes the widened `GtdPackageFact` shipped by package `01-edge-inline-fact`.

## Shared contract (PINNED — produced by package 01)

`result.context.packages[0]` is the lowest-numbered package (edge sorts
ascending). Each `GtdPackageFact` has:

```ts
{
  name: string                  // e.g. "01-foo"
  tasks: ReadonlyArray<string>  // filenames, sorted
  taskContents: ReadonlyArray<{ name: string; content: string }>  // sorted to tasks
  hasCommitMsg: boolean
}
```

`buildPrompt(result, override?)` signature is UNCHANGED. The execute section
still comes from `SECTIONS["execute"]` = `src/prompts/execute.md`. The new
inlined-package block is rendered by `Prompt.ts` (NOT hardcoded in the .md) so
it can interpolate `packages[0]`.

## Implementation

- `src/prompts/execute.md`: rewrite to the single-named-package framing. REMOVE:
  "execute EXACTLY ONE package — the lowest-numbered remaining", "pick the first
  one" / "The Context block lists the packages", and the instruction to read
  `COMMIT_MSG.md` from / browse `.gtd/` to find the package. The prompt now
  refers to "the package below" / "the task contents below" — gtd has already
  selected and inlined them. KEEP: orchestration (spawn parallel subagents, TDD
  discipline, model preference from AGENTS.md), worker-failure handling,
  commit-with-`COMMIT_MSG.md`, delete the package dir, re-run gtd, and the
  existing no-verification-here note (the edge verifies next cycle).
- `src/Prompt.ts`: when `result.value === "execute"` and `packages.length > 0`,
  append an inlined block for `result.context.packages[0]` AFTER the execute
  section:
  - heading naming the package: `### Package: \`<name>/\``
  - when `hasCommitMsg`, instruct committing with `<name>/COMMIT_MSG.md` verbatim
    (do NOT inline COMMIT_MSG.md contents — the plan says inline task files and
    "note" the COMMIT_MSG)
  - for each `taskContents` entry: a sub-heading with the task filename, then the
    raw `content` wrapped in a fence chosen via the existing `fenceFor` helper
    (content may contain backticks/checkbox lists/fenced code — reuse `fenceFor`,
    never hardcode a 3-backtick fence)
  - render this block ONLY for the execute leaf; all other leaves unaffected.
- The multi-package `buildContext` listing is additive/left intact — do NOT
  regress it; the inlined block is execute-specific and additive.

## Acceptance criteria

- [ ] `execute.md` no longer contains "EXACTLY ONE package", "lowest-numbered",
      or "pick the first" wording.
- [ ] For an execute result with `packages = [{ name: "01-foo", tasks:
      ["01-task.md"], taskContents: [{ name: "01-task.md", content: "First
      task" }], hasCommitMsg: true }]`, `buildPrompt` output contains: the package
      name `01-foo`, the task filename `01-task.md`, the inlined content `First
      task`, and a reference to `COMMIT_MSG.md`.
- [ ] Inlined content containing backticks is fenced with a long-enough fence.
- [ ] Vitest (`src/Prompt.test.ts`): update the existing "execute prompt renders
      its section" test — it currently asserts the now-removed "EXACTLY ONE
      package"; replace with assertions for the named package + a fed `packages`
      fixture (extend the `baseContext`/`result` helper usage to pass `packages`)
      proving the inlined task content appears. Add an assertion that
      `does not contain` "EXACTLY ONE package"/"lowest-numbered".
- [ ] e2e: update `tests/integration/features/execute-gate.feature` green-gate
      scenario AND `branches.feature` execute scenarios. The green-gate scenario
      currently asserts `stdout contains "EXACTLY ONE package"` and
      `"lowest-numbered package"` — replace with: stdout names the package
      (`01-foo`), stdout CONTAINS the inlined task body (`First task`), and stdout
      `does not contain "lowest-numbered"`. In `branches.feature` the
      "Existing .gtd with packages triggers execute" scenario should additionally
      assert the inlined task body (`Implement the add function`) appears. Use the
      existing composable Given steps (`a commit ... that adds .gtd/NN-.../...md
      with: """..."""`).

## Constraints / edge cases

- Only render the inlined block when `result.value === "execute"` AND
  `packages.length > 0` (always true for execute via `hasPackages`, but guard
  defensively).
- Do NOT change `buildPrompt`'s signature or the fix-tests override path.
- Package with zero task files: render package name + COMMIT_MSG note, no task
  blocks; must not crash.
- This package is the next sequential step after `01-edge-inline-fact`; assume
  the widened fact already exists in `src/Machine.ts`/`src/Events.ts`.

## Relevant files

- `src/prompts/execute.md`
- `src/Prompt.ts` (`buildPrompt`, reuse `fenceFor`)
- `src/Prompt.test.ts`
- `tests/integration/features/execute-gate.feature`
- `tests/integration/features/branches.feature`
