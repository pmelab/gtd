import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

describe("suite git config", () => {
  it("never reads the developer's global config, so no commit is signed", () => {
    const read = (key: string) =>
      execFileSync("git", ["config", "--global", key], { encoding: "utf8" }).trim()
    expect(read("commit.gpgsign")).toBe("false")
    expect(read("tag.gpgsign")).toBe("false")
  })
})
