<%~ include("@header") %>

<%~ include("@context", { context: it.context, fenceFor: it.fenceFor }) %>
`TODO.md` contains an implementation plan. Decompose it into an ordered set of
executable work packages stored in the `.gtd/` directory. If `.gtd/` already
holds packages from an earlier turn, immediately abort and raise an error.

Spawn a **planning-model subagent** using model `<%= it.model %>` to perform the
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
   cases. It is the only context building agents will receive to work on the
   task.

**DO NOT** commit any changes. This process runs within a larger orchestration
that depends on uncommitted changes.

<%~ include(it.tail) %>
