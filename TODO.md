# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

Interpret the captured diff with these rules:

- **Code changes** are suggestions, not finished work — plan to re-implement
  them properly, including test coverage, rather than restoring them verbatim.
- **Code comments** are positional feedback about the code at that location.
- **TODO.md / REVIEW.md text changes** are global feedback on the plan or the
  reviewed work as a whole.
- **Checkbox flips** in a captured REVIEW.md diff are approval noise — ignore
  them.

```diff
diff --git a/REVIEW.md b/REVIEW.md
index ff393bc..259cd52 100644
--- a/REVIEW.md
+++ b/REVIEW.md
@@ -13,12 +13,15 @@ existing Clean/Idle branch otherwise. Adds
 `squashBase`/`squashDiff` through `ResolveContext` via `buildContext`, and
 defaults `squashEnabled: false` in `DEFAULT_PAYLOAD`.

-- [ ] ./src/Machine.ts#38
-- [ ] ./src/Machine.ts#151
-- [ ] ./src/Machine.ts#221
-- [ ] ./src/Machine.ts#322
-- [ ] ./src/Machine.ts#337
-- [ ] ./src/Machine.ts#611
+the commit itself should happen on the edge. the agent should only generate the
+commit message
+
+- [x] ./src/Machine.ts#38
+- [x] ./src/Machine.ts#151
+- [x] ./src/Machine.ts#221
+- [x] ./src/Machine.ts#322
+- [x] ./src/Machine.ts#337
+- [x] ./src/Machine.ts#611

 ## Compute squash base and diff at the edge

@@ -54,6 +57,9 @@ from the full diff, then run `git reset --soft <squashBase>` + `git commit`
 unconditionally, mirroring the `clean.md` handoff pattern with an auto-advance
 tail.

+the commit message body should also contain any important decisions from
+grilling sessions
+
 - [ ] ./src/Prompt.ts#8
 - [ ] ./src/Prompt.ts#50
 - [ ] ./src/Prompt.ts#61
```
