## Open Questions

### Should "simple" be decided by AI or user?

**Recommendation:** Planning model decides during new-todo phase.

Reasoning:
- User already writes the TODO.md sketch → forcing them to also decide "simple vs complex" adds friction
- Planning model sees the task scope anyway during questioning → can judge complexity
- If wrong, user can override by adding questions to force more planning

Alternative: User marker like `<!-- simple -->` at top of TODO.md. More predictable but adds ceremony.

<!-- user answers here -->

### What threshold defines "simple"?

**Recommendation:** Single-file change OR < 50 lines of implementation expected.

Heuristics the planning model could use:
- Touches ≤ 1 file
- No new dependencies/infrastructure
- No multi-step workflows
- Can be described in one sentence
- No cross-cutting concerns (e.g., "add logging everywhere")

Alternative: Let planning model decide without strict rules — it has context we don't.

<!-- user answers here -->

### Should simple tasks skip verification/testing?

**Recommendation:** No — keep the test step, just skip decomposition.

The test subagent in execute.md is valuable even for simple changes. Skipping decomposition saves the overhead of creating `.gtd/` packages, but testing catches regressions.

<!-- user answers here -->

---

## Plan

### Current Flow (for reference)

```
new-todo → modified-todo (iterating) → decompose → execute → cleanup → verify
```

### Proposed Simple Task Flow

```
new-todo → modified-todo (iterating) → [planning model decides simple] → execute-simple → verify
                                     ↓
                              [complex] → decompose → execute → cleanup → verify
```

### Implementation

#### 1. New branch type: `execute-simple`

Add to `State.ts`:
```typescript
export type Branch = ... | "execute-simple"
```

Detection logic in `detect()`:
- When tree clean + todoFinalized + no `.gtd/`:
  - Check if TODO.md has a `<!-- simple -->` marker
  - If yes → `execute-simple`
  - If no → `decompose`

#### 2. New prompt: `src/prompts/execute-simple.md`

Simplified execute that:
- Uses TODO.md directly as the task spec (no `.gtd/` structure)
- Spawns single worker subagent with TODO.md content
- Runs tests afterward (same as regular execute)
- On success: delete TODO.md, commit with conventional commit derived from task
- No COMMIT_MSG.md needed — planning model includes commit message in TODO.md

#### 3. Modify new-todo.md / modified-todo.md

Add instruction to planning-model subagent:
- If task is simple (single-file, small scope), add `<!-- simple -->` marker at end of TODO.md
- If complex, omit marker (default to decompose path)

Planning model criteria:
- Estimated ≤ 1 file changed
- No new test files needed (modifying existing tests OK)
- No architectural decisions
- Implementation is obvious from description

#### 4. Modify State.ts detection

```typescript
// In detect(), after checking todoFinalized:
const todoContent = yield* fs.readFileString(TODO_FILE)
const isSimple = todoContent.includes("<!-- simple -->")
if (isSimple) {
  branches.push("execute-simple")
} else {
  branches.push("decompose")
}
```

#### 5. Update Prompt.ts

- Import new `execute-simple.md`
- Add to `SECTIONS` map
- Add to `AUTO_ADVANCE_BRANCHES`

### Files to Change

- `src/State.ts` — add branch type, detection logic
- `src/Prompt.ts` — import/register new prompt
- `src/prompts/execute-simple.md` — new file
- `src/prompts/new-todo.md` — add simple-task marking instruction
- `src/prompts/modified-todo.md` — add simple-task marking instruction
- `tests/integration/features/branches.feature` — test scenarios

### Test Scenarios

```gherkin
Scenario: TODO.md with simple marker triggers execute-simple
  Given a test project
  And a commit "docs: seed plan" that adds "TODO.md" with:
    """
    Add a greeting to the CLI output

    <!-- simple -->
    """
  When I run gtd
  Then it succeeds
  And stdout contains "## Task: Execute simple task"
  And stdout does not contain "## Task: Decompose"

Scenario: TODO.md without simple marker triggers decompose
  Given a test project
  And a commit "docs: seed plan" that adds "TODO.md" with:
    """
    Refactor authentication to use JWT
    """
  When I run gtd
  Then it succeeds
  And stdout contains "## Task: Decompose"
```

## Answered Questions

_(none yet)_
