# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

```diff
diff --git a/REVIEW.md b/REVIEW.md
index e60cd06..a6d22aa 100644
--- a/REVIEW.md
+++ b/REVIEW.md
@@ -4,6 +4,10 @@

 ## Harden await-review gate with STOP block

+We should generalize this. instead of adding that stop directive to the
+await-review prompt, it should be added to any prompt that is not tagged with
+`auto-advance`.
+
 The await-review prompt previously buried its stop instruction at the end as a
 soft directive. Moved it to a prominent ⛔ STOP block at the very top,
 explicitly naming the consequence (auto-approve + `gtd: done` commit) if the
```
