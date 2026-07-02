# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

```diff
diff --git a/TODO.md b/TODO.md
new file mode 100644
index 0000000..336dec8
--- /dev/null
+++ b/TODO.md
@@ -0,0 +1,3 @@
+scan all prompts. only the "advance" and "no-advance" suffixes should contain
+instructions around running or not running `gtd`. it should be cleaned out of
+all other prompts.
diff --git a/package-lock.json b/package-lock.json
index c7e8ebe..ddfa882 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,12 +1,12 @@
 {
   "name": "gtd",
-  "version": "1.1.0",
+  "version": "1.2.1",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "gtd",
-      "version": "1.1.0",
+      "version": "1.2.1",
       "license": "MIT",
       "dependencies": {
         "@effect/platform": "^0.94.2",
```
