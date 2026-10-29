import { describe, expect, it } from "vitest"
import {
  commitAll,
  combinedScript,
  commitAsIs,
  commitClean,
  deleteRef,
  discardPending,
  hardResetTo,
  keepTurn,
  mixedResetTo,
  softResetTo,
  updateRef,
} from "../emit/index.js"
import {
  agent,
  check,
  human,
  moveScript,
  read,
  removeScript,
  run,
  showScript,
} from "../flows/index.js"
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
    expect(() => repo.runScript("npm test\n")).toThrow(/cannot run script in memory[\s\S]*npm test/)
  })

  it("carries the recognizer's error when a git-free fallback fails", () => {
    const repo = testRepo({ workflow: { default: tiny } })
    expect(() => repo.runScript("printf 'x' > 'y'\n")).toThrow(
      "testkit: cannot run script in memory — add a canned command for it, or give the step an actor\nunrecognized script block: printf 'x' > 'y'",
    )
  })

  it("names the block that failed, not an earlier line that ran", () => {
    const repo = testRepo({ workflow: { default: tiny } })
    let message = ""
    try {
      repo.runScript("mkdir -p d\nprintf '%s\\n' 'x' > 'd/a.txt'\n\nnpm test\n")
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain("unrecognized script block: npm test")
    expect(message).not.toContain("printf")
  })

  it.each([
    ["commitAll", commitAll("chore: sneaky")],
    ["commitClean", commitClean("chore: sneaky")],
    ["commitAsIs", commitAsIs("chore: sneaky")],
    ["keepTurn", keepTurn("refs/x", "chore: sneaky")],
    ["discardPending", discardPending()],
    ["softResetTo", softResetTo("HEAD~1")],
    ["mixedResetTo", mixedResetTo("HEAD~1")],
    ["hardResetTo", hardResetTo("HEAD~1")],
    ["updateRef", updateRef("refs/x", "HEAD")],
    ["deleteRef", deleteRef("refs/x")],
  ])("refuses a %s script instead of mutating git in memory", (_, script) => {
    const repo = testRepo({ workflow: { default: tiny } })
    repo.write("a.txt", "dirty\n")
    const before = repo.subjects()
    expect(() => repo.runScript(script)).toThrow(/unrecognized script block/)
    expect(repo.subjects()).toEqual(before)
  })

  it.each([
    ["commitAll", commitAll("chore: sneaky")],
    ["commitClean", commitClean("chore: sneaky")],
    ["commitAsIs", commitAsIs("chore: sneaky")],
    ["keepTurn", keepTurn("refs/x", "chore: sneaky")],
    ["discardPending", discardPending()],
    ["softResetTo", softResetTo("HEAD~1")],
    ["mixedResetTo", mixedResetTo("HEAD~1")],
    ["hardResetTo", hardResetTo("HEAD~1")],
    ["updateRef", updateRef("refs/x", "HEAD")],
    ["deleteRef", deleteRef("refs/x")],
  ])("refuses a wrapped %s script instead of mutating git in memory", (_, script) => {
    const repo = testRepo({ workflow: { default: tiny } })
    repo.write("a.txt", "dirty\n")
    const before = repo.subjects()
    expect(() => repo.runScript(combinedScript("set -eu", script))).toThrow(
      /cannot run script in memory[\s\S]*unrecognized script block/,
    )
    expect(repo.subjects()).toEqual(before)
  })

  it("applies a write block `LINES` lacks through the git-free recognizers", () => {
    const repo = testRepo({ workflow: { default: tiny } })
    repo.runScript("mkdir -p d\nprintf '%s\\n' 'echo $(git rev-parse HEAD)' > 'd/a.txt'\n")
    expect(repo.read("d/a.txt")).toBe("echo $(git rev-parse HEAD)\n")
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

  describe("canned commands", () => {
    const checked = async (): Promise<void> => {
      const green = await check("test", "npm test", { report: ".gtd/FEEDBACK.md" })
      await human(green ? "sign-off" : "red")
    }

    it("runs a check's command as canned, its output the report", async () => {
      const repo = testRepo({
        workflow: { default: checked },
        commands: [{ run: "npm test", exit: 1, output: "1 failing" }],
      })
      repo.write("go", "\n")
      const rest = await repo.drive({ test: runsItsScript })
      expect(rest.state).toBe("red")
      expect(repo.read(".gtd/FEEDBACK.md")).toContain("1 failing")
    })

    it("exits 0 by default, and matches by pattern", async () => {
      const repo = testRepo({ workflow: { default: checked }, commands: [{ run: /^npm / }] })
      repo.write("go", "\n")
      expect((await repo.drive({ test: runsItsScript })).state).toBe("sign-off")
    })

    it("lets a command change the tree, and takes the first match", async () => {
      const repo = testRepo({
        workflow: { default: checked },
        commands: [
          { run: "npm test", effect: (r) => r.write("ran", "first\n") },
          { run: /npm/, exit: 1 },
        ],
      })
      repo.write("go", "\n")
      expect((await repo.drive({ test: runsItsScript })).state).toBe("sign-off")
      expect(repo.read("ran")).toBe("first\n")
    })

    it("takes a command added later", async () => {
      const repo = testRepo({ workflow: { default: checked } })
      repo.command({ run: "npm test", exit: 2 })
      repo.write("go", "\n")
      expect((await repo.drive({ test: runsItsScript })).state).toBe("red")
    })

    it("runs a plain script line as canned", () => {
      const repo = testRepo({
        workflow: { default: tiny },
        commands: [{ run: "make docs", effect: (r) => r.write("docs.html", "<p>\n") }],
      })
      repo.runScript("make docs\n")
      expect(repo.read("docs.html")).toBe("<p>\n")
    })

    it("fails the drive on a command none matches, naming it", async () => {
      const repo = testRepo({ workflow: { default: checked } })
      repo.write("go", "\n")
      await expect(repo.drive({ test: runsItsScript })).rejects.toThrow(
        "no canned command matches `npm test`",
      )
    })
  })

  describe("history", () => {
    it("creates and checks out a branch, refusing uncommitted changes", () => {
      const repo = testRepo({ workflow: { default: tiny }, files: { "a.txt": "main\n" } })
      repo.branch("feature/x")
      repo.checkout("feature/x")
      expect(repo.branchName()).toBe("feature/x")
      repo.write("a.txt", "feature\n")
      expect(() => repo.checkout("main")).toThrow("uncommitted changes")
      repo.commit("feat: x")
      repo.checkout("main")
      expect(repo.branchName()).toBe("main")
      expect(repo.read("a.txt")).toBe("main\n")
      expect(repo.show("feature/x", "a.txt")).toBe("feature\n")
    })

    it("branches at a given ref, and refuses an existing name or a missing ref", () => {
      const repo = testRepo({ workflow: { default: tiny }, files: { "a.txt": "one\n" } })
      repo.write("a.txt", "two\n")
      repo.commit("chore: two")
      repo.branch("old", "HEAD~1")
      expect(repo.show("old", "a.txt")).toBe("one\n")
      expect(() => repo.branch("old")).toThrow("already exists")
      expect(() => repo.branch("new", "nowhere")).toThrow("not a valid object name")
    })

    it("points a remote ref that a script reads by its short name", async () => {
      const restore = async (): Promise<void> => {
        await run("restore", showScript("origin/main", "a.txt", "a.txt"))
        await human("done")
      }
      const repo = testRepo({ workflow: { default: restore }, files: { "a.txt": "base\n" } })
      repo.ref("refs/remotes/origin/main")
      repo.write("a.txt", "local\n")
      repo.commit("chore: local")
      repo.write("go", "\n")
      await repo.drive({ restore: runsItsScript })
      expect(repo.read("a.txt")).toBe("base\n")
    })

    it("refuses a ref outside refs/ or at nothing", () => {
      const repo = testRepo({ workflow: { default: tiny } })
      expect(() => repo.ref("origin/main")).toThrow("must start with refs/")
      expect(() => repo.ref("refs/tags/v1", "nowhere")).toThrow("resolves to no commit")
    })
  })
})
