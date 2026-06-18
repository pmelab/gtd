## Task: Execute all work packages

Work packages exist in `.gtd/`. Execute all packages sequentially, in numeric
order (01 before 02, etc.), without pausing between them.

### Orchestration

You are running with a work model. You orchestrate the execution — you do not
implement the tasks yourself. Spawn subagents for all implementation and
testing work.

Check your user/project AGENTS.md for model preferences (e.g., "use sonnet
for execution"). If no preference is set, use the current work model for
execution subagents.

### Step 1: Spawn task workers

For each task file in the current package, spawn a **parallel subagent** with:

- **Model**: The execution model from AGENTS.md (or current work model)
- **TDD discipline** (inline rules for workers):
  - Write ONE test → implement → pass → repeat (vertical slices)
  - **DO NOT** write all tests first then implement (horizontal slicing)
  - Tests verify behavior through public interfaces, not implementation details
  - A good test survives refactors — if renaming an internal function breaks the test, it's testing implementation
  - Each test responds to what you learned from the previous cycle
- **Context**: The task file content only (self-contained)
- **Fresh context**: Each worker starts fresh, no conversation history

Wait for all workers to complete.

**If any worker fails** (crash, timeout, error — not test failure):
Report which tasks failed. Ask the user: "Retry failed tasks / Skip and
continue / Abort?"

### Step 2: Spawn testing subagent

After all workers complete, spawn ONE **testing subagent**:

- **Model**: Execution model (same as workers)
- **Context**: Fresh

The testing subagent should:

1. Determine the test command from project configuration (AGENTS.md,
   `package.json` scripts, Makefile, etc.). If unclear, ask the user.
2. Run the tests
3. If tests fail, analyze failures and fix them
4. Repeat until tests pass or retry limit reached (default: 5, check AGENTS.md)
5. Report final status: PASS or FAIL with summary

### Step 3: Handle results

**If tests pass:**

1. Read `COMMIT_MSG.md` from the current package
2. Delete the package directory from `.gtd/`
3. Commit all changes with the commit message from `COMMIT_MSG.md`

**If tests fail after max retries:**

Ask the user:
- "Commit anyway with WIP marker?"
- "Skip this package and continue?"
- "Abort execution?"

Do not silently commit broken code or silently fail.

### Continue to next package

After committing a package:
1. Delete the package directory from `.gtd/`
2. Check if more packages remain in `.gtd/`
3. If yes: return to Step 1 for the next package
4. If no: done — all packages complete. The `.gtd/` cleanup will be handled
   on the next `/gtd` invocation if the directory remains.
