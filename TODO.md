# Remove 💬 FEEDBACK — Merge into 🤦 HUMAN

## Action Items

### Core Type: Remove FEEDBACK Entirely

- [x] Delete `FEEDBACK = "💬"` constant and its entry in `ALL_PREFIXES` in
      `CommitPrefix.ts`
  - Remove the `FEEDBACK` export, drop it from the `CommitPrefix` union type,
    and remove it from `ALL_PREFIXES`
  - Tests: `src/services/CommitPrefix.test.ts` — remove any assertions for
    `FEEDBACK`; verify `ALL_PREFIXES` no longer contains `"💬"`

### commit-feedback: Use 🤦 HUMAN Instead of 💬 FEEDBACK

- [x] In `src/commands/commit-feedback.ts`, replace all `FEEDBACK` prefix
      assignments with `HUMAN`
  - Lines that push `{ prefix: FEEDBACK, patch: ... }` for `humanTodos` and
    `feedback` content should become `{ prefix: HUMAN, patch: ... }`
  - The combined `humanTodos + feedback` branch as well as the individual
    branches both switch to `HUMAN`
  - Tests: `src/commands/commit-feedback.test.ts` — all `startsWith("💬")`
    assertions updated to `startsWith("🤦")`

### DiffClassifier: classifyPrefix Returns 🤦 Instead of 💬

- [x] In `src/services/DiffClassifier.ts`, change `classifyPrefix` to return
      `HUMAN` when `feedback` is non-empty
  - Line: `if (feedback) return FEEDBACK` → `if (feedback) return HUMAN`
  - `humanTodos` already returned `HUMAN`; feedback content should now be the
    same
  - Tests: `src/services/DiffClassifier.test.ts` — `classifyPrefix` tests that
    previously asserted `"💬"` now assert `"🤦"`

### InferStep: Remove Legacy 💬 Case

- [x] Remove the `case FEEDBACK` branch from `src/services/InferStep.ts`
  - Delete the case entirely; no old-repo backward compat is needed
  - Tests: `src/services/InferStep.test.ts` — remove any test cases that use
    `lastCommitPrefix: FEEDBACK`

### DecisionTree: Remove FEEDBACK Label and Reason

- [x] In `src/services/DecisionTree.ts`, remove the
      `case FEEDBACK: return "feedback"` label branch and `case FEEDBACK` in
      `describeReason`
  - Delete both case entries; `FEEDBACK` is no longer a valid prefix
  - Tests: `src/services/DecisionTree.test.ts` — remove assertions for the
    `"feedback"` label; verify no remaining reference to `FEEDBACK`

### CLI: Remove FEEDBACK from Routing Guards

- [x] In `src/cli.ts`, remove `FEEDBACK` from the
      `lastPrefix === HUMAN || lastPrefix === FEEDBACK` guard and the
      `prefix !== HUMAN && prefix !== FEEDBACK` filter
  - Replace each compound condition with the single `HUMAN` check
  - Tests: `src/cli.test.ts` — routing guards trigger correctly on `HUMAN`
    alone; remove any test cases for legacy `💬` sessions

### Tests: Update Expectations from 💬 to 🤦

- [x] Update `src/commands/commit-feedback.test.ts` — replace all
      `startsWith("💬")` assertions with `startsWith("🤦")`
  - Tests: "separate commits for fixes (👷) and human todos", "single commit
    with 💬", "mixed feedback + fixes", "mixed seed + code TODOs + fixes",
    "HUMAN + FEEDBACK combined", end-to-end, and the lastCommitPrefix assertion
- [x] Update `src/services/DiffClassifier.test.ts` — update `classifyPrefix`
      tests that assert `"💬"` to assert `"🤦"`
  - Tests: "returns 💬 for feedback on existing TODO file", "returns 💬 when
    feedback is mixed with humanTodos", "returns 💬 when feedback is mixed with
    fixes", and the priority-order test (`🌱.*💬.*🤦` → `🌱.*🤦.*🤦` or de-dup)
- [x] Update `src/services/CommitPrefix.test.ts` — remove all `FEEDBACK`
      assertions
  - Delete tests for the `FEEDBACK` constant and its presence in `ALL_PREFIXES`
  - Tests: `src/services/CommitPrefix.test.ts` — no `FEEDBACK` constant test or
    `ALL_PREFIXES` membership check remains
- [x] Update `src/services/InferStep.test.ts` — remove test cases for
      `lastCommitPrefix: FEEDBACK`
  - These tests are no longer valid once the case is removed from `InferStep.ts`
  - Tests: `src/services/InferStep.test.ts` — no test case uses
    `lastCommitPrefix: FEEDBACK`
- [x] Update `src/readme.test.ts` — remove or update assertions that expect `💬`
      in the README workflow and decision tree sections
  - Remove snapshot/string checks for `💬` in the prefix table, workflow
    narrative, and Mermaid diagram
  - Tests: `src/readme.test.ts` — no assertion matches the literal `💬`
    character; updated snapshots reflect `🤦` throughout

### README: Remove 💬 FEEDBACK from Documentation

- [x] Remove `💬` from the commit-prefix table in `README.md`
  - No backward-compat note needed; the prefix is gone
  - Tests: `src/readme.test.ts` — prefix table section no longer contains `💬`
- [x] Update the "Review and give feedback" workflow step to say feedback is
      committed as `🤦 HUMAN` (not `💬`)
  - Change the prose description in the workflow section so readers know
    feedback now uses the `🤦` prefix
  - Tests: `src/readme.test.ts` — "Review and give feedback" section mentions
    `🤦 HUMAN`; no mention of `💬` as the produced prefix
- [x] Update the Mermaid decision-tree diagram — remove `💬` node / edge; `🤦`
      now covers all human feedback
  - Delete the `💬` node and any edges leading to or from it; verify the diagram
    still renders a valid flowchart
  - Tests: `src/readme.test.ts` — Mermaid source does not contain `💬`; `🤦`
    node is present and connected

### Plan Prompt: Reflect New Commit Behaviour

- [x] In `src/prompts/plan.md`, update the section that describes how the
      planning agent handles feedback commits
  - Remove any reference to a separate `💬 FEEDBACK` type; feedback commits use
    `🤦 HUMAN`
  - Clarify that after a `🤦 HUMAN` commit the planning agent removes
    blockquotes from `TODO.md` and commits the cleaned file as a new `🤖 PLAN`
    commit
  - Tests: `src/prompts/plan.test.ts` (or snapshot) — prompt text references
    `🤦 HUMAN` for feedback commits and does not mention a separate `💬` type
