import { describe, expect, it } from "vitest"
import { agent, human, moveScript, read, removeScript, run } from "../flows/index.js"
import { runsItsScript, testRepo } from "./TestRepo.js"

const tiny = async (): Promise<void> => {
  await agent("plan", "Write PLAN.md.")
  await agent("build", `Build what PLAN.md says:\n${read("PLAN.md") ?? ""}`)
  await run("check", "npm test > .gtd/FEEDBACK.md 2>&1 && rm .gtd/FEEDBACK.md")
  if (read(".gtd/FEEDBACK.md") !== undefined) await agent("repair", "Make the suite pass.")
  await human("sign-off")
}

describe("testRepo", () => {
  it("drives a workflow module defined in the test with scripted agents until it rests", async () => {
    const repo = testRepo({ workflow: { default: tiny } })
    repo.write("IDEA.md", "a calculator\n")
    const rest = await repo.drive({
      plan: (_, r) => r.write("PLAN.md", "add two numbers\n"),
      build: (beat, r) => {
        expect(beat.content).toContain("add two numbers")
        r.write("src/add.ts", "export const add = (a: number, b: number) => a + b\n")
      },
      check: () => undefined,
    })
    expect(rest).toMatchObject({ state: "sign-off", actor: "human" })
    expect(repo.subjects()).toEqual([
      "chore: initial commit",
      "gtd(agent): plan → build",
      "gtd(agent): build → check",
      "gtd(check): check → sign-off",
    ])
    expect(repo.read("src/add.ts")).toContain("a + b")
  })

  it("runs a workflow given as gtd.config.ts source", async () => {
    const repo = testRepo({
      workflow: [
        `import { agent, human } from "@pmelab/gtd/flows"`,
        `export const chores = async () => { await agent("sweep", "Sweep."); await human("done") }`,
        `export default chores`,
      ].join("\n"),
    })
    await repo.start("chores")
    const rest = await repo.drive({ sweep: (_, r) => r.write("swept", "yes\n") })
    expect(rest.state).toBe("done")
    expect(repo.subjects().at(-1)).toBe("gtd(agent): sweep → done")
  })

  it("runs the file operations a step's script does", async () => {
    const tidy = async (): Promise<void> => {
      await run("archive", moveScript("NOTES.md", "archive/NOTES.md"))
      await run("sweep", removeScript(["scratch.txt"]))
      await human("done")
    }
    const repo = testRepo({
      workflow: { default: tidy, tidy },
      files: { "NOTES.md": "notes\n", "scratch.txt": "x\n" },
    })
    await repo.start("tidy")
    await repo.drive({ archive: runsItsScript, sweep: runsItsScript })
    expect(repo.read("archive/NOTES.md")).toBe("notes\n")
    expect(repo.read("NOTES.md")).toBeUndefined()
    expect(repo.read("scratch.txt")).toBeUndefined()
  })

  it("removes a directory with everything in it, as `rm -rf` does", () => {
    const repo = testRepo({
      workflow: { default: tiny },
      files: { "out/a.txt": "a\n", "out/deep/b.txt": "b\n", "outside.txt": "c\n" },
    })
    repo.runScript(removeScript(["out"]))
    expect(repo.read("out/a.txt")).toBeUndefined()
    expect(repo.read("out/deep/b.txt")).toBeUndefined()
    expect(repo.read("outside.txt")).toBe("c\n")
  })

  it("refuses to remove an empty path rather than clear the tree", () => {
    const repo = testRepo({ workflow: { default: tiny }, files: { "keep.txt": "k\n" } })
    expect(() => repo.runScript(removeScript([""]))).toThrow(/refusing an empty path/)
    expect(repo.read("keep.txt")).toBe("k\n")
  })

  it("leaves no workflow module registered once gtd returns, so tests cannot reach each other's", async () => {
    const repo = testRepo({ workflow: { default: tiny } })
    repo.write("IDEA.md", "x\n")
    await repo.drive({ plan: (_, r) => r.write("PLAN.md", "p\n") })
    const registry = (globalThis as Record<symbol, Map<string, unknown> | undefined>)[
      Symbol.for("@pmelab/gtd/testkit:modules")
    ]
    expect(registry).toBeInstanceOf(Map)
    expect(registry?.size).toBe(0)
  })

  it("refuses to fake a script it cannot run", () => {
    const repo = testRepo({ workflow: { default: tiny } })
    expect(() => repo.runScript("npm test\n")).toThrow(/cannot run `npm test` in memory/)
  })

  it("reads a file as committed", () => {
    const repo = testRepo({ workflow: { default: tiny }, files: { "a.txt": "one\n" } })
    repo.write("a.txt", "two\n")
    repo.commit("chore: two")
    expect(repo.show("HEAD~1", "a.txt")).toBe("one\n")
    repo.runScript(`git show 'HEAD~1:a.txt' > 'b.txt'\n`)
    expect(repo.read("b.txt")).toBe("one\n")
  })

  it("stops a process that never rests", async () => {
    const loop = async (): Promise<void> => {
      for (;;) await agent("spin", "Again.")
    }
    const repo = testRepo({ workflow: { default: loop } })
    repo.write("go", "\n")
    let n = 0
    await expect(
      repo.drive({ spin: (_, r) => r.write("n", `${++n}\n`) }, { maxBeats: 5 }),
    ).rejects.toThrow(/did not rest within 5 beats/)
  })
})
