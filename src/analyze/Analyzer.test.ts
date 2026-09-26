import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { analyzeWorkflow } from "./index.js"
import type { AnalyzeResult } from "./Analyzer.js"

const FLOWS_DIR = resolve(import.meta.dirname, "../flows")
const CONFIG = "/virtual/project/gtd.config.ts"

const analyze = (source: string, extra: Record<string, string> = {}): AnalyzeResult =>
  analyzeWorkflow({
    entryFile: CONFIG,
    flowsDir: FLOWS_DIR,
    sources: { [CONFIG]: source, ...extra },
  })

const IMPORTS = `import { agent, human, run, judge, restart, refuse, scope, persona, exists, added, history, tail, workflow } from "@pmelab/gtd/flows"\n`

const edgesOf = (result: AnalyzeResult): string[] =>
  result.graph.edges
    .map((e) => `${e.from} -> ${e.to}${e.label === "" ? "" : ` [${e.label}]`}`)
    .sort()

const entryEdges = (result: AnalyzeResult, name = "default"): string[] =>
  (result.graph.entries.find((e) => e.name === name)?.edges ?? [])
    .map((e) => `${e.to}${e.label === "" ? "" : ` [${e.label}]`}`)
    .sort()

const messages = (result: AnalyzeResult): string[] =>
  result.diagnostics.map((d) => `${d.line}: ${d.message}`)

describe("the workflow analyzer", () => {
  it("collapses a straight line to step → step edges", () => {
    const result = analyze(`${IMPORTS}
export default workflow({
  default: async () => {
    await human("idle", { file: "TODO.md", label: "Idle" })
    await run("check", "npm test")
    await agent("build", "go")
  },
})`)
    expect(result.diagnostics).toEqual([])
    expect(entryEdges(result)).toEqual(["idle"])
    expect(edgesOf(result)).toEqual(["build -> $end", "check -> build", "idle -> check"])
    expect(result.graph.nodes.find((n) => n.name === "idle")?.options).toEqual({
      file: "TODO.md",
      label: "Idle",
    })
    expect(result.graph.nodes.find((n) => n.name === "check")?.content).toBe("npm test")
  })

  it("turns a loop into a cycle and labels each edge with its path's conditions", () => {
    const result = analyze(`${IMPORTS}
export default workflow({
  default: async () => {
    for (let attempt = 1; ; attempt++) {
      await run("check", "npm test")
      if (!exists(".gtd/FEEDBACK.md")) break
      if (attempt > 3) await human("stuck")
      else await agent("fix", "fix it")
    }
    await human("done")
  },
})`)
    expect(result.diagnostics).toEqual([])
    expect(edgesOf(result)).toEqual(
      [
        'check -> done [!exists(".gtd/FEEDBACK.md")]',
        'check -> fix [!(!exists(".gtd/FEEDBACK.md")) && !(attempt > 3)]',
        'check -> stuck [!(!exists(".gtd/FEEDBACK.md")) && attempt > 3]',
        "done -> $end",
        "fix -> check",
        "stuck -> check",
      ].sort(),
    )
  })

  it("follows early break and return out of nested blocks", () => {
    const result = analyze(`${IMPORTS}
const gate = async () => {
  await human("gate")
  if (added("NOTE.md").length > 0) return
  await agent("explain", "why")
}
export default workflow({
  default: async () => {
    while (true) {
      await gate()
      if (exists("DONE")) break
    }
    await human("after")
  },
})`)
    expect(result.diagnostics).toEqual([])
    expect(edgesOf(result)).toEqual(
      [
        "after -> $end",
        'explain -> after [exists("DONE")]',
        'explain -> gate [!(exists("DONE"))]',
        'gate -> after [added("NOTE.md").length > 0 && exists("DONE")]',
        'gate -> explain [!(added("NOTE.md").length > 0)]',
        'gate -> gate [added("NOTE.md").length > 0 && !(exists("DONE"))]',
      ].sort(),
    )
  })

  it("branches a ternary whose arms are steps", () => {
    const result = analyze(`${IMPORTS}
export default workflow({
  default: async () => {
    await human("start")
    exists("x") ? await agent("left", "l") : await agent("right", "r")
    await human("end")
  },
})`)
    expect(edgesOf(result)).toEqual(
      [
        "end -> $end",
        "left -> end",
        "right -> end",
        'start -> left [exists("x")]',
        'start -> right [!(exists("x"))]',
      ].sort(),
    )
  })

  it("specializes a callback per call site, under the scope active where it runs", () => {
    const result = analyze(`${IMPORTS}
const green = (name: string) => run(name, "npm test")
export async function healthy(fix: () => Promise<void>, cap = 3) {
  for (let attempt = 1; !(await green("check")); attempt++) {
    const prior = history.previous(".gtd/FEEDBACK.md", { since: "check" })
    let stuck = attempt > cap
    if (!stuck && prior) {
      stuck = (await judge("judge", { id: "verdict", primitive: "choice", instructions: "", criteria: "" }, {
        current: tail(".gtd/FEEDBACK.md", 0.5),
      })) === "identical"
    }
    if (stuck) await agent("escalate", "why")
    else await fix()
  }
}
export default workflow({
  default: async () => {
    await scope("packages", () => healthy(() => agent("fix", "fix the package")))
    await scope("build", () => healthy(() => agent("fix", "fix the build")))
  },
})`)
    expect(result.diagnostics).toEqual([])
    const names = result.graph.nodes.map((n) => n.name).sort()
    expect(names).toEqual([
      "build.check",
      "build.escalate",
      "build.fix",
      "build.judge",
      "packages.check",
      "packages.escalate",
      "packages.fix",
      "packages.judge",
    ])
    const edges = edgesOf(result)
    expect(edges).toContain("packages.fix -> packages.check")
    expect(edges).toContain('packages.check -> build.check [!(!(await green("check")))]')
    expect(edges).toContain('build.check -> $end [!(!(await green("check")))]')
    expect(result.graph.nodes.find((n) => n.name === "build.fix")?.content).toBe("fix the build")
    expect(result.graph.nodes.find((n) => n.name === "packages.check")?.scope).toBe("packages")
  })

  it("ends the graph at restart() and drops a refused path", () => {
    const result = analyze(`${IMPORTS}
export default workflow({
  default: async () => {
    await human("gate")
    if (exists("bad")) refuse("no")
    if (exists("again")) await restart("over")
    await human("next")
  },
})`)
    expect(edgesOf(result)).toEqual(
      [
        'gate -> next [!(exists("bad")) && !(exists("again"))]',
        'gate -> over [!(exists("bad")) && exists("again")]',
        "next -> $end",
        "over -> $end",
      ].sort(),
    )
  })

  it("records every entry's own first steps", () => {
    const result = analyze(`${IMPORTS}
const rest = async () => { await agent("review", "r") }
export default workflow({
  default: async () => { await human("idle"); await rest() },
  "fix-precheck": { flow: async () => { await run("fix-precheck", "npm test"); await rest() } },
})`)
    expect(result.diagnostics).toEqual([])
    expect(entryEdges(result, "fix-precheck")).toEqual(["fix-precheck"])
    expect(edgesOf(result)).toContain("fix-precheck -> review")
    expect(edgesOf(result)).toContain("review -> $end")
  })

  describe("rejects, with a file:line diagnostic", () => {
    it("a non-literal step name", () => {
      const result = analyze(`${IMPORTS}
export default workflow({
  default: async () => {
    const name = String(Math.max(1, 2))
    await human(name)
  },
})`)
      expect(messages(result)).toEqual([
        "6: the first argument of human() must be a string literal step name",
      ])
      expect(result.diagnostics[0]?.origin).toBe(CONFIG)
    })

    it("an await on anything but a step", () => {
      const result = analyze(`${IMPORTS}
export default workflow({
  default: async () => {
    await Promise.resolve(1)
    await human("x")
  },
})`)
      expect(messages(result)[0]).toMatch(/^5: flow code may await only a step/)
    })

    it("an unresolvable callback", () => {
      const result = analyze(`${IMPORTS}
declare const somewhere: () => Promise<void>
export default workflow({
  default: async () => {
    await scope("x", somewhere)
  },
})`)
      expect(messages(result)).toEqual(["6: the callback of scope() cannot be resolved"])
    })

    it("try/catch around steps", () => {
      const result = analyze(`${IMPORTS}
export default workflow({
  default: async () => {
    try {
      await human("x")
    } catch {}
  },
})`)
      expect(messages(result)[0]).toMatch(/^5: try\/catch around a step/)
    })

    it("IO and nondeterminism in flow code, but not in a run body or at load time", () => {
      const result = analyze(
        `${IMPORTS}import { readFileSync } from "node:fs"
const prompt = readFileSync("./prompt.md", "utf8")
export default workflow({
  default: async () => {
    const now = Date.now()
    const coin = Math.random()
    const home = process.env.HOME
    const text = readFileSync("x", "utf8")
    await run("check", async ({ fs }) => { fs.write("stamp", String(Date.now())) })
    await agent("go", prompt + now + coin + home + text)
  },
})`,
      )
      expect(messages(result).map((m) => m.split(":")[0])).toEqual(["6", "7", "8", "9"])
    })

    it("duplicate step names from different call sites", () => {
      const result = analyze(`${IMPORTS}
const fix = () => agent("fix", "f")
export default workflow({
  default: async () => {
    await fix()
    await fix()
    await agent("fix", "another")
  },
})`)
      expect(messages(result)).toEqual([
        '8: step name "fix" is already used by another call site — wrap one of them in scope()',
      ])
    })
  })

  it("analyzes a workflow split across modules", () => {
    const fragment = join("/virtual/project", "fragment.ts")
    const result = analyze(
      `${IMPORTS}import { review } from "./fragment.ts"
export default workflow({ default: async () => { await human("idle"); await review() } })`,
      {
        [fragment]: `import { agent } from "@pmelab/gtd/flows"\nexport const review = async () => { await agent("review", "look") }\n`,
      },
    )
    expect(result.diagnostics).toEqual([])
    expect(edgesOf(result)).toEqual(["idle -> review", "review -> $end"])
  })
})
