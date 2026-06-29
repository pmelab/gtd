## Task: Decompose the plan into work packages

The plan in `TODO.md` is settled (no open questions). Decompose it into an
ordered set of executable work packages under `.gtd/`. If `.gtd/` already holds
packages from an earlier turn, continue and refine them rather than starting
over.

### Orchestration

Spawn a **planning-model subagent** using model `{{MODEL}}` to perform the
decomposition. It creates numbered package directories, each holding numbered
task files:

```
.gtd/
  01-<package-name>/
    01-<task-name>.md
    02-<task-name>.md
  02-<package-name>/
    ...
```

**Rules for the subagent:**

1. **Packages are sequential, in dependency order** — ordinal-prefixed
   directories (`01-`, `02-`, …) execute in that order and the set is frozen
   once written. Order them so each package depends only on lower-numbered ones.

2. **Each package is green on its own** — the test suite runs after every
   package. Never split a feature so the tree stays red until a later package
   lands.

3. **Tasks within a package are parallel and file-disjoint** — all tasks in a
   package run simultaneously, each via one subagent, against the same working
   tree with no isolation. Two tasks that would touch the same file must be
   **merged** into one. If task B depends on task A, put them in separate
   packages.

4. **Vertical slices, not horizontal** — each package is a thin, end-to-end
   slice that is demoable or verifiable on its own. Prefer many thin packages
   over few thick ones; never a "set up infrastructure" package.

5. **Task files are self-contained** — each task `.md` includes a clear
   description of what to build, acceptance criteria as `- [ ] Criterion`
   checkboxes, the relevant file paths to examine, and any constraints or edge
   cases.

### After the subagent completes

Leave `TODO.md` in place — it is the plan of record while the packages are
built. Leave every change **uncommitted**; the next gtd cycle commits `.gtd/` as
`gtd: planning`, preserving the plan and its full Q&A history in git. The plan
is now executable.
