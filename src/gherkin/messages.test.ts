import { describe, expect, it } from "vitest"
import { agent, human } from "../flows/index.js"
import { testRepo } from "../testkit/index.js"
import { assertContains, assertLacks, refusedWith, restDescription } from "./messages.js"

const flow = async (): Promise<void> => {
  await agent("plan", "Write PLAN.md.\nKeep it short.\n3\n4\n5\n6\n7")
  await human("sign-off")
}

const thrown = async (fn: () => unknown): Promise<string> => {
  try {
    await fn()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("did not throw")
}

describe("restDescription", () => {
  it("names the step, its kind and actor, the content's head, the last commits and the unused actors", async () => {
    const repo = testRepo({ workflow: { default: flow } })
    repo.write("go", "\n")
    await repo.drive({ plan: (_, r) => r.write("PLAN.md", "p\n") })
    expect(await restDescription(() => repo, ["repair", "ready"])).toBe(
      [
        "where the process rests:",
        '  step "sign-off" (message, human)',
        "  content:",
        "    | sign-off",
        "  last commits:",
        "    chore: initial commit",
        "    gtd(agent): plan → sign-off",
        '  actors never used: "repair", "ready"',
      ].join("\n"),
    )
  })

  it("cuts long content to its first lines", async () => {
    const repo = testRepo({ workflow: { default: flow } })
    repo.write("go", "\n")
    const description = await restDescription(() => repo, [])
    expect(description).toContain('step "plan" (prompt, agent)')
    expect(description).toContain("    | 5\n    | … 2 more lines")
    expect(description).not.toContain("actors never used")
  })

  it("says why the rest is unknown instead of throwing", async () => {
    const description = await restDescription(() => {
      throw new Error("no gtd config")
    }, [])
    expect(description).toBe("where the process rests:\n  unknown — no gtd config")
  })
})

describe("refusedWith", () => {
  it("says nothing was refused when the attempt succeeds", async () => {
    expect(await thrown(() => refusedWith(Promise.resolve(), "nope"))).toBe(
      'expected a refusal with "nope", but nothing was refused',
    )
  })

  it("prints the refusal it got when the text is missing", async () => {
    expect(await thrown(() => refusedWith(Promise.reject(new Error("other")), "nope"))).toBe(
      'expected a refusal with "nope", but it was refused with:\nother',
    )
  })

  it("passes on a refusal carrying the text", async () => {
    await refusedWith(Promise.reject(new Error("a nope b")), "nope")
  })
})

describe("contains", () => {
  it("prints the text looked for and what was there", async () => {
    expect(await thrown(() => assertContains('"a.md"', "x", "y\n"))).toBe(
      '"a.md" does not contain "x"; it holds:\ny\n',
    )
    expect(await thrown(() => assertLacks('"a.md"', "y", "y\n"))).toBe(
      '"a.md" contains "y"; it holds:\ny\n',
    )
  })

  it("says a missing file does not exist", async () => {
    expect(await thrown(() => assertContains('"a.md"', "x", undefined))).toBe(
      '"a.md" does not exist, so it cannot contain "x"',
    )
    expect(await thrown(() => assertLacks('"a.md"', "x", undefined))).toBe('"a.md" does not exist')
  })
})
