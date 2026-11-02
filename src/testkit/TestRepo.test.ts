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
  envSettings as env,
  human,
  judge,
  moveScript,
  read,
  removeScript,
  run,
  showScript,
  settings as vars,
  workflow,
} from "../flows/index.js"
import {
  inTurn,
  runsItsScript,
  testRepo,
  verdict,
  verdictWhen,
  whenPrompted,
  type ScriptedActor,
  type TestRepo,
} from "./TestRepo.js"

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
      "gtd(check): gtd:pin → build",
      "gtd(agent): build → check",
      "gtd(check): check → sign-off",
    ])
    expect(repo.read("src/add.ts")).toContain("a + b")
    expect(repo.read(".gtd/process.gtdpin")).toBeDefined()
  })

  it("runs a workflow given as gtd.config.ts source", async () => {
    const repo = testRepo({
      workflow: [
        `import { agent, human, workflow } from "@pmelab/gtd/flows"`,
        `export const chores = workflow(async () => { await agent("sweep", "Sweep."); await human("done") })`,
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
      workflow: { default: tidy, tidy: workflow(tidy) },
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
    ).rejects.toThrow(
      "did not rest within 5 beats; it passed through:\nspin → spin → spin → spin → spin",
    )
  })

  describe("judge verdicts", () => {
    const judged = async (): Promise<void> => {
      await agent("plan", "Plan.")
      const { answers } = await judge("ready", {
        questions: [{ id: "ready", primitive: "noul", instructions: "Ready?", criteria: "" }],
        evidence: { plan: "p" },
      })
      await human(answers.ready?.answer === "yes" ? "ship" : "rework")
    }
    const plan: ScriptedActor = (_, r) => r.write("PLAN.md", "p\n")
    const template =
      'expected a JSON array, one entry per question — answer a boolean for a noul, a string for a choice, a number for a score; p between 0 and 1:\n[{ "id": "ready", "answer": true, "p": 0.9 }]'

    it("echoes a refused verdict and the shape it should have", async () => {
      const repo = testRepo({ workflow: { default: judged } })
      repo.write("go", "\n")
      const error = await repo
        .drive({ plan, ready: () => '{"ready": true}' })
        .catch((e: Error) => e)
      expect((error as Error).message).toContain(
        `the actor for judge step "ready" sent a verdict gtd refused:\n{"ready": true}\n${template}\ngtd judge answer exited 2\n`,
      )
    })

    it("says an actor returned an object rather than no verdict", async () => {
      const repo = testRepo({ workflow: { default: judged } })
      repo.write("go", "\n")
      const actor = (() => [{ id: "ready", answer: true, p: 0.9 }]) as unknown as ScriptedActor
      await expect(repo.drive({ plan, ready: actor })).rejects.toThrow(
        `the actor for judge step "ready" returned an array, not a JSON string — JSON.stringify it\n${template}`,
      )
    })

    it("says an actor returned nothing", async () => {
      const repo = testRepo({ workflow: { default: judged } })
      repo.write("go", "\n")
      await expect(repo.drive({ plan, ready: () => undefined })).rejects.toThrow(
        `the actor for judge step "ready" returned no verdict\n${template}`,
      )
    })
  })

  describe("canned commands", () => {
    const checked = async (): Promise<void> => {
      const green = await check("test", "npm test", ".gtd/FEEDBACK.md")
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

  describe("modules a config imports", () => {
    it("serves a specifier the config's source imports, read off the module the test imported", async () => {
      const shipped = { tiny, chores: tiny }
      const repo = testRepo({
        workflow: [
          `import { workflow } from "@pmelab/gtd/flows"`,
          `import tidy, * as all from "#workflow"`,
          `export { chores } from "#workflow"`,
          `export const both = all.tiny === tidy ? workflow(() => tidy()) : undefined`,
          `export default tidy`,
        ].join("\n"),
        modules: { "#workflow": { ...shipped, default: tiny } },
      })
      await repo.start("both")
      expect((await repo.drive({ plan: (_, r) => r.write("PLAN.md", "p\n") })).state).toBe("build")
      expect(repo.read("gtd.config.ts")).not.toContain('from "#workflow"')
    })
  })

  describe("strict drives", () => {
    const signOff = async (): Promise<void> => {
      await agent("plan", "Plan.")
      await human("sign-off")
      await agent("ship", "Ship.")
    }
    const plan: ScriptedActor = (_, r) => r.write("PLAN.md", "p\n")

    it("fails on an actor whose step the drive never reached", async () => {
      const repo = testRepo({ workflow: { default: signOff } })
      repo.write("go", "\n")
      await expect(repo.drive({ plan, ship: () => undefined })).rejects.toThrow(
        'strict drive: the process rests at "sign-off", and never reached the actors for "ship"',
      )
    })

    it("leaves only the unreached-actor check out with unreachedActors: pass", async () => {
      const repo = testRepo({ workflow: { default: signOff } })
      repo.write("go", "\n")
      expect(
        (await repo.drive({ plan, ship: () => undefined }, { unreachedActors: "pass" })).state,
      ).toBe("sign-off")
    })

    it("lets the same drive rest when it is not strict", async () => {
      const repo = testRepo({ workflow: { default: signOff } })
      repo.write("go", "\n")
      expect((await repo.drive({ plan, ship: () => undefined }, { strict: false })).state).toBe(
        "sign-off",
      )
    })

    it("counts a step an earlier drive reached as reached", async () => {
      const twice = async (): Promise<void> => {
        await signOff()
        await human("done")
      }
      const repo = testRepo({ workflow: { default: twice } })
      repo.write("go", "\n")
      const actors: Record<string, ScriptedActor> = { plan }
      expect((await repo.drive(actors)).state).toBe("sign-off")
      repo.write("signed", "\n")
      await repo.land()
      actors["ship"] = (_, r) => r.write("shipped", "\n")
      expect((await repo.drive(actors)).state).toBe("done")
    })

    it("fails on a human step whose actor changes nothing, instead of repeating it", async () => {
      const repo = testRepo({ workflow: { default: signOff } })
      repo.write("go", "\n")
      await expect(repo.drive({ plan, "sign-off": () => undefined })).rejects.toThrow(
        'strict drive: the actor for human step "sign-off" changed nothing, so nothing landed',
      )
    })

    it("fails on a verdict returned at a step that is no judge", async () => {
      const repo = testRepo({ workflow: { default: signOff } })
      repo.write("go", "\n")
      await expect(repo.drive({ plan: (beat, r) => (plan(beat, r), "[]") })).rejects.toThrow(
        'the actor for agent step "plan" returned a verdict',
      )
    })

    it("fails on a check step without an actor, unless checks run themselves", async () => {
      const checked = async (): Promise<void> => {
        const green = await check("test", "npm test", ".gtd/FEEDBACK.md")
        await human(green ? "sign-off" : "red")
      }
      const strictRepo = testRepo({ workflow: { default: checked } })
      strictRepo.write("go", "\n")
      await expect(strictRepo.drive({})).rejects.toThrow(
        'strict drive: check step "test" has no actor',
      )
      const repo = testRepo({
        workflow: { default: checked },
        commands: [{ run: "npm test", exit: 1, output: "1 failing" }],
      })
      repo.write("go", "\n")
      expect((await repo.drive({}, { checks: "run" })).state).toBe("red")
      expect(repo.read(".gtd/FEEDBACK.md")).toContain("1 failing")
    })
  })

  describe("actor helpers", () => {
    const judged = async (): Promise<void> => {
      await agent("plan", "Plan.")
      const { answers } = await judge("ready", {
        questions: [{ id: "ready", primitive: "noul", instructions: "Ready?", criteria: "" }],
        evidence: { plan: "p" },
      })
      await human(answers.ready?.answer === "yes" ? "ship" : "rework")
    }
    const plan: ScriptedActor = (_, r) => r.write("PLAN.md", "p\n")

    it("builds a verdict keyed by question id, p defaulting to 0.9", () => {
      expect(verdict({ ready: true, tier: { answer: "low", p: 0.6 } })).toEqual({
        answers: [
          { id: "ready", answer: true, p: 0.9 },
          { id: "tier", answer: "low", p: 0.6 },
        ],
      })
    })

    it("answers a judge with a verdict object", async () => {
      const repo = testRepo({ workflow: { default: judged } })
      repo.write("go", "\n")
      expect((await repo.drive({ plan, ready: () => verdict({ ready: false }) })).state).toBe(
        "rework",
      )
    })

    it("answers by what the pending questions contain", async () => {
      const repo = testRepo({ workflow: { default: judged } })
      repo.write("go", "\n")
      const ready = inTurn([
        verdictWhen("Unrelated?", verdict({ ready: false })),
        verdictWhen("Ready?", verdict({ ready: true })),
      ])
      expect((await repo.drive({ plan, ready })).state).toBe("ship")
    })

    it("runs an actor only at a visit prompted with the text, and every actor in turn", async () => {
      const repo = testRepo({ workflow: { default: judged } })
      repo.write("go", "\n")
      const seen: string[] = []
      await repo.drive({
        plan: inTurn([
          whenPrompted("Plan.", plan),
          whenPrompted("Something else.", () => {
            seen.push("else")
          }),
          () => {
            seen.push("always")
          },
        ]),
      })
      expect(repo.read("PLAN.md")).toBe("p\n")
      expect(seen).toEqual(["always"])
    })

    it("runs a script with commands of its own before the canned ones", () => {
      const repo = testRepo({ workflow: { default: tiny }, commands: [{ run: /.*/, exit: 1 }] })
      repo.runScript("make docs\n", {
        commands: [{ run: "make docs", effect: (r) => r.write("docs.html", "<p>\n") }],
      })
      expect(repo.read("docs.html")).toBe("<p>\n")
    })
  })

  describe("commits and the environment", () => {
    it("lists every commit with its subject, message and trailers", async () => {
      const repo = testRepo({ workflow: { default: tiny } })
      repo.write("IDEA.md", "x\n")
      repo.commit("feat: x\n\nA body.\n\nRefs: #1\nRefs: #2")
      const [initial, feat] = repo.commits()
      expect(initial).toMatchObject({ subject: "chore: initial commit", trailers: {} })
      expect(feat).toEqual({
        hash: repo.hashes()[1],
        subject: "feat: x",
        message: repo.messages()[1],
        trailers: { Refs: ["#1", "#2"] },
      })
      await repo.drive({ plan: (_, r) => r.write("PLAN.md", "p\n") })
      expect(repo.commits().at(-2)!.trailers["Gtd-Step"]).toEqual(["plan#1"])
      expect(repo.commits().at(-1)!.trailers["Gtd-Pin"]).toEqual(["add"])
    })

    const greeter = {
      default: workflow(
        async (): Promise<void> => {
          await agent("wake", "Wake up.")
          await agent("greet", `Say ${env["greeting"]}, flag ${vars["flag_probe"]}.`)
        },
        { envDefaults: { greeting: "hi" }, defaults: { flag_probe: "0" } },
      ),
    }
    const greet = async (repo: TestRepo): Promise<string> => {
      const rest = await repo.drive({ wake: (_, r) => r.write("awake", "\n") })
      return rest.content
    }

    it("changes a variable gtd sees from the next call on", async () => {
      const repo = testRepo({ workflow: greeter })
      repo.write("go", "\n")
      expect(await greet(repo)).toContain("Say hi")
      repo.setEnv("GTD_GREETING", "hello")
      expect((await repo.next()).content).toContain("Say hello")
      repo.setEnv("GTD_GREETING", undefined)
      expect((await repo.next()).content).toContain("Say hi")
    })

    it("keeps the runner's GTD_FLAG_* out when ambient flags are off", async () => {
      const saved = process.env["GTD_FLAG_PROBE"]
      process.env["GTD_FLAG_PROBE"] = "1"
      try {
        const ambient = testRepo({ workflow: greeter })
        ambient.write("go", "\n")
        expect(await greet(ambient)).toContain("flag 1")
        const isolated = testRepo({ workflow: greeter, ambientFlags: false })
        isolated.write("go", "\n")
        expect(await greet(isolated)).toContain("flag 0")
      } finally {
        if (saved === undefined) delete process.env["GTD_FLAG_PROBE"]
        else process.env["GTD_FLAG_PROBE"] = saved
      }
    })
  })
})
