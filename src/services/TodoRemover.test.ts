import { describe, test, expect } from "vitest"
import { findNewlyAddedTodos } from "./TodoRemover.js"

describe("findNewlyAddedTodos", () => {
  test("finds TODO comments in newly added lines of non-plan files", () => {
    const diff = `diff --git a/src/math.ts b/src/math.ts
index abc1234..def5678 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,2 +1,3 @@
+// TODO: never use magic numbers, always use named constants
 export const add = (a: number, b: number): number => a + b
 // fixed`

    const result = findNewlyAddedTodos(diff, "TODO.md")
    expect(result).toEqual([
      {
        file: "src/math.ts",
        lineContent: "// TODO: never use magic numbers, always use named constants",
      },
    ])
  })

  test("ignores TODO comments in the plan file", () => {
    const diff = `diff --git a/TODO.md b/TODO.md
index abc1234..def5678 100644
--- a/TODO.md
+++ b/TODO.md
@@ -1,2 +1,3 @@
+// TODO: this should be ignored
 some content`

    const result = findNewlyAddedTodos(diff, "TODO.md")
    expect(result).toEqual([])
  })

  test("ignores lines that are not additions", () => {
    const diff = `diff --git a/src/math.ts b/src/math.ts
index abc1234..def5678 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,2 +1,2 @@
-// TODO: old comment
 // TODO: context line
+export const add = (a: number, b: number): number => a + b`

    const result = findNewlyAddedTodos(diff, "TODO.md")
    expect(result).toEqual([])
  })

  test("finds FIXME, HACK, XXX comments", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,4 @@
+// FIXME: broken validation
+// HACK: workaround for now
+// XXX: needs review
 export const run = () => {}`

    const result = findNewlyAddedTodos(diff, "TODO.md")
    expect(result).toHaveLength(3)
    expect(result[0]!.lineContent).toContain("FIXME:")
    expect(result[1]!.lineContent).toContain("HACK:")
    expect(result[2]!.lineContent).toContain("XXX:")
  })

  test("returns empty array for diff with no TODO comments", () => {
    const diff = `diff --git a/src/math.ts b/src/math.ts
index abc1234..def5678 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,1 +1,2 @@
+export const multiply = (a: number, b: number): number => a * b
 export const add = (a: number, b: number): number => a + b`

    const result = findNewlyAddedTodos(diff, "TODO.md")
    expect(result).toEqual([])
  })
})
