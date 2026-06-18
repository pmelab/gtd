## Task: Decompose `TODO.md` into work packages

The plan in `TODO.md` is finalized (no open questions). It needs to be
decomposed into executable work packages.

### Orchestration

You are running with a work model. Spawn a **planning-model subagent** to
perform the decomposition. Check your user/project AGENTS.md for model
preferences (e.g., "use opus for planning"). If no preference is set, default
to a high-reasoning model like Claude Opus.

The subagent should create numbered directories in `.gtd/`, each representing
a sequential work package:

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

1. **Packages are sequential** — Package 02 cannot start until 01 is complete.
   Use this for dependencies between groups of work.

2. **Tasks within a package are parallel** — All tasks in a package run
   simultaneously. If task B depends on task A, they must be in separate
   packages.

3. **Vertical slices, not horizontal** — Each package must be a thin vertical
   slice that cuts through all integration layers end-to-end:
   - Each package delivers a narrow but COMPLETE path (not "set up infrastructure")
   - A completed package is demoable or verifiable on its own
   - Prefer many thin packages over few thick ones

4. **Task files are self-contained** — Each task `.md` file must include:
   - Clear description of what to build
   - Acceptance criteria as checkboxes: `- [ ] Criterion`
   - Relevant file paths to examine
   - Any constraints or edge cases

5. **COMMIT_MSG.md** — Each package directory must contain a `COMMIT_MSG.md`
   with the conventional commit message to use when the package completes:

   ```
   <type>(<scope>): <subject>

   <body>
   ```

### After the subagent completes

1. Delete `TODO.md` (it's now captured in the work packages)
2. Commit `.gtd/` with message: `plan(gtd): decompose TODO.md into N work packages`

The plan is now executable. The next `/gtd` invocation will begin execution.
