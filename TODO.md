# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop
them into a concrete plan and surface any open questions for the user.

```diff
diff --git a/TODO.md b/TODO.md
new file mode 100644
index 0000000..8432d8c
--- /dev/null
+++ b/TODO.md
@@ -0,0 +1,40 @@
+# feat: squash all gtd commits into one after done
+
+Closes #35.
+
+## Problem
+
+A completed gtd process leaves behind many small intermediate commits (grilling,
+planning, individual work packages) that pollute the git history.
+
+## Proposal
+
+After the `done` state, automatically:
+
+1. Scan the full diff of the entire gtd process (from branch point to HEAD)
+2. Generate an appropriate, conventional-commits-style commit message summarizing the work
+3. Squash all gtd-process commits into a single commit with that message
+
+## Acceptance Criteria
+
+- Squash only touches commits that belong to the current gtd process (identified by gtd commit prefixes)
+- Generated commit message follows conventional commits format
+- User is shown the generated message before squash is applied (or can configure auto-squash)
+- Works correctly when the branch has upstream commits interleaved (should not squash those)
+
+## Questions
+
+- [ ] Where in the state machine does the squash trigger? On transition to `done`, or as a separate post-done action?
+- [ ] How are "gtd commits" identified? By commit prefix conventions (e.g. `Gtd-Plan:`, `Gtd-Work:`, etc.)?
+- [ ] Should the squash be opt-in (config flag) or opt-out?
+- [ ] What happens if squash fails (e.g. merge conflicts after rebase)?
+
+## Work Packages
+
+- [ ] Understand gtd commit prefix conventions in the codebase
+- [ ] Implement logic to find all gtd commits since branch point (skipping interleaved non-gtd commits)
+- [ ] Generate conventional-commits summary via LLM from full diff
+- [ ] Wire squash into state machine after `done` transition
+- [ ] Show generated message to user before applying (or add `autoSquash` config option)
+- [ ] Add cucumber scenario for squash behavior
+- [ ] Update README
```
