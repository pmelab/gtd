import { describe, expect, it } from "vitest"
import { branchProblem } from "./Branch.js"

describe("branchProblem", () => {
  it.each(["login", "feat/login", "fix-12_b", "a.b", "user/feat.x"])("takes %s", (name) => {
    expect(branchProblem(name)).toBeUndefined()
  })

  it.each([
    ["", "the branch name is empty"],
    ["@", 'a branch name is not "@"'],
    ["a@{b", 'a branch name has no "@{"'],
    ["a//b", 'a branch name has no "//"'],
    ["/a", 'a branch name does not start with "/"'],
    ["a.", 'a branch name does not end with "."'],
    ["a/.b", 'no part of a branch name starts with "."'],
    ["a/b.lock/c", 'no part of a branch name ends with ".lock"'],
    ["a\tb", "a branch name has no spaces or control characters"],
  ])("refuses %j", (name, problem) => {
    expect(branchProblem(name)).toBe(problem)
  })
})
