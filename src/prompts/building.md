## Task: Build one work package

gtd selected the package to build this run and inlined its task contents below.
Build exactly this package — do not browse `.gtd/`, choose a different package,
or loop over other packages. Leave the work uncommitted; the next gtd run
commits and tests it.

### Orchestration

You orchestrate the execution — you do not implement the tasks yourself. Spawn
**one subagent per task** in the package below, all in **parallel**, each using
model `{{MODEL}}`:

- **Context**: the task content only (it is self-contained).
- **Fresh context**: each worker starts cold, with no shared history.
- **TDD discipline** (inline rules for workers):
  - Write ONE test → implement → pass → repeat (vertical slices).
  - **Do NOT** write all tests first then implement (horizontal slicing).
  - Tests verify behavior through public interfaces, not implementation details
    — a good test survives a refactor.

Wait for all workers to complete. **If any worker fails** (crash, timeout, error
— not a test failure): report which tasks failed and ask the user whether to
retry the failed tasks, skip and continue, or abort.

### No TODO.md during the build loop

`TODO.md` was deleted at the start of the build loop (committed under
`gtd: planning`). Its absence is intentional — the `.gtd/` task files are the
sole source of truth from here on.

### Leave the work uncommitted

Do **not** commit, do **not** delete the package directory, and do **not** touch
`.gtd/`. Leave every change uncommitted. The next gtd run commits the package as
`gtd: building`, then runs the test suite to verify it — do not run or determine
a test command here.
