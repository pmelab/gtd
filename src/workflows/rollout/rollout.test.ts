import { describe, expect, it } from "vitest"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { runsItsScript, testRepo } from "../../testkit/index.js"

const CONFIG = `${CONFIG_SCAFFOLD}export { rollout } from "@pmelab/gtd/workflows"\n`

const REGISTRY = `export const FLAGS = [
  { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
  { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
  { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
  { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
] as const
`

const FLIPPED = REGISTRY.replace(
  '{ name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" }',
  '{ name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true }',
)

const repoWith = () =>
  testRepo({ workflow: CONFIG, files: { "src/flags/index.ts": REGISTRY, "src/a.ts": "a\n" } })

describe("the rollout workflow", () => {
  it("lands a flip, checks the suite and ends with no review", async () => {
    const repo = repoWith()
    await repo.start("rollout", "--var", "flag=alpha")
    const rest = await repo.drive({
      "rollout.flipping": (beat, r) => {
        expect(beat.content).toContain("alpha")
        r.write("src/flags/index.ts", FLIPPED)
      },
      "rollout.suite.check": () => undefined,
      "rollout.mentions": runsItsScript,
    })
    expect(rest.state).toBe("idle")
    expect(repo.subjects().slice(-2)).toEqual([
      "gtd(check): rollout.suite.check → rollout.mentions",
      "gtd(check): rollout.mentions → idle",
    ])
  })

  it("lands a flip when the tree was already dirty at the start", async () => {
    const repo = repoWith()
    repo.write("src/other.ts", "dirty\n")
    await repo.start("rollout", "--var", "flag=alpha")
    const rest = await repo.drive({
      "rollout.flipping": (_, r) => r.write("src/flags/index.ts", FLIPPED),
      "rollout.suite.check": () => undefined,
      "rollout.mentions": runsItsScript,
    })
    expect(rest.state).toBe("idle")
  })

  it("refuses a turn that also changes a source file, naming it", async () => {
    const repo = repoWith()
    await repo.start("rollout", "--var", "flag=alpha")
    await expect(
      repo.drive({
        "rollout.flipping": (_, r) => {
          r.write("src/flags/index.ts", FLIPPED)
          r.write("src/a.ts", "changed\n")
        },
      }),
    ).rejects.toThrow(/rollout-only: src\/a\.ts changed/)
  })

  it("refuses an edit to a second entry", async () => {
    const repo = repoWith()
    await repo.start("rollout", "--var", "flag=alpha")
    await expect(
      repo.drive({
        "rollout.flipping": (_, r) =>
          r.write("src/flags/index.ts", FLIPPED.replace('owner: "b"', 'owner: "z"')),
      }),
    ).rejects.toThrow("rollout-only: other edits in src/flags/index.ts")
  })

  it("refuses a turn that writes defaultOn: false, naming the fault", async () => {
    const repo = repoWith()
    await repo.start("rollout", "--var", "flag=alpha")
    await expect(
      repo.drive({
        "rollout.flipping": (_, r) =>
          r.write("src/flags/index.ts", FLIPPED.replace("defaultOn: true }", "defaultOn: false }")),
      }),
    ).rejects.toThrow('"alpha" is not set to defaultOn: true')
  })

  it("refuses a turn that also writes under .gtd/", async () => {
    const repo = repoWith()
    await repo.start("rollout", "--var", "flag=alpha")
    await expect(
      repo.drive({
        "rollout.flipping": (_, r) => {
          r.write("src/flags/index.ts", FLIPPED)
          r.write(".gtd/NOTES.md", "planted\n")
        },
      }),
    ).rejects.toThrow(/rollout-only: \.gtd\/NOTES\.md changed/)
  })

  it.each([
    [[], "gtd: rollout needs --var flag=<name>"],
    [["--var", "flag=nope"], 'gtd: rollout: no flag "nope" in src/flags/index.ts'],
    [["--var", "flag=ops1"], 'gtd: rollout: flag "ops1" is ops, not release'],
    [["--var", "flag=live"], 'gtd: rollout: flag "live" is already default-on'],
  ])("refuses %j at start", async (args, message) => {
    await expect(repoWith().start("rollout", ...args)).rejects.toThrow(message)
  })

  it("rests at rollout.suite.blocked on a red suite, with no fix turn", async () => {
    const repo = repoWith()
    await repo.start("rollout", "--var", "flag=alpha")
    const rest = await repo.drive({
      "rollout.flipping": (_, r) => r.write("src/flags/index.ts", FLIPPED),
      "rollout.suite.check": (_, r) => r.write(".gtd/FEEDBACK.md", "1 failing\n"),
    })
    expect(rest).toMatchObject({ state: "rollout.suite.blocked", actor: "human" })
  })

  describe("the human's fix at rollout.suite.blocked", () => {
    const blocked = async () => {
      const repo = repoWith()
      await repo.start("rollout", "--var", "flag=alpha")
      await repo.drive({
        "rollout.flipping": (_, r) => r.write("src/flags/index.ts", FLIPPED),
        "rollout.suite.check": (_, r) => r.write(".gtd/FEEDBACK.md", "1 failing\n"),
      })
      return repo
    }

    it("refuses a fix that edits a source file, naming it", async () => {
      const repo = await blocked()
      await expect(
        repo.drive({ "rollout.suite.blocked": (_, r) => r.write("src/a.ts", "fixed\n") }),
      ).rejects.toThrow(/rollout-only: src\/a\.ts changed/)
    })

    it("refuses a fix that edits a second registry entry", async () => {
      const repo = await blocked()
      await expect(
        repo.drive({
          "rollout.suite.blocked": (_, r) =>
            r.write("src/flags/index.ts", FLIPPED.replace('owner: "b"', 'owner: "z"')),
        }),
      ).rejects.toThrow("rollout-only: other edits in src/flags/index.ts")
    })

    it("refuses a fix that rewrites the flipped entry back to defaultOn: false", async () => {
      const repo = await blocked()
      await expect(
        repo.drive({ "rollout.suite.blocked": (_, r) => r.write("src/flags/index.ts", REGISTRY) }),
      ).rejects.toThrow('"alpha" is not set to defaultOn: true')
    })

    it("lands a fix that re-wraps the flag's entry and ends with no review", async () => {
      const repo = await blocked()
      const rest = await repo.drive({
        "rollout.suite.blocked": (_, r) =>
          r.write(
            "src/flags/index.ts",
            FLIPPED.replace(
              '{ name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true }',
              '{\n    name: "alpha",\n    owner: "a",\n    expiry: "2027-01-01",\n    kind: "release",\n    defaultOn: true,\n  }',
            ),
          ),
        "rollout.suite.check": () => undefined,
        "rollout.mentions": runsItsScript,
      })
      expect(rest.state).toBe("idle")
    })
  })
})

describe("rollout.mentions", () => {
  const flip = {
    "rollout.flipping": (_: unknown, r: { write: (p: string, c: string) => void }) =>
      r.write("src/flags/index.ts", FLIPPED),
  }
  const finish = async (
    files: Record<string, string>,
    mentions: typeof runsItsScript = runsItsScript,
  ) => {
    const repo = testRepo({
      workflow: CONFIG,
      files: { "src/flags/index.ts": REGISTRY, "src/a.ts": "a\n", ...files },
    })
    await repo.start("rollout", "--var", "flag=alpha")
    const rest = await repo.drive({
      ...flip,
      "rollout.suite.check": () => undefined,
      "rollout.mentions": mentions,
    })
    expect(rest.state).toBe("idle")
    const marks = (repo.messages().at(-1) ?? "")
      .split("\n")
      .filter((l) => l.startsWith("Gtd-Mark: "))
      .map((l) => l.slice("Gtd-Mark: ".length))
    return { repo, marks }
  }

  it("lists mentions outside the registry and under no .gtd/ path", async () => {
    const { marks } = await finish({
      "README.md": "intro\non under GTD_FLAG_ALPHA=1\n",
      "src/help.ts": 'export const h = "alpha help"\n',
      ".gtd/NOTES.md": "alpha\n",
    })
    expect(marks).toEqual([
      "flag-mentions=2",
      "flag-mention=README.md:2",
      "flag-mention=src/help.ts:1",
    ])
  })

  it("the mentions script removes a feedback file present at the step; marks list the tree", async () => {
    const { repo, marks } = await finish({ "README.md": "alpha\n" }, (beat, r) => {
      r.write(".gtd/FEEDBACK.md", "alpha\n")
      runsItsScript(beat, r)
    })
    expect(repo.read(".gtd/FEEDBACK.md")).toBeUndefined()
    expect(marks).toEqual(["flag-mentions=1", "flag-mention=README.md:1"])
  })

  it("refuses a stray file written by the mentions script", async () => {
    await expect(
      finish({}, (beat, r) => {
        runsItsScript(beat, r)
        r.write("src/stray.ts", "x\n")
      }),
    ).rejects.toThrow("gtd land: rollout-only: src/stray.ts changed")
  })

  it("refuses a registry edit beyond the flip made by the mentions script", async () => {
    await expect(
      finish({}, (beat, r) => {
        runsItsScript(beat, r)
        r.write("src/flags/index.ts", FLIPPED.replace('owner: "b"', 'owner: "z"'))
      }),
    ).rejects.toThrow("rollout-only: other edits in src/flags/index.ts")
  })

  it("marks 0 when nothing names the flag", async () => {
    const { marks } = await finish({})
    expect(marks).toEqual(["flag-mentions=0"])
  })

  it("marks the total for 60 mentions but only the first 50 lines", async () => {
    const text = Array.from({ length: 60 }, (_, i) => `alpha ${i}`).join("\n")
    const { marks } = await finish({ "docs/many.md": `${text}\n` })
    expect(marks[0]).toBe("flag-mentions=60")
    expect(marks.filter((m) => m.startsWith("flag-mention="))).toHaveLength(50)
  })

  it("counts a path the mark grammar rejects without marking it, and never throws", async () => {
    const { marks } = await finish({
      "docs/bad\u0001name.md": "alpha\n",
      "README.md": "alpha\n",
    })
    expect(marks).toEqual(["flag-mentions=2", "flag-mention=README.md:1"])
  })
})
