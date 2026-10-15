import { describe, expect, it } from "vitest"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { testRepo } from "../../testkit/index.js"

const CONFIG = `${CONFIG_SCAFFOLD}export { cleanup } from "@pmelab/gtd/workflows"\n`

const REGISTRY = `export const FLAGS = [
  { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
  { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
  { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
] as const
`
const WITHOUT_LIVE = REGISTRY.replace(/  \{ name: "live".*\n/, "")
const SOURCE = "export const on = process.env.GTD_FLAG_LIVE !== '0'\n"

const repoWith = () =>
  testRepo({
    workflow: CONFIG,
    env: { GTD_QUALITYREVIEWS: "" },
    files: { "src/flags/index.ts": REGISTRY, "src/a.ts": SOURCE },
  })

describe("the cleanup workflow", () => {
  it("lands a removal and reaches the review", async () => {
    const repo = repoWith()
    await repo.start("cleanup", "--var", "flag=live")
    const rest = await repo.drive({
      "cleanup.removing": (beat, r) => {
        expect(beat.content).toContain("live")
        r.write("src/flags/index.ts", WITHOUT_LIVE)
        r.write("src/a.ts", "export const on = true\n")
      },
      "build.health.check": () => undefined,
    })
    expect(rest).toMatchObject({ state: "build.review.reviewing", actor: "agent" })
  })

  it("refuses to start over a pending hand-off", async () => {
    const repo = testRepo({
      workflow: CONFIG,
      files: {
        "src/flags/index.ts": REGISTRY,
        ".gtd/REVIEW.md": "# Review: abc1234\n",
        ".gtd/REVIEW.orig.md": "# Review: abc1234\n",
      },
    })
    await expect(repo.start("cleanup", "--var", "flag=live")).rejects.toThrow(
      ".gtd/REVIEW.orig.md is a pending hand-off",
    )
  })

  it("refuses a turn that leaves the registry entry", async () => {
    const repo = repoWith()
    await repo.start("cleanup", "--var", "flag=live")
    await expect(
      repo.drive({ "cleanup.removing": (_, r) => r.write("src/a.ts", "export const on = true\n") }),
    ).rejects.toThrow('gtd land: cleanup: src/flags/index.ts still declares flag "live"')
  })

  it("refuses a turn leaving the env var in a shipped source, naming path:line", async () => {
    const repo = repoWith()
    await repo.start("cleanup", "--var", "flag=live")
    await expect(
      repo.drive({ "cleanup.removing": (_, r) => r.write("src/flags/index.ts", WITHOUT_LIVE) }),
    ).rejects.toThrow("gtd land: cleanup: src/a.ts:1 still names GTD_FLAG_LIVE")
  })

  it.each([
    [[], "gtd: cleanup needs --var flag=<name>"],
    [["--var", "flag=nope"], 'gtd: cleanup: no flag "nope" in src/flags/index.ts'],
    [["--var", "flag=ops1"], 'gtd: cleanup: flag "ops1" is ops, not release'],
    [["--var", "flag=alpha"], 'gtd: cleanup: flag "alpha" is not default-on — roll it out first'],
  ])("refuses %j at start", async (args, message) => {
    await expect(repoWith().start("cleanup", ...args)).rejects.toThrow(message)
  })
})
