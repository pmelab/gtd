import { describe, expect, it } from "vitest"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { testRepo, type TestRepo } from "../../testkit/index.js"
import { reviewDoc } from "../shared/config.fixture.js"

type Actors = NonNullable<Parameters<TestRepo["drive"]>[0]>

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

describe("the cleanup guard over every later agent turn", () => {
  const FEEDBACK = ".gtd/FEEDBACK.md"
  const CLEAN = "export const on = true\n"
  const NAMED = "export const on = process.env.GTD_FLAG_LIVE\n"
  const REMOVED: Actors = {
    "cleanup.removing": (_, r) => {
      r.write("src/flags/index.ts", WITHOUT_LIVE)
      r.write("src/a.ts", CLEAN)
    },
    "build.health.check": () => undefined,
  }

  // Without the shipped access rules, which would refuse a source write from a read-only turn first: the guard is the second line.
  const NO_ACCESS = CONFIG.replace("  access,\n", "")

  const guarded = (lenses = "", workflow = CONFIG) =>
    testRepo({
      workflow,
      env: { GTD_QUALITYREVIEWS: lenses },
      files: {
        "src/flags/index.ts": REGISTRY,
        "src/a.ts": SOURCE,
        "src/calc.ts": "export const add = 1\n",
      },
    })

  const redOnce = (): Actors => {
    let runs = 0
    return {
      "build.health.check": (_, r) => {
        if (runs++ === 0) r.write(FEEDBACK, "1 failing\n")
      },
    }
  }

  const driven = async (repo: ReturnType<typeof guarded>, actors: Actors) => {
    await repo.start("cleanup", "--var", "flag=live")
    return repo.drive({ ...REMOVED, ...actors })
  }

  it("refuses a build.fix that restores the registry entry", async () => {
    await expect(
      driven(guarded(), {
        ...redOnce(),
        "build.fix": (_, r) => r.write("src/flags/index.ts", REGISTRY),
      }),
    ).rejects.toThrow('src/flags/index.ts still declares flag "live"')
  })

  it("refuses a build.fix that adds the env var to a source, naming path:line", async () => {
    await expect(
      driven(guarded(), { ...redOnce(), "build.fix": (_, r) => r.write("src/b.ts", NAMED) }),
    ).rejects.toThrow("gtd land: cleanup: src/b.ts:1 still names GTD_FLAG_LIVE")
  })

  it("lets a build.fix add the env var to a test file", async () => {
    const rest = await driven(guarded(), {
      ...redOnce(),
      "build.fix": (_, r) => r.write("src/b.test.ts", NAMED),
    })
    expect(rest.state).toBe("build.review.reviewing")
  })

  it("lets a build.fix touching only another file reach the review", async () => {
    const rest = await driven(guarded(), {
      ...redOnce(),
      "build.fix": (_, r) => r.write("src/other.ts", CLEAN),
    })
    expect(rest).toMatchObject({ state: "build.review.reviewing", actor: "agent" })
  })

  it("refuses the human's build.health.stop landing that restores the registry entry", async () => {
    let stopped = false
    let runs = 0
    const repo = guarded()
    await repo.start("cleanup", "--var", "flag=live")
    await expect(
      repo.drive({
        ...REMOVED,
        "build.health.check": (_, r) => {
          if (!stopped) r.write(FEEDBACK, `failing ${runs++}\n`)
        },
        "build.health.describe": () => undefined,
        "build.health.judge": () => '[{"id":"verdict","answer":"progress","p":0.9}]',
        "build.fix": (_, r) => r.write("src/other.ts", `export const n = ${runs}\n`),
        "build.health.stop": (_, r) => {
          stopped = true
          r.write("src/flags/index.ts", REGISTRY)
        },
      }),
    ).rejects.toThrow('still declares flag "live"')
  })

  it("refuses an escalation describe turn that re-adds the env var", async () => {
    let runs = 0
    await expect(
      driven(guarded("", NO_ACCESS), {
        "build.health.check": (_, r) => r.write(FEEDBACK, `failing ${runs++}\n`),
        "build.health.judge": () => '[{"id":"verdict","answer":"progress","p":0.9}]',
        "build.fix": (_, r) => r.write("src/other.ts", `export const n = ${runs}\n`),
        "build.health.describe": (_, r) => r.write("src/b.ts", NAMED),
      }),
    ).rejects.toThrow("src/b.ts:1 still names GTD_FLAG_LIVE")
  })

  it("refuses the first fix after escalating quality findings that re-adds the env var", async () => {
    await expect(
      driven(guarded("correctness", NO_ACCESS), {
        "build.quality.correctness.reviewing": (_, r) =>
          r.write(".gtd/QUALITY.md", "- a finding\n"),
        "build.fix.quality.fixing": () => undefined,
        "build.health.describe": () => undefined,
        "build.health.stop": () => undefined,
        "build.fix": (_, r) => r.write("src/b.ts", NAMED),
      }),
    ).rejects.toThrow("src/b.ts:1 still names GTD_FLAG_LIVE")
  })

  it("refuses a quality lens turn that re-adds the env var", async () => {
    await expect(
      driven(guarded("correctness", NO_ACCESS), {
        "build.quality.correctness.reviewing": (_, r) => r.write("src/b.ts", NAMED),
      }),
    ).rejects.toThrow("src/b.ts:1 still names GTD_FLAG_LIVE")
  })

  it("refuses a quality fix turn that restores the registry entry", async () => {
    await expect(
      driven(guarded("correctness"), {
        "build.quality.correctness.reviewing": (_, r) =>
          r.write(".gtd/QUALITY.md", "- a finding\n"),
        "build.fix.quality.fixing": (_, r) => r.write("src/flags/index.ts", REGISTRY),
      }),
    ).rejects.toThrow('still declares flag "live"')
  })

  it("refuses a risk fix turn that restores the registry entry", async () => {
    await expect(
      driven(guarded(), {
        "build.review.reviewing": (_, r) => r.write(".gtd/REVIEW.md", reviewDoc("Risk: leaks")),
        "build.review.fix.risks.fixing": (_, r) => r.write("src/flags/index.ts", REGISTRY),
      }),
    ).rejects.toThrow('still declares flag "live"')
  })

  it("refuses a review turn that re-adds the env var", async () => {
    await expect(
      driven(guarded("", NO_ACCESS), {
        "build.review.reviewing": (_, r) => {
          r.write(".gtd/REVIEW.md", reviewDoc("fine"))
          r.write("src/b.ts", NAMED)
        },
      }),
    ).rejects.toThrow("src/b.ts:1 still names GTD_FLAG_LIVE")
  })

  it("leaves the human's review sign-off unguarded", async () => {
    const repo = guarded()
    await repo.start("cleanup", "--var", "flag=live")
    const rest = await repo.drive({
      ...REMOVED,
      "build.review.reviewing": (_, r) => r.write(".gtd/REVIEW.md", reviewDoc("fine")),
    })
    expect(rest.state).toBe("build.review.await-review")
    repo.write("src/flags/index.ts", REGISTRY)
    await repo.land()
    const done = await repo.drive({ "build.review.closing": () => undefined })
    expect(done.state).not.toBe("build.review.await-review")
  })

  it("does not blame a later fix turn for the entry the human restored at sign-off", async () => {
    const repo = guarded()
    await repo.start("cleanup", "--var", "flag=live")
    let runs = 0
    const check: Actors = {
      "build.health.check": (_, r) => {
        if (runs++ === 1) r.write(FEEDBACK, "1 failing\n")
      },
    }
    const rest = await repo.drive({
      ...REMOVED,
      ...check,
      "build.review.reviewing": (_, r) => r.write(".gtd/REVIEW.md", reviewDoc("fine")),
    })
    expect(rest.state).toBe("build.review.await-review")
    repo.write("src/flags/index.ts", REGISTRY)
    repo.write("src/hand.ts", CLEAN)
    await repo.land()
    await repo.drive({ ...check, "build.fix": (_, r) => r.write("src/other.ts", CLEAN) })
    expect(repo.subjects()).toContain("gtd(agent): build.fix → build.health.check")
  })
})
