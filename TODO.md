# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

```diff
diff --git a/REVIEW.md b/REVIEW.md
index b67b552..214c3d2 100644
--- a/REVIEW.md
+++ b/REVIEW.md
@@ -15,8 +15,8 @@ sense in the review state. The new wording generalises to "loop or advance
 without human input", which is accurate for `escalate`, `idle`, and the
 `grilling` stop-case too.

-- [ ] ./src/prompts/partials/stop.md#1
-- [ ] ./src/prompts/await-review.md#1
+- [x] ./src/prompts/partials/stop.md#1
+- [x] ./src/prompts/await-review.md#1

 ## Gate STOP banner in `buildPrompt`

@@ -33,7 +33,7 @@ One subtlety: `stopPartial` is pushed with a trailing `""` separator before
 and the context block rather than at the very top — reviewers should confirm
 this ordering is intentional for readability.

-- [ ] ./src/Prompt.ts#174
+- [x] ./src/Prompt.ts#174

 ## Update and extend STOP banner tests

@@ -54,5 +54,5 @@ Coverage looks complete for the new condition. One minor observation: the
 auto-advance test includes `result("clean")` twice (once standalone, once in the
 loop) — redundant but harmless.

-- [ ] ./src/Prompt.test.ts#89
-- [ ] ./src/Prompt.test.ts#194
+- [x] ./src/Prompt.test.ts#89
+- [x] ./src/Prompt.test.ts#194
diff --git a/src/Prompt.ts b/src/Prompt.ts
index bdd2038..19d9f0a 100644
--- a/src/Prompt.ts
+++ b/src/Prompt.ts
@@ -171,6 +171,7 @@ export const buildPrompt = (
   }
   const promptState = state as PromptState
   const parts: Array<string> = [header, ""]
+  // TODO: the stop partial should be added at the very end, like the auto-advance partial
   if (!result.autoAdvance && promptState !== "clean") parts.push(stopPartial, "")
   parts.push(buildContextBlock(context))

```
