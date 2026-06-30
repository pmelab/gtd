# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop
them into a concrete plan and surface any open questions for the user.

```diff
diff --git a/TODO.md b/TODO.md
new file mode 100644
index 0000000..c67c4dd
--- /dev/null
+++ b/TODO.md
@@ -0,0 +1,18 @@
+# Fix: Transport root-commit crash (issue #9)
+
+## Goal
+Fix the 100-hop crash when a `gtd: transport` commit is the repo's root commit.
+
+## Problem
+`mixedResetHead()` in `src/Git.ts:145` runs `git reset HEAD~1`, which fails silently on a root commit because it uses `Command.string` (resolves even on non-zero exit). The failure is swallowed, the tree is unchanged, Transport re-resolves forever, and the driver dies at `MAX_EDGE_HOPS`.
+
+Also, `hasCommits()` at `:88` uses `Command.string` and effectively always returns `true`.
+
+## Solution
+1. Change `mixedResetHead()` to use `Command.exitCode` so it fails on non-zero exit.
+2. Add a guard: before running `git reset HEAD~1`, check if HEAD has a parent (i.e., it's not a root commit). If it is the root commit, return a clear `Effect.fail` with a descriptive error message ("transport commit has no parent").
+3. Fix `hasCommits()` to use `Command.exitCode` so it correctly returns `false` on a repo with no commits.
+
+## Constraints
+- Follow the existing `Command.exitCode` pattern already used in `isAncestor` / `removePackageDir`
+- Add a cucumber.js scenario for the root-commit transport edge case
```
