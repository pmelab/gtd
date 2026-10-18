import { describe, expect, it } from "vitest"
import { runsItsScript, testRepo } from "../../testkit/index.js"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { reviewDoc } from "../shared/config.fixture.js"

describe("an ordinary feature start", () => {
  it("unwinds a captured TODO, checks the baseline and starts design from it", async () => {
    const repo = testRepo({ workflow: CONFIG_SCAFFOLD, env: { GTD_QUALITYREVIEWS: "" } })
    repo.write("TODO.md", "# Add numbers\n\nadd(a, b) returns the sum.\n")
    const rest = await repo.drive({ unwind: () => undefined, "start-gate.check": () => undefined })
    expect(rest).toMatchObject({
      state: "design.triage",
      actor: "agent",
      file: ".gtd/REQUIREMENTS.md",
    })
    expect(repo.subjects().slice(1)).toEqual([
      "gtd(human): idle → unwind",
      "gtd(check): unwind → start-gate.check",
      "gtd(check): start-gate.check → design.triage",
    ])
  })

  it("refuses a pending hand-off right after idle, before unwinding", async () => {
    const repo = testRepo({
      workflow: CONFIG_SCAFFOLD,
      files: { ".gtd/REVIEW.md": reviewDoc("note"), ".gtd/REVIEW.orig.md": reviewDoc("orig") },
    })
    repo.write("TODO.md", "# Add numbers\n")
    await expect(repo.land()).rejects.toThrow(".gtd/REVIEW.orig.md is a pending hand-off")
    expect(repo.subjects()).toEqual(["chore: initial commit"])
  })
})

const review = (text?: string): string =>
  [
    "# Review: abc1234",
    "",
    "<!-- base: 0000000 -->",
    "",
    "## calc",
    "",
    "- [ ] ./src/calc.ts#1-1",
    text === undefined ? "  add" : "  add[^why]",
    ...(text === undefined ? [] : ["", "[^why]:", `    - H: ${text}`]),
    "",
  ].join("\n")

const CALC = "export const add = (a: number, b: number) => a + b\n"

const naivePlanned = (flag: "0" | "1") => {
  const repo = testRepo({
    workflow: CONFIG_SCAFFOLD,
    env: { GTD_QUALITYREVIEWS: "", GTD_FLAG_NAIVE_PASS: flag, GTD_FLAG_RISK_TIER: "0" },
  })
  repo.write("src/calc.ts", CALC)
  repo.commit("feat: add calculator")
  repo.write("TODO.md", "# Add subtract\n")
  return repo
}

describe("planAndBuild on the naive pass", () => {
  it("after land, feedback rests next at design.triage, then implement.building, never seam.naive", async () => {
    const repo = naivePlanned("1")
    const requirements = (_: unknown, r: typeof repo) =>
      r.write(
        ".gtd/REQUIREMENTS.md",
        "# Requirements\n\n## Concerns\n\n### Subtract\n\n- `subtract`\n",
      )
    const lap = {
      unwind: () => undefined,
      "start-gate.check": () => undefined,
      "design.triage": requirements,
      "design.gate.answer": () => undefined,
      "seam.naive": (_: unknown, r: typeof repo) => r.write("src/calc.ts", `${CALC}// naive\n`),
      "seam.judge": () => '[{"id":"shape","answer":"land","p":0.9}]',
      "implement.building": (_: unknown, r: typeof repo) =>
        r.write("src/calc.ts", `${CALC}// built\n`),
      "implement.health.check": () => undefined,
      "implement.closing": runsItsScript,
      "build.review.reviewing": (_: unknown, r: typeof repo) => r.write(".gtd/REVIEW.md", review()),
    }
    expect((await repo.drive(lap)).state).toBe("build.review.await-review")

    repo.write(".gtd/REVIEW.md", review("also export multiply"))
    await repo.land()
    const collected = await repo.drive({
      "build.review.collecting": (_, r) => {
        requirements(_, r)
        r.write(".gtd/REVIEW.md", `${review("also export multiply")}    - A: noted.\n`)
      },
    })
    expect(collected.state).toBe("build.review.await-review")

    repo.write(".gtd/REVIEW.md", review())
    await repo.land()
    const rest = await repo.drive({
      "build.review.closing": runsItsScript,
      "re-unwind": runsItsScript,
      "design.triage": (_, r) => r.write(".gtd/REQUIREMENTS.md", "# Requirements\n\n- multiply\n"),
      "design.gate.answer": () => undefined,
    })
    expect(rest.state).toBe("implement.building")
    expect(rest.content).toContain("already exists")
    expect(rest.content).not.toContain("write the change fresh")
    const subjects = repo.subjects()
    const reUnwind = subjects.findIndex((subject) => subject.endsWith("→ re-unwind"))
    expect(reUnwind).toBeGreaterThan(-1)
    expect(subjects.slice(reUnwind + 1).some((subject) => subject.includes("seam."))).toBe(false)
    expect(subjects.filter((subject) => subject.includes("→ seam.naive"))).toHaveLength(1)
  })
})

describe("planAndBuild without the naive pass", () => {
  it("runs the design → architecture path: no seam, no implement", async () => {
    const repo = naivePlanned("0")
    const rest = await repo.drive({
      unwind: () => undefined,
      "start-gate.check": () => undefined,
      "design.triage": (_, r) => r.write(".gtd/REQUIREMENTS.md", "# Requirements\n"),
      "design.gate.answer": () => undefined,
    })
    expect(rest.state).toBe("architecture.author")
    expect(repo.subjects().some((subject) => /seam|implement/.test(subject))).toBe(false)
  })
})

describe("afterTail feedback lap", () => {
  const TAIL = [
    `import { start } from "@pmelab/gtd/flows"`,
    `import { afterTail, buildTail, gate } from "@pmelab/gtd/workflows"`,
    `export { feature as default, defaults, envDefaults, summary, base, steering, skills, access } from "@pmelab/gtd/workflows"`,
    `export async function tail() {`,
    `  await gate("review-gate", "The baseline is red.")`,
    `  return afterTail(await buildTail(false, start()))`,
    `}`,
  ].join("\n")

  const feedbackLap = async (flag: "0" | "1") => {
    const repo = testRepo({
      workflow: TAIL,
      env: { GTD_QUALITYREVIEWS: "", GTD_FLAG_NAIVE_PASS: flag, GTD_FLAG_RISK_TIER: "0" },
    })
    repo.write("src/calc.ts", CALC)
    repo.commit("feat: add calculator")
    await repo.start("tail", "--var", `reviewBase=${repo.hashes()[0]}`)
    await repo.drive({
      "review-gate.check": () => undefined,
      "build.health.check": () => undefined,
      "build.review.reviewing": (_: unknown, r: typeof repo) => r.write(".gtd/REVIEW.md", review()),
    })
    repo.write(".gtd/REVIEW.md", review("also export multiply"))
    await repo.land()
    await repo.drive({
      "build.review.collecting": (_, r) => {
        r.write(".gtd/REQUIREMENTS.md", "# Requirements\n\n- multiply\n")
        r.write(".gtd/REVIEW.md", `${review("also export multiply")}    - A: noted.\n`)
      },
    })
    repo.write(".gtd/REVIEW.md", review())
    await repo.land()
    return repo
  }

  const afterFeedback = {
    "build.review.closing": runsItsScript,
    "re-unwind": runsItsScript,
    "design.triage": (_: unknown, r: ReturnType<typeof testRepo>) =>
      r.write(".gtd/REQUIREMENTS.md", "# Requirements\n\n- multiply, designed\n"),
    "design.gate.answer": () => undefined,
  }

  it("flag_naive_pass=1 rests at design.triage, then implement.building, reaching no seam step", async () => {
    const repo = await feedbackLap("1")
    expect(
      (await repo.drive({ "build.review.closing": runsItsScript, "re-unwind": runsItsScript }))
        .state,
    ).toBe("design.triage")
    const rest = await repo.drive(afterFeedback)
    expect(rest.state).toBe("implement.building")
    expect(rest.content).toContain("already exists")
    expect(rest.content).not.toContain("write the change fresh")
    expect(repo.subjects().some((subject) => subject.includes("seam."))).toBe(false)
  })

  it("flag_naive_pass=0 re-plans through architecture and packages", async () => {
    const repo = await feedbackLap("0")
    const rest = await repo.drive(afterFeedback)
    expect(rest.state).toBe("architecture.author")
  })
})
