# Execute All Work Packages in One Run

## Summary

Change the gtd agent to execute all work packages sequentially in a single
invocation, instead of stopping after each package and requiring the user to
re-invoke `/gtd`.

**Why:** Currently, executing a decomposed plan requires N manual `/gtd`
invocations (one per package). This adds friction and prevents fully autonomous
execution of a planned change.

## Current Behavior

**State detection** (`src/State.ts`):
- `detect()` returns all packages in `.gtd/` via `getPackages()`
- Packages are sorted numerically (`01-*`, `02-*`, etc.)

**Prompt generation** (`src/Prompt.ts`, `src/prompts/execute.md`):
- When packages exist, the `execute` branch is pushed
- The prompt explicitly says: _"Execute the **lowest-numbered** package"_
- After Step 3, it says: _"After committing, the **next `/gtd` invocation** will
  pick up the next package"_

**Result:** The agent executes ONE package, commits, and stops. User must
re-invoke `/gtd` for the next package.

## Proposed Change

Modify `src/prompts/execute.md` to instruct the agent to loop through ALL
packages sequentially in a single run.

**New behavior:**
1. For each package in `.gtd/` (in numeric order), **without pausing between packages**:
   - Execute all tasks in parallel (Step 1)
   - Run tests (Step 2)
   - Handle results and commit (Step 3)
   - Delete package dir, continue immediately to the next
2. Cleanup (empty `.gtd/` removal) remains a separate branch — handles edge case of manually-emptied `.gtd/`
3. The existing "Abort / Skip / Commit WIP" prompt handles mid-execution test failures

## Implementation Details

### 1. Update `src/prompts/execute.md`

**Replace:**
```markdown
## Task: Execute the next work package

Work packages exist in `.gtd/`. Execute the lowest-numbered package.
```

**With:**
```markdown
## Task: Execute all work packages

Work packages exist in `.gtd/`. Execute all packages sequentially, in numeric
order (01 before 02, etc.).
```

**Replace the "Continue" section:**
```markdown
### Continue

After committing, the next `/gtd` invocation will pick up the next package
(or proceed to cleanup if none remain).
```

**With:**
```markdown
### Continue to next package

After committing a package:
1. Delete the package directory from `.gtd/`
2. Check if more packages remain in `.gtd/`
3. If yes: return to Step 1 for the next package
4. If no: delete the empty `.gtd/` directory (cleanup complete)
```

### 2. Update `src/prompts/cleanup.md` (optional simplification)

The cleanup step may become redundant since the execute loop now handles
`.gtd/` deletion. Consider:
- Keeping it for edge cases (manual intervention left `.gtd/` empty)
- OR removing the separate cleanup branch entirely

### 3. Update tests

Add scenario to `tests/integration/features/branches.feature`:
```gherkin
Scenario: Execute prompt mentions all packages, not just the first
  Given a test project
  And a commit "plan" that adds ".gtd/01-foo/01-task.md" with:
    """
    First task
    """
  And a commit "plan" that adds ".gtd/02-bar/01-task.md" with:
    """
    Second task
    """
  When I run gtd
  Then stdout contains "## Task: Execute all work packages"
  And stdout contains "01-foo"
  And stdout contains "02-bar"
```

