# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

```diff
diff --git a/REVIEW.md b/REVIEW.md
index 23915e7..35f7dc4 100644
--- a/REVIEW.md
+++ b/REVIEW.md
@@ -11,6 +11,9 @@ Now, when `packages.length <= 1`, it removes TODO.md (after `removePackageDir`,
 before `commitAllWithPrefix`) so the next run falls through to rule 7
 (Clean/Idle). The doc comment is updated to note the last-package removal.

+TODO.md should be removed after decomposition. the subagents should only get
+their concrete tasks as context
+
 - [ ] ./src/Events.ts#387
 - [ ] ./src/Events.ts#379

@@ -32,4 +35,6 @@ rule 6 vs rule 7 rationale.

 ## Resolved

+this resolved section in the REVIEW.md is not needed
+
 <!-- resolved items move here as the user works through the review -->
```
