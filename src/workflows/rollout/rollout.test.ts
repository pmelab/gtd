import { describe, expect, it } from "vitest"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { testRepo } from "../../testkit/index.js"

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
    })
    expect(rest.state).toBe("idle")
    expect(repo.subjects().at(-1)).toBe("gtd(check): rollout.suite.check → idle")
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
})
