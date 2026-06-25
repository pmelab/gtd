## Task: Decompose `TODO.md` into work packages

The plan in `TODO.md` is finalized (no open questions). It needs to be
decomposed into executable work packages.

### Orchestration

You are running with a work model. Spawn a **planning-model subagent** using
model `{{MODEL}}` to perform the decomposition.

The subagent should create numbered directories in `.gtd/`, each representing a
sequential work package:

```
.gtd/
  01-<package-name>/
    01-<task-name>.md
    02-<task-name>.md
    COMMIT_MSG.md
  02-<package-name>/
    ...
```

**Rules for the subagent:**

1. **Packages are sequential, in dependency order** — Name directories with an
   ordinal prefix (`01-`, `02-`, …); they execute in that ordinal, dependency
   order and the set is frozen once written (no re-decomposition later). Package
   02 cannot start until 01 is complete, so order them so each package depends
   only on lower-numbered ones.

2. **Each package must be green on its own** — The project test suite runs after
   every package. Each package must leave the tree green on its own; never split
   a feature so the tree stays red until a later package lands.

3. **Tasks within a package are parallel and file-disjoint** — All tasks in a
   package run simultaneously, each via one subagent, writing to the same
   working tree with no isolation. Tasks must be file-disjoint: two tasks that
   would touch the same file must be **merged** into one task. If task B depends
   on task A, they must be in separate packages.

4. **Vertical slices, not horizontal** — Each package must be a thin vertical
   slice that cuts through all integration layers end-to-end:
   - Each package delivers a narrow but COMPLETE path (not "set up
     infrastructure")
   - A completed package is demoable or verifiable on its own
   - Prefer many thin packages over few thick ones

5. **Task files are self-contained** — Each task `.md` file must include:
   - Clear description of what to build
   - Acceptance criteria as checkboxes: `- [ ] Criterion`
   - Relevant file paths to examine
   - Any constraints or edge cases

6. **COMMIT_MSG.md** — Each package directory must contain a `COMMIT_MSG.md`
   with the conventional commit message to use when the package completes:

   ```
   <type>(<scope>): <subject>

   <body>
   ```

### After the subagent completes

1. Delete `TODO.md` (it's now captured in the work packages).
2. Leave all changes **uncommitted**.

Re-run gtd — the next cycle commits `.gtd/` (and the `TODO.md` deletion) with
the message `plan(gtd): decompose TODO.md into N work packages` (N derived by
the edge from the package count), preserving the user's plan and its full Q&A
history in git history.

The plan is now executable.
