# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

```diff
diff --git a/TODO.md b/TODO.md
new file mode 100644
index 0000000..c186a00
--- /dev/null
+++ b/TODO.md
@@ -0,0 +1,9 @@
+we need to refine the rules which commit ranges REVIEW.md should span under
+which circumstances:
+
+1. after first building a new task, it should cover the whole task
+2. after providing review feedback and the build is done, the next review should
+   cover only the code changes requested by the feedback
+3. on a feature branch, when not within a gtd process (between "gtd: new task"
+   and "gtd: done"), cover the whole branch
+4. on the default branch, skip the review if not within a gtd process
```
