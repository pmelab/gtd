import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { refNameFault } from "./RefName.js"

// The predicate's owner: it must agree with git, or an invalid keep name only fails at landing.
describe("refNameFault", () => {
  it.each([
    "a",
    "a.b",
    "build.naive",
    "-a",
    "ünï",
    "a@b",
    "a/b",
    "a.",
    "a//b",
    "/a",
    "a/",
    "@",
    "a@{b",
    "a..b",
    "a b",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "a\tb",
    ".a",
    "a.lock",
    "a/.b",
    "a.lock/b",
    "",
  ])("agrees with git check-ref-format for %j", (name) => {
    const git = spawnSync("git", ["check-ref-format", `refs/gtd/kept/e/${name}`])
    expect(refNameFault(name) === undefined).toBe(git.status === 0)
  })
})
