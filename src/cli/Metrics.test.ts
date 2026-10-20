import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { applyEmittedScript, InMemRepo, makeCapturingCliIo, testLayers } from "../testkit/index.js"
import { runCli } from "./index.js"
import { processMetrics, readProcessMetrics, totalMetrics, type MetricCommit } from "./Metrics.js"

const turn = (subject: string, opts: { cost?: string; findings?: number } = {}): MetricCommit => ({
  message: opts.cost === undefined ? subject : `${subject}\n\nGtd-Cost: ${opts.cost}`,
  findings: opts.findings ?? 0,
})

describe("processMetrics", () => {
  it("counts a naive pass applied as it is as a landed slice", () => {
    const m = processMetrics([
      turn("gtd(human): idle → seam.naive"),
      turn("gtd(agent): seam.naive → seam.check", { cost: "0.4 coder" }),
      turn("gtd(check): seam.check → implement.applying"),
      turn("gtd(check): implement.applying → idle"),
    ])
    expect(m.slices).toEqual({ decided: 1, landed: 1, rebuilt: 0, refactored: 0 })
    expect(m.refactorFirstRate).toBe(0)
    expect(m.cost.byPhase).toEqual({ naive: 0.4, refactor: 0, implement: 0, other: 0 })
    expect(m.cost.doubleWork).toEqual({ naive: 0, rebuild: 0, total: 0 })
  })

  it("charges a rebuilt slice's naive pass and rebuild as double work, refactor apart", () => {
    const m = processMetrics([
      turn("gtd(human): idle → seam.naive"),
      turn("gtd(agent): seam.naive → seam.continue.naive", { cost: "0.4 coder" }),
      turn("gtd(agent): seam.continue.naive → seam.judge", { cost: "0.2 coder" }),
      turn("gtd(judge): seam.judge → seam.note", { cost: "0.01 judge" }),
      turn("gtd(agent): seam.note → refactor.deriving", { cost: "0.05 coder" }),
      turn("gtd(check): refactor.deriving → refactor.building"),
      turn("gtd(agent): refactor.building → refactor.closing", { cost: "0.3 coder" }),
      turn("gtd(check): refactor.closing → implement.building"),
      turn("gtd(agent): implement.building → implement.continue.building", { cost: "0.5 coder" }),
      turn("gtd(agent): implement.continue.building → idle", { cost: "0.25 coder" }),
    ])
    expect(m.slices).toEqual({ decided: 1, landed: 0, rebuilt: 1, refactored: 1 })
    expect(m.refactorFirstRate).toBe(1)
    expect(m.continuations).toEqual({ "seam.naive": 1, "implement.building": 1 })
    expect(m.cost.total).toBe(1.71)
    expect(m.cost.byModel).toEqual({ coder: 1.7, judge: 0.01 })
    expect(m.cost.byPhase).toEqual({ naive: 0.6, refactor: 0.35, implement: 0.75, other: 0.01 })
    expect(m.cost.doubleWork).toEqual({ naive: 0.6, rebuild: 0.75, total: 1.35 })
  })

  it("rebuilds without a refactor when the slice leaves the seam for a build turn", () => {
    const m = processMetrics([
      turn("gtd(judge): seam.judge → implement.building"),
      turn("gtd(agent): implement.building → idle"),
    ])
    expect(m.slices).toEqual({ decided: 1, landed: 0, rebuilt: 1, refactored: 0 })
  })

  it("keeps each slice's decision apart", () => {
    const m = processMetrics([
      turn("gtd(agent): seam.naive → seam.check", { cost: "1" }),
      turn("gtd(check): seam.check → implement.applying"),
      turn("gtd(agent): implement.building → implement.health.check", { cost: "1" }),
      turn("gtd(check): implement.closing → seam.naive"),
      turn("gtd(agent): seam.naive → seam.note", { cost: "2" }),
      turn("gtd(agent): seam.note → refactor.deriving"),
      turn("gtd(agent): refactor.continue.building → refactor.closing", { cost: "1" }),
      turn("gtd(check): refactor.closing → implement.building"),
      turn("gtd(agent): implement.building → idle", { cost: "3" }),
    ])
    expect(m.slices).toEqual({ decided: 2, landed: 1, rebuilt: 1, refactored: 1 })
    expect(m.refactorFirstRate).toBe(0.5)
    expect(m.continuations).toEqual({ "refactor.building": 1 })
    expect(m.cost.byModel).toEqual({ unspecified: 8 })
    expect(m.cost.doubleWork).toEqual({ naive: 2, rebuild: 3, total: 5 })
  })

  it("counts a naive retry in a fresh conversation as naive cost", () => {
    const m = processMetrics([
      turn("gtd(agent): seam.continue.naive → seam.judge", { cost: "1" }),
      turn("gtd(judge): seam.judge → seam.fresh.naive"),
      turn("gtd(agent): seam.fresh.naive → seam.judge", { cost: "2" }),
      turn("gtd(judge): seam.judge → implement.building"),
    ])
    expect(m.cost.byPhase.naive).toBe(3)
    expect(m.cost.doubleWork.naive).toBe(3)
  })

  it("turns a landed slice whose naive pass fails to apply into a rebuild", () => {
    const m = processMetrics([
      turn("gtd(agent): seam.naive → seam.check", { cost: "1" }),
      turn("gtd(check): seam.check → implement.applying"),
      turn("gtd(check): implement.applying → implement.building"),
      turn("gtd(agent): implement.building → implement.health.check", { cost: "2" }),
    ])
    expect(m.slices).toEqual({ decided: 1, landed: 0, rebuilt: 1, refactored: 0 })
    expect(m.cost.doubleWork).toEqual({ naive: 1, rebuild: 2, total: 3 })
  })

  it("keeps the refactor lap's lens findings apart from the feature lap's", () => {
    const m = processMetrics([
      turn("gtd(agent): refactor.build.quality.correctness.reviewing → refactor.closing", {
        findings: 3,
      }),
      turn("gtd(agent): build.quality.correctness.reviewing → idle", { findings: 2 }),
    ])
    expect(m.findings.byLens).toEqual({
      "refactor.build.quality.correctness": 3,
      "build.quality.correctness": 2,
    })
  })

  it("ends a rebuild's double work at the slice's closing", () => {
    const m = processMetrics([
      turn("gtd(judge): seam.judge → implement.building"),
      turn("gtd(agent): implement.building → implement.closing", { cost: "1" }),
      turn("gtd(check): implement.closing → build.quality.correctness.reviewing"),
      turn("gtd(agent): implement.building → idle", { cost: "2" }),
    ])
    expect(m.cost.doubleWork.rebuild).toBe(1)
    expect(m.cost.byPhase.implement).toBe(3)
  })

  it("keeps a model named like an Object member a plain key", () => {
    const m = processMetrics([
      turn("gtd(agent): seam.naive → seam.check", { cost: "0.4 constructor" }),
      turn("gtd(agent): seam.naive → seam.check", { cost: "0.1 __proto__" }),
    ])
    expect(m.cost.total).toBe(0.5)
    expect(Object.entries(m.cost.byModel)).toEqual([
      ["constructor", 0.4],
      ["__proto__", 0.1],
    ])
  })

  it("has no refactor-first rate without a seam decision", () => {
    expect(processMetrics([turn("gtd(human): idle → building")]).refactorFirstRate).toBeNull()
  })

  it("counts continuations only for agent turns, the bare form included", () => {
    const m = processMetrics([
      turn("gtd(agent): seam.continue.naive"),
      turn("gtd(human): seam.continue.naive → seam.oversized"),
    ])
    expect(m.continuations).toEqual({ "seam.naive": 1 })
  })

  it("sums findings per quality lens and skips commits gtd did not write", () => {
    const m = processMetrics([
      turn(
        "gtd(agent): build.quality.correctness.reviewing → build.quality.conventions.reviewing",
        {
          findings: 2,
        },
      ),
      turn("gtd(agent): build.quality.conventions.reviewing → build.fix.quality.fixing", {
        findings: 1,
      }),
      turn("fix: a hand-made commit", { cost: "5" }),
    ])
    expect(m.findings).toEqual({
      total: 3,
      byLens: { "build.quality.correctness": 2, "build.quality.conventions": 1 },
    })
    expect(m.cost.total).toBe(0)
  })
})

describe("flaky re-checks", () => {
  it("counts each flaky re-check under the red check's full step name", () => {
    const m = processMetrics([
      {
        message:
          "gtd(check): start-gate.recheck → design.triage\n\nGtd-Mark: flaky=start-gate.check",
        findings: 0,
      },
      {
        message: "gtd(check): build.health.recheck → idle\n\nGtd-Mark: flaky=health.check",
        findings: 0,
      },
      {
        message:
          "gtd(check): implement.health.recheck → implement.closing\n\nGtd-Mark: flaky=health.check",
        findings: 0,
      },
      { message: "gtd(agent): seam.naive → seam.check\n\nGtd-Mark: covers=AC-1", findings: 0 },
      { message: "fix: hand-made\n\nGtd-Mark: flaky=x.check", findings: 0 },
    ])
    expect(m.flaky).toEqual({
      total: 3,
      byStep: { "start-gate.check": 1, "build.health.check": 1, "implement.health.check": 1 },
    })
    expect(totalMetrics([m, m]).flaky).toEqual({
      total: 6,
      byStep: { "start-gate.check": 2, "build.health.check": 2, "implement.health.check": 2 },
    })
  })
})

describe("totalMetrics", () => {
  it("adds processes and recomputes the rate over every decision", () => {
    const a = processMetrics([
      turn("gtd(agent): seam.naive → seam.check", { cost: "1 a" }),
      turn("gtd(check): seam.check → implement.applying"),
    ])
    const b = processMetrics([
      turn("gtd(agent): seam.continue.naive → seam.note", { cost: "2 b" }),
      turn("gtd(agent): seam.note → refactor.deriving"),
      turn("gtd(agent): seam.naive → seam.note"),
      turn("gtd(agent): seam.note → refactor.deriving"),
    ])
    const total = totalMetrics([a, b])
    expect(total.processes).toBe(2)
    expect(total.slices).toEqual({ decided: 3, landed: 1, rebuilt: 2, refactored: 2 })
    expect(total.refactorFirstRate).toBe(0.667)
    expect(total.continuations).toEqual({ "seam.naive": 1 })
    expect(total.cost.byModel).toEqual({ a: 1, b: 2 })
  })
})

const CONFIG = `import { agent, human, scope } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await scope("build", () => scope("quality", () => scope("correctness", () => agent("reviewing", "review"))))
}
`

const land = async (repo: InMemRepo, files: Record<string, string>): Promise<string> => {
  for (const [path, content] of Object.entries(files)) repo.writeFile(path, content)
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", "land", "--json"], io))
  const { stdout, exitCode, stderr } = result()
  if (exitCode !== 0) throw new Error(`land exited ${exitCode}: ${stderr}`)
  const outcome = applyEmittedScript(
    repo,
    new Map(),
    (JSON.parse(stdout) as { script: string }).script,
  )
  if (!outcome.ok) throw new Error(outcome.error)
  return repo.resolveRef("HEAD")!
}

describe("readProcessMetrics", () => {
  it("counts the findings a reviewing turn added to an existing QUALITY.md", async () => {
    const repo = new InMemRepo()
    repo.writeFile("gtd.config.ts", CONFIG)
    repo.writeFile(".gtd/QUALITY.md", "## old finding\n")
    repo.seedCommit("chore: add workflow")
    const entry = await land(repo, { "NOTE.md": "go\n" })
    const tip = await land(repo, { ".gtd/QUALITY.md": "## old finding\n\n## one\n\n## two\n" })
    const metrics = await Effect.runPromise(
      readProcessMetrics({ entry, tip }).pipe(Effect.provide(testLayers(repo, {}))),
    )
    expect(metrics.findings).toEqual({ total: 2, byLens: { "build.quality.correctness": 2 } })
    expect(metrics.workflow).toBeNull()
  })
})
