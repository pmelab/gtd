import { describe, expect, it } from "vitest"
import { runsItsScript, testRepo } from "../../testkit/index.js"
import type { Actor } from "../../testkit/TestRepo.js"
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

  const prompts: string[] = []

  const feedbackLap = async (flag: "0" | "1") => {
    prompts.length = 0
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
      "build.review.reviewing": (beat, r) => {
        prompts.push(beat.content)
        r.write(".gtd/REVIEW.md", review())
      },
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

  it.each(["0", "1"] as const)(
    "flag_naive_pass=%s: the first review says everything since base, the one after feedback only what is new",
    async (flag) => {
      const repo = await feedbackLap(flag)
      expect(prompts[0]).toContain("it covers everything since the base")
      expect(prompts[0]).not.toContain("only what is new since the previous review")
      const writes: Record<string, () => [string, string]> = {
        "design.triage": () => [".gtd/REQUIREMENTS.md", "# Requirements\n\n- multiply, designed\n"],
        "implement.building": () => ["src/calc.ts", `${CALC}// again\n`],
        "packages.item.building": () => ["src/calc.ts", `${CALC}// package\n`],
        "architecture.author": () => [".gtd/ARCHITECTURE.md", "# Architecture\n\nmultiply\n"],
        "architecture.decompose.decomposing": () => [
          ".gtd/packages/01-multiply.md",
          "# 01 multiply\n",
        ],
      }
      const actors = new Proxy({} as Record<string, Actor>, {
        get: (_, state: string): Actor | undefined =>
          state === "build.review.await-review" || state === "idle"
            ? undefined
            : (beat, r) => {
                if (state === "build.review.reviewing") {
                  prompts.push(beat.content)
                  r.write(".gtd/REVIEW.md", review())
                } else if (writes[state]) r.write(...writes[state]())
                else if (state.endsWith("closing") || state === "re-unwind")
                  r.runScript(beat.content)
              },
      })
      await repo.drive(actors, { maxBeats: 80 })
      expect(prompts[1]).toContain("it covers only what is new since the previous review")
      expect(prompts[1]).not.toContain("everything since the base")
    },
  )
})

describe("an in-flight 28.0.0 naive-pass process", () => {
  type Edge = readonly [actor: string, from: string, to: string, trailer?: string]
  const verdict = (answer: string) => `Gtd-Judge: {"id":"shape","answer":"${answer}","p":0.9}`
  const approved = 'Gtd-Approved: {"step":"seam.approve#1","name":"Test","email":"test@test.com"}'
  const building: readonly Edge[] = [
    ["agent", "implement.building", "implement.health.check"],
    ["check", "implement.health.check", "implement.closing"],
    ["check", "implement.closing", "build.review.reviewing"],
    ["agent", "build.review.reviewing", "build.review.await-review"],
  ]
  const feedback: readonly Edge[] = [
    ["human", "build.review.await-review", "build.review.collecting"],
    ["agent", "build.review.collecting", "build.review.await-review"],
    ["human", "build.review.await-review", "build.review.closing"],
    ["check", "build.review.closing", "re-unwind"],
    ["check", "re-unwind", "design.triage"],
    ["agent", "design.triage", "design.gate.answer"],
    ["human", "design.gate.answer", "implement.building"],
  ]
  const trails: Record<string, readonly Edge[]> = {
    land: [["judge", "seam.judge", "implement.building", verdict("land")], ...building],
    "land, then a feature feedback lap": [
      ["judge", "seam.judge", "implement.building", verdict("land")],
      ...building,
      ...feedback,
    ],
    "rejected twice, steered, then landed": [
      ["judge", "seam.judge", "seam.naive", verdict("reject")],
      ["agent", "seam.naive", "seam.judge"],
      ["judge", "seam.judge", "seam.naive", verdict("reject")],
      ["agent", "seam.naive", "seam.judge"],
      ["judge", "seam.judge", "seam.steer", verdict("reject")],
      ["human", "seam.steer", "seam.naive"],
      ["agent", "seam.naive", "seam.judge"],
      ["judge", "seam.judge", "implement.building", verdict("land")],
      ...building,
    ],
    "refactor-first": [
      ["judge", "seam.judge", "seam.approve", verdict("refactor-first")],
      ["human", "seam.approve", "refactor.deriving", approved],
      ["check", "refactor.deriving", "refactor.building"],
      ["agent", "refactor.building", "refactor.health.check"],
      ["check", "refactor.health.check", "refactor.closing"],
      ["check", "refactor.closing", "implement.building"],
      ...building,
    ],
  }

  const writeEdgeFiles = (
    repo: { write: (path: string, content: string) => void },
    from: string,
    to: string,
  ) => {
    if (from === "seam.steer") repo.write(".gtd/REQUIREMENTS.md", "# Requirements\n\n- steered\n")
    if (from === "build.review.reviewing") repo.write(".gtd/REVIEW.md", review())
    if (to === "build.review.collecting")
      repo.write(".gtd/REVIEW.md", review("also export multiply"))
    if (from === "build.review.collecting") {
      repo.write(".gtd/REVIEW.md", `${review("also export multiply")}    - A: noted.\n`)
      repo.write(".gtd/REQUIREMENTS.md", "# Requirements\n\n- multiply\n")
    }
    if (to === "build.review.closing") repo.write(".gtd/REVIEW.md", review())
  }

  /** The repo at the judge's rest, then `trail` forged edge by edge as `Gtd-Step:` commits. */
  const forged = async (trail: readonly Edge[], upTo: number) => {
    const repo = naivePlanned("1")
    await repo.drive({
      unwind: () => undefined,
      "start-gate.check": () => undefined,
      "design.triage": (_, r) =>
        r.write(".gtd/REQUIREMENTS.md", "# Requirements\n\n## Concerns\n\n### S\n\n- `s`\n"),
      "design.gate.answer": () => undefined,
      "seam.naive": (_, r) => r.write("src/calc.ts", `${CALC}// naive\n`),
    })
    const kept = /Gtd-Kept: (\w+)/.exec(repo.messages().at(-1)!)![1]!
    const seen: Record<string, number> = {
      "seam.naive": 1,
      "design.triage": 1,
      "design.gate.answer": 1,
    }
    for (const [actor, from, to, trailer] of trail.slice(0, upTo)) {
      seen[from] = (seen[from] ?? 0) + 1
      writeEdgeFiles(repo, from, to)
      repo.commit(
        [
          `gtd(${actor}): ${from} → ${to}`,
          "",
          `Gtd-Step: ${from}#${seen[from]}`,
          ...(trailer === undefined ? [] : [trailer]),
          ...(actor === "agent" && from === "seam.naive" ? [`Gtd-Kept: ${kept}`] : []),
          "Gtd-Format: 1",
        ].join("\n"),
      )
    }
    return repo
  }

  for (const [name, trail] of Object.entries(trails)) {
    const replays = name !== "refactor-first"
    it(`${name}: ${replays ? "every rest replays to itself" : "every rest from the verdict on fails replay"}`, async () => {
      for (let upTo = 1; upTo <= trail.length; upTo++) {
        const rest = trail[upTo - 1]![2]
        const repo = await forged(trail, upTo)
        if (replays) expect((await repo.next()).state, rest).toBe(rest)
        else {
          await expect(repo.next(), rest).rejects.toThrow("the workflow changed under this process")
        }
      }
    })
  }
})
