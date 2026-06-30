# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

```diff
diff --git a/TODO.md b/TODO.md
new file mode 100644
index 0000000..8bd8283
--- /dev/null
+++ b/TODO.md
@@ -0,0 +1,8 @@
+After `gtd: package done` closes the last package, TODO.md is still present on
+disk. Row 6 of the state table (TODO.md + no marker + clean → Grilled) has
+higher priority than row 7 (boundary/package-done HEAD + clean → Clean), so the
+machine loops: Grilled commits an empty `gtd: grilled`, re-resolves to Grilled
+again, forever. The workaround was to manually delete TODO.md and make a
+boundary commit. Fix: Close Package should delete TODO.md when it removes the
+last `.gtd/` dir (i.e. when `.gtd/` is now empty after removal), so the next run
+sees no TODO.md and advances to Clean.
```
