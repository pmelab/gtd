import { describe, expect, it } from "vitest"
import { agent, human, wait, type Signal } from "../flows/index.js"
import { testRepo } from "./index.js"

const seen: Signal[] = []

const reviewed = async (): Promise<void> => {
  await agent("build", "Build it.")
  const signal = await wait("pr", {
    kinds: ["review", "merged"],
    timeout: "2d",
  })
  seen.push(signal)
  if (signal.kind === "review") await agent("fix", "Address the review.")
  await human("sign-off")
}

const start = async () => {
  seen.length = 0
  const repo = testRepo({ workflow: { default: reviewed } })
  repo.write("IDEA.md", "x\n")
  const rest = await repo.drive({ build: (_, r) => r.write("a.txt", "a\n") })
  return { repo, rest }
}

describe("wait steps", () => {
  it("rest as a message of actor signal that names the kinds and the timeout", async () => {
    const { rest } = await start()
    expect(rest).toMatchObject({
      state: "pr",
      actor: "signal",
      kind: "message",
      signal: { kinds: ["review", "merged", "timeout"], timeout: "2d" },
    })
  })

  it("land a delivered signal as the wait's turn and hand its payload to the flow", async () => {
    const { repo } = await start()
    await repo.signal("review", { data: { pr: 7 }, fingerprint: "r1" })
    expect((await repo.next()).kind).toBe("capture")
    const rest = await repo.drive({ fix: (_, r) => r.write("fix.txt", "f\n") })
    expect(rest.state).toBe("sign-off")
    expect(repo.subjects()).toContain("gtd(signal): pr → fix")
    expect(seen.at(-1)).toMatchObject({
      kind: "review",
      fingerprint: "r1",
      data: { pr: 7 },
    })
  })

  it("refuse a kind the wait does not accept", async () => {
    const { repo } = await start()
    await expect(repo.signal("deploy")).rejects.toThrow(
      /accepts review, merged, timeout, not deploy/,
    )
    expect(repo.read(".gtd/SIGNAL.json")).toBeUndefined()
  })

  it("refuse a second signal while the first is not landed", async () => {
    const { repo } = await start()
    await repo.signal("review", { fingerprint: "r1" })
    await expect(repo.signal("merged", { fingerprint: "m1" })).rejects.toThrow(/pending/)
    expect(JSON.parse(repo.read(".gtd/SIGNAL.json") ?? "{}").kind).toBe("review")
  })

  it("refuse a signal while the process rests elsewhere", async () => {
    const { repo } = await start()
    await repo.signal("merged")
    await repo.drive()
    await expect(repo.signal("merged")).rejects.toThrow(/no wait step/)
  })

  it("drop a signal whose fingerprint the wait last took", async () => {
    const repo = testRepo({
      workflow: {
        default: async () => {
          await agent("build", "Build it.")
          await wait("pr", { kinds: ["review"] })
          await wait("pr", { kinds: ["review"] })
          await human("done")
        },
      },
    })
    repo.write("IDEA.md", "x\n")
    const build = {
      build: (_: unknown, r: { write: (p: string, c: string) => void }) => r.write("a", "a\n"),
    }
    await repo.drive(build)
    await repo.signal("review", { fingerprint: "same" })
    expect((await repo.drive()).state).toBe("pr")
    const again = await repo.signal("review", { fingerprint: "same" })
    expect(again.stdout).toContain("already")
    expect((await repo.next()).kind).toBe("message")
    await repo.signal("review", { fingerprint: "other" })
    expect((await repo.next()).kind).toBe("capture")
  })
})
