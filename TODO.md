# Plan

## Captured input

These changes were captured as the starting point for this feature. Develop them
into a concrete plan and surface any open questions for the user.

```diff
diff --git a/REVIEW.md b/REVIEW.md
index c169d79..22e7dce 100644
--- a/REVIEW.md
+++ b/REVIEW.md
@@ -8,14 +8,14 @@ CI now runs the test suite on Node 22 instead of Node 20, matching the new
 `engines.node` floor. Verify the workflow still installs and runs correctly on
 the bumped runtime.

-- [ ] ./.github/workflows/test.yml#16
+- [x] ./.github/workflows/test.yml#16

 ## Require Node >= 22

 `engines.node` raised from `>=20` to `>=22`. Confirm nothing in the codebase
 relies on Node 20-only behavior and that the new floor is intentional.

-- [ ] ./package.json#12
+- [x] ./package.json#12

 ## Pre-commit hook: husky + lint-staged

@@ -25,15 +25,15 @@ runs `npx lint-staged`; the `lint-staged` config formats any staged file via
 `prettier --ignore-unknown --write`. `husky` and `lint-staged` added as
 devDependencies.

-- [ ] ./.husky/pre-commit#1
-- [ ] ./package.json#16
-- [ ] ./package.json#30
-- [ ] ./package.json#44
-- [ ] ./package.json#46
+- [x] ./.husky/pre-commit#1
+- [x] ./package.json#16
+- [x] ./package.json#30
+- [x] ./package.json#44
+- [x] ./package.json#46

 ## README: document the pre-commit hook

 New "Pre-commit hook" subsection under Development explaining the auto-installed
 hook and what lint-staged runs. Check the wording matches the actual config.

-- [ ] ./README.md#544
+- [x] ./README.md#544
```
