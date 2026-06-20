## Task: Execute simple task

`TODO.md` contains a simple task marked with `<!-- simple -->`. Execute it
directly without decomposing into work packages.

### Orchestration

You are running with a work model. You orchestrate the execution — you do not
implement the task yourself. Spawn subagents for implementation and testing.

Check your user/project AGENTS.md for model preferences (e.g., "use sonnet for
execution"). If no preference is set, use the current work model.

### Step 1: Spawn implementation worker

Spawn ONE **execution-model subagent** with:

- **Model**: The execution model from AGENTS.md (or current work model)
- **TDD discipline** (inline rules for worker):
  - Write ONE test → implement → pass → repeat (vertical slices)
  - **DO NOT** write all tests first then implement (horizontal slicing)
  - Tests verify behavior through public interfaces, not implementation details
  - Each test responds to what you learned from the previous cycle
- **Context**: The full content of `TODO.md` as the task specification
- **Fresh context**: Worker starts fresh, no conversation history

Wait for the worker to complete.

**If worker fails** (crash, timeout, error — not test failure): Report the
failure. Ask the user: "Retry / Abort?"

### Step 2: Spawn testing subagent

After the worker completes, spawn ONE **testing subagent**:

- **Model**: Execution model (same as worker)
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

1. Derive a conventional commit message from the task in `TODO.md`:
   - Use the task description to determine `<type>(<scope>): <subject>`
   - Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
2. Delete `TODO.md`
3. Commit all changes with the derived commit message

**If tests fail after max retries:**

Ask the user:

- "Commit anyway with WIP marker?"
- "Abort execution?"

Do not silently commit broken code or silently fail.
