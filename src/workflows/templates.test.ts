import { parse as parseYaml } from "yaml"
import { describe, expect, it } from "vitest"
import { step, TRANSITION_SEP, validateDefinition } from "../PatternMachine.js"
import { seededValidateCommand } from "../SteeringFormats.js"
import { renderStateTemplate, varsOnlyContext } from "../PatternTemplates.js"
import type { MachineNode } from "../Machines.js"
import {
  compileTemplate,
  defaultStateScopes,
  defaultWorkflowDefinition,
  defaultWorkflowVars,
  INIT_VARS,
  MODES_SUGGESTION,
  renderInitConfig,
  renderInitScaffold,
  SCHEMA_URL,
  type InitScaffold,
} from "./index.js"
import unifiedYaml from "./unified.yaml"

/** State names (sorted) whose script/prompt/message contains `needle`. */
function statesReferencing(
  definition: ReturnType<typeof compileTemplate>["definition"],
  needle: string,
): string[] {
  const contentsOf = (state: (typeof definition.states)[string]): string[] =>
    [state.script, state.prompt, state.message].filter((c): c is string => c !== undefined)
  return Object.entries(definition.states)
    .filter(([, state]) => contentsOf(state).some((c) => c.includes(needle)))
    .map(([name]) => name)
    .sort()
}

describe("the bundled unified workflow template", () => {
  it("compiles with no validation errors and exactly one initial state", () => {
    const { definition } = compileTemplate()
    expect(validateDefinition(definition).errors).toEqual([])
    expect(definition.entries.default).toBeTruthy()
    expect(definition.states[definition.entries.default]).toBeDefined()
  })

  it("declares no warnings at all — every script state routes its clean case", () => {
    // `unwind` and `build.review.deciding` were the two long-standing
    // exceptions. Each now disambiguates its ambiguous clean tree inside the
    // SCRIPT (the revert's exit code / REVIEW.md's absence) and writes
    // `.gtd/FEEDBACK.md` on the broken branch, which leaves a `C` row it can
    // honestly declare. A warning here means a state grew an unhandled clean
    // case — which stalls silently rather than failing.
    const { definition } = compileTemplate()
    expect(validateDefinition(definition).warnings).toEqual([])
  })

  it("declares `retry` on exactly build.fix and packages.item.fix-suite, and nothing else (package 01)", () => {
    const { definition } = compileTemplate()
    const withRetry = Object.entries(definition.states)
      .filter(([, state]) => state.retry !== undefined)
      .map(([name]) => name)
      .sort()
    expect(withRetry).toEqual(["build.fix", "packages.item.fix-suite"])
  })

  it("pins the `file:` prepend round trip: every compiled value starts with `.gtd/`, no raw declaration does", () => {
    const { definition } = compileTemplate()
    const compiledFiles = Object.values(definition.states)
      .map((s) => s.file)
      .filter((f): f is string => f !== undefined)
    expect(compiledFiles.length).toBeGreaterThan(0)
    for (const file of compiledFiles) expect(file.startsWith(".gtd/")).toBe(true)

    const rawFileLines = unifiedYaml
      .split("\n")
      .filter((line) => /^\s*file:\s/.test(line) && !/^\s*#/.test(line.trimStart()))
    expect(rawFileLines.length).toBeGreaterThan(0)
    for (const line of rawFileLines) expect(line).not.toMatch(/file:\s*\.gtd\//)
  })

  it("declares no `prose` mode, plus the built-in registry's `qa`/`review` seeded with their validate command", () => {
    const { definition } = compileTemplate()
    expect(definition.modes?.["prose"]).toBeUndefined()
    expect(definition.modes?.["qa"]).toEqual({ validate: seededValidateCommand("qa") })
    expect(definition.modes?.["review"]).toEqual({ validate: seededValidateCommand("review") })
  })

  it("declares no review checkout window state, and exactly one review entry", () => {
    const { definition } = compileTemplate()
    const states = Object.values(definition.states)
    expect(
      states.filter((s) => (s as { reviewWindow?: boolean }).reviewWindow === true),
    ).toHaveLength(0)
    expect(definition.entries.manual).toContain("review-gate.check")
  })

  it("declares exactly one review-base state anchoring the incremental review window", () => {
    const { definition } = compileTemplate()
    const states = Object.values(definition.states)
    expect(states.filter((s) => s.reviewBase === true)).toHaveLength(1)
  })

  it("no compiled state's content mentions a deleted diff variable — prompts carry ranges, never diff content", () => {
    const { definition } = compileTemplate()
    const forbidden = /processDiff|reviewDiff|retainedDiff|lastDiff/
    for (const [name, state] of Object.entries(definition.states)) {
      for (const content of [state.script, state.prompt, state.message]) {
        if (content !== undefined) expect(content, `state "${name}"`).not.toMatch(forbidden)
      }
    }
  })

  it("the initial state declares a non-empty file and no mode — a steering-file hint with no format/validate obligation", () => {
    const { definition } = compileTemplate()
    const idle = definition.states.idle!
    expect(idle.file).toBeTruthy()
    expect(idle.mode).toBeUndefined()
  })

  it("the initial state has exactly one outgoing edge, into unwind — no filename fork", () => {
    const { definition } = compileTemplate()
    const idle = definition.states.idle!
    const targets = (idle.on ?? []).map(([, to]) => to)
    expect(targets).toEqual(["unwind"])
    // unwind's single inbound edge (from idle) means it's structurally
    // reached once per process, so it needs no idempotence guard.
    const inbound = Object.entries(definition.states).flatMap(([from, s]) =>
      (s.on ?? []).filter(([, to]) => to === "unwind").map(() => from),
    )
    expect(inbound).toEqual(["idle"])
    // The revert's failure branch writes `.gtd/FEEDBACK.md` and forks to a
    // human gate; every other outcome, clean tree included, advances.
    const unwindTargets = (definition.states.unwind!.on ?? []).map(([, to]) => to)
    expect(unwindTargets).toEqual([
      "unwind-failed",
      "unwind-failed",
      "start-gate.check",
      "start-gate.check",
    ])
    expect((definition.states["start-gate.check"]!.on ?? []).map(([, to]) => to)).toContain(
      "design.triage",
    )
  })

  it("declares exactly the three qualified entryGate/fix-precheck states as manual entries", () => {
    // Both `entryGate` instances share one `check` local declaring `entry:
    // true`, so the dedup marks both even though only `review-gate.check`
    // needs the reachability root.
    const { definition } = compileTemplate()
    const { default: def, manual } = definition.entries
    expect(def).toBeTruthy()
    expect(manual).toEqual(["fix-precheck", "review-gate.check", "start-gate.check"])
    expect(new Set([def, ...manual]).size).toBe(4)
    expect(definition.states[def]).toBeDefined()
    for (const state of manual) expect(definition.states[state]).toBeDefined()
  })

  it("the entry gate's check and fix-precheck each sweep a leftover review capture, ordered after the FEEDBACK rows", () => {
    // A swept run's diff carries the sweep's `D .gtd/REVIEW_RAW.md` alongside
    // whatever the suite wrote, so a red run that also swept must still route
    // through the FEEDBACK rows, not the sweep row.
    const { definition } = compileTemplate()
    for (const name of ["start-gate.check", "review-gate.check", "fix-precheck"]) {
      const patterns = (definition.states[name]!.on ?? []).map(([pattern]) => pattern)
      const feedbackIndexes = patterns
        .map((p, i) => [p, i] as const)
        .filter(([p]) => p === "A .gtd/FEEDBACK.md" || p === "M .gtd/FEEDBACK.md")
        .map(([, i]) => i)
      const sweepIndex = patterns.indexOf("D .gtd/REVIEW_RAW.md")
      expect(feedbackIndexes.length, name).toBe(2)
      expect(sweepIndex, name).toBeGreaterThan(-1)
      expect(sweepIndex, name).toBeGreaterThan(Math.max(...feedbackIndexes))
    }
    // The health gate's shared check needs no row of its own: its existing
    // green catch-all already absorbs the sweep's deletion.
    expect(
      (definition.states["start-gate.check"]!.script as string).match(
        /rm -f \.gtd\/REVIEW_RAW\.md/g,
      )?.length,
    ).toBe(1)
  })

  it("compiles exactly one template-form reviewBase, and no truthy reviewBase on start-gate", () => {
    // `start-gate.check` binds the same `$reviewBase` param to the literal
    // empty string, which compiles away to "field absent".
    const { definition } = compileTemplate()
    const states = definition.states
    const templateReviewBase = Object.entries(states).filter(
      ([, s]) => typeof s.reviewBase === "string",
    )
    expect(templateReviewBase.map(([name]) => name)).toEqual(["review-gate.check"])
    expect(states["start-gate.check"]!.reviewBase).toBeUndefined()
  })

  it("declares exactly two questionGate instances, each `check` and `answer` with a C row — answer's C row lands on the same target as its `* **` row (package 01)", () => {
    const { definition } = compileTemplate()
    // Pinned by count so a third `.gate.check` added later fails loudly.
    const gateChecks = Object.keys(definition.states)
      .filter((name) => name.endsWith(".gate.check"))
      .sort()
    expect(gateChecks).toEqual(["architecture.gate.check", "design.gate.check"])
    for (const prefix of ["design.gate", "architecture.gate"]) {
      const check = definition.states[`${prefix}.check`]!
      const answer = definition.states[`${prefix}.answer`]!
      const checkPatterns = (check.on ?? []).map(([pattern]) => pattern)
      expect(checkPatterns, prefix).toContain("C")
      expect(answer.answerGate).toBe(true)
      expect(answer.mode).toBe("qa")
      expect(answer.file).toBeTruthy()
      const cRow = (answer.on ?? []).find(([pattern]) => pattern === "C")
      const starRow = (answer.on ?? []).find(([pattern]) => pattern === "* **")
      expect(cRow, prefix).toBeDefined()
      expect(starRow, prefix).toBeDefined()
      expect(cRow![1], prefix).toEqual(starRow![1])
    }
  })

  it("no state declares `mode: prose`", () => {
    const { definition } = compileTemplate()
    for (const [name, state] of Object.entries(definition.states)) {
      expect(state.mode, `state "${name}"`).not.toBe("prose")
    }
  })

  it("exposes the compiled default as the built-in fallback (definition + its own vars)", () => {
    expect(validateDefinition(defaultWorkflowDefinition).errors).toEqual([])
    expect(defaultWorkflowDefinition).toEqual(compileTemplate().definition)
    expect(defaultWorkflowVars).toEqual(compileTemplate().vars)
    expect(defaultWorkflowVars.testCommand).toBe("npm test")
  })

  it("exposes defaultStateScopes covering every state in the compiled default", () => {
    expect(defaultStateScopes).toEqual(compileTemplate().scopes)
    expect(Object.keys(defaultStateScopes).sort()).toEqual(
      Object.keys(defaultWorkflowDefinition.states).sort(),
    )
  })

  it("renders the full workflow config with the $schema key first (renderInitConfig)", () => {
    const rendered = renderInitConfig()
    const parsed = JSON.parse(rendered) as { $schema: string; workflow: unknown; modes?: unknown }
    expect(parsed.$schema).toBe(SCHEMA_URL)
    expect(parsed.workflow).toBeTypeOf("object")
    expect(parsed.modes).toBeUndefined()
    expect(rendered.endsWith("\n")).toBe(true)
  })

  describe("renderInitScaffold — the minimal config `gtd init` writes", () => {
    it("seeds only the default vars and the Prettier modes suggestion, no workflow", () => {
      const scaffold: InitScaffold = renderInitScaffold()
      const { config } = scaffold
      const parsed = JSON.parse(config) as {
        $schema: string
        vars: unknown
        modes: unknown
        workflow?: unknown
      }
      expect(parsed.$schema).toBe(SCHEMA_URL)
      expect(parsed.vars).toEqual(INIT_VARS)
      expect(parsed.modes).toEqual(MODES_SUGGESTION)
      expect(parsed.workflow).toBeUndefined()
      expect(config.endsWith("\n")).toBe(true)
    })

    it("seeds testCommand as the one variable a fresh project usually changes", () => {
      const { config } = renderInitScaffold()
      const parsed = JSON.parse(config) as { vars: { testCommand?: string } }
      expect(parsed.vars.testCommand).toBe("npm test")
    })

    it("seeds a format-only Prettier suggestion for qa/review (gtd still validates), and no prose entry", () => {
      expect(MODES_SUGGESTION.qa.format).toContain("prettier")
      expect(MODES_SUGGESTION.review.format).toContain("prettier")
      expect(MODES_SUGGESTION.qa).not.toHaveProperty("validate")
      expect(MODES_SUGGESTION.review).not.toHaveProperty("validate")
      expect(MODES_SUGGESTION).not.toHaveProperty("prose")
    })
  })

  it("packages.item.building declares an escape hatch for a package whose work already landed (issue #152)", () => {
    // An earlier package's fix turn may already satisfy this one's acceptance
    // criteria; without this edge that dead-ends in an empty attempt + stall.
    const { definition } = compileTemplate()
    const building = definition.states["packages.item.building"]!
    const edges = building.on ?? []
    const satisfiedAdd = edges.find(([pattern]) => pattern.includes("A "))
    const satisfiedMod = edges.find(([pattern]) => pattern.includes("M "))
    expect(satisfiedAdd?.[1]).toBe("packages.item.health.check")
    expect(satisfiedAdd?.[3]).toBeTruthy() // action
    expect(satisfiedMod?.[1]).toBe(satisfiedAdd?.[1])
  })

  // Voice only, no structural override, since nothing parses their output.
  const PROSE_PROMPTS = ["architecture.decompose", "packages.item.spec.review"]

  // The only states that interpolate both a `file:` and a `mode:` of
  // `qa`/`review` — get both the voice and the structural override that
  // outranks it.
  const PARSED_PROMPTS = [
    "design.triage",
    "architecture.author",
    "build.review.collecting",
    "build.review.reviewing",
  ]

  it("declares the styleBlock/styleFormatContract voice variables, non-empty, styleFormatContract on-message (package 01)", () => {
    const { vars } = compileTemplate()
    expect(vars.styleBlock).toBeTruthy()
    expect(vars.styleFormatContract).toBeTruthy()

    // The structural override names its consequence, not a polite ask.
    expect(vars.styleFormatContract).toMatch(/checkbox/)
    expect(vars.styleFormatContract).toMatch(/##.*###.*heading/)
    expect(vars.styleFormatContract).toMatch(/renumber|rename|reorder/i)
    expect(vars.styleFormatContract).toMatch(/refus/i)

    expect(unifiedYaml).toMatch(/attention-span/)
    expect(unifiedYaml).toMatch(/https:\/\/github\.com\/alexgreensh\/attention-span/)
    expect(unifiedYaml).toMatch(/AGPL-3\.0/)
    expect(unifiedYaml).toMatch(/version 0\.6|v0\.6/)
  })

  it("pins the six voice-bearing prompts by name and count, so a seventh site added later fails loudly (package 02, 03)", () => {
    expect([...PROSE_PROMPTS, ...PARSED_PROMPTS].sort()).toEqual(
      [
        "architecture.decompose",
        "packages.item.spec.review",
        "design.triage",
        "architecture.author",
        "build.review.collecting",
        "build.review.reviewing",
      ].sort(),
    )
  })

  it("wires styleBlock into exactly the seven voice-bearing prompts and nowhere else (package 02, 03)", () => {
    const { definition } = compileTemplate()
    expect(statesReferencing(definition, "styleBlock")).toEqual(
      [...PROSE_PROMPTS, ...PARSED_PROMPTS].sort(),
    )
  })

  it("wires styleFormatContract into exactly the four machine-parsed prompts and nowhere else (package 03)", () => {
    const { definition } = compileTemplate()
    expect(statesReferencing(definition, "styleFormatContract")).toEqual([...PARSED_PROMPTS].sort())
  })

  it("every voice-bearing prompt uses the raw (unescaped) styleBlock tag form (package 02, 03)", () => {
    // The value carries backticks/quotes/markup the escaping tag form would mangle.
    const { definition } = compileTemplate()
    for (const name of [...PROSE_PROMPTS, ...PARSED_PROMPTS]) {
      expect(definition.states[name]?.prompt, `state "${name}"`).toMatch(
        /<%~\s*it\.vars\.styleBlock\s*%>/,
      )
    }
  })

  it("each machine-parsed prompt puts the raw styleFormatContract tag after styleBlock, so the override sits closest to the state's own contract (package 03)", () => {
    const { definition } = compileTemplate()
    for (const name of PARSED_PROMPTS) {
      const prompt = definition.states[name]?.prompt ?? ""
      expect(prompt, `state "${name}"`).toMatch(/<%~\s*it\.vars\.styleFormatContract\s*%>/)
      const blockIndex = prompt.search(/<%~\s*it\.vars\.styleBlock\s*%>/)
      const contractIndex = prompt.search(/<%~\s*it\.vars\.styleFormatContract\s*%>/)
      expect(blockIndex, `state "${name}" styleBlock precedes styleFormatContract`).toBeLessThan(
        contractIndex,
      )
    }
  })

  it("packages.item.closing's script sweeps the satisfied-evidence file, and healthGate.check's shared sweep does not", () => {
    // closing is the single owner of that cleanup: sweeping it earlier (in the
    // shared healthGate.check) would delete the evidence before spec.review
    // reads it.
    const { definition } = compileTemplate()
    const closing = definition.states["packages.item.closing"]!
    expect(closing.script).toContain(".gtd/SATISFIED.md")
    const buildHealthCheck = definition.states["build.health.check"]!
    const packagesHealthCheck = definition.states["packages.item.health.check"]!
    expect(buildHealthCheck.script).not.toContain(".gtd/SATISFIED.md")
    expect(packagesHealthCheck.script).not.toContain(".gtd/SATISFIED.md")
  })

  it("healthGate.check writes .gtd/PRIOR_FEEDBACK.md from history and routes to judge only when it appears, straight to $onRed otherwise (package 01, task 7)", () => {
    const { definition } = compileTemplate()
    for (const check of ["build.health.check", "packages.item.health.check"]) {
      const script = definition.states[check]!.script!
      expect(script).toContain(".gtd/PRIOR_FEEDBACK.md")
      expect(script).toContain(".gtd/FEEDBACK.md")
      const onEdges = definition.states[check]!.on ?? []
      const patterns = onEdges.map(([pattern]) => pattern)
      const priorIndex = patterns.findIndex((p) => p.includes("PRIOR_FEEDBACK.md"))
      const feedbackIndex = patterns.findIndex(
        (p) => p.includes("FEEDBACK.md") && !p.includes("PRIOR"),
      )
      expect(priorIndex, check).toBeGreaterThanOrEqual(0)
      expect(feedbackIndex, check).toBeGreaterThanOrEqual(0)
      // PRIOR_FEEDBACK.md rows come first — first-match-wins, so a round
      // with a prior committed FEEDBACK.md takes the judge row even though
      // FEEDBACK.md itself also changed this round.
      expect(priorIndex, check).toBeLessThan(feedbackIndex)
      const judgeTarget = definition.states[check]!.on!.find(([p]) => p.includes("PRIOR"))![1]
      const bypassTarget = definition.states[check]!.on!.find(
        ([p]) => p.includes("FEEDBACK.md") && !p.includes("PRIOR"),
      )![1]
      expect(judgeTarget, check).toBe(`${check.replace(/\.check$/, "")}.judge`)
      expect(bypassTarget, check).not.toBe(judgeTarget)
    }
  })

  it("healthGate.check's PRIOR_FEEDBACK.md episode-anchor grep pattern is built from TRANSITION_SEP, not a private copy of the literal (package 01, round-2 review item 10)", () => {
    // The rendered script greps `git log` subjects for `<TRANSITION_SEP><the
    // check state's own qualified name>` to bound its history walk to the
    // CURRENT episode (see the script's own comment in unified.yaml). That
    // grep pattern is only correct as long as it matches
    // `PatternMachine.ts`'s `stateSubject`, which is what actually WRITES a
    // commit's subject — a change to `TRANSITION_SEP` with no matching YAML
    // edit would silently stop the judge state from ever being reached
    // (PRIOR_FEEDBACK.md's history walk would never find its anchor), with
    // every OTHER test in this suite still green.
    const { definition } = compileTemplate()
    for (const check of ["build.health.check", "packages.item.health.check"]) {
      const script = definition.states[check]!.script!
      expect(script, check).toContain(`grep -F -- '${TRANSITION_SEP}<%= it.state %>'`)
    }
  })

  it("build.health.judge/packages.item.health.judge declare judge:/routes: — identical escalates, the catch-all matches the coder's own $onRed fix state (package 01, task 7)", () => {
    const { definition } = compileTemplate()
    const cases: Array<[judgeState: string, escalate: string, fix: string]> = [
      ["build.health.judge", "build.health.escalate", "build.fix"],
      ["packages.item.health.judge", "packages.item.health.escalate", "packages.item.fix-suite"],
    ]
    for (const [judgeState, escalate, fix] of cases) {
      const state = definition.states[judgeState]!
      expect(state.judge, judgeState).toBeDefined()
      expect(state.message, judgeState).toBeDefined()
      const routes = state.routes!
      expect(routes, judgeState).toBeDefined()
      expect(routes[routes.length - 1]).toEqual({ to: fix })
      const identicalRow = routes.find((r) => r.is === "identical")!
      expect(identicalRow, judgeState).toBeDefined()
      expect(identicalRow.to).toBe(escalate)
      // The "skipped judgment" fallback: an ordinary clean-tree row to the
      // SAME conservative target the catch-all route also names.
      expect((state.on ?? []).find(([p]) => p === "C")?.[1], judgeState).toBe(fix)
      // Round 4's own finding: the human fallback must not stall on a DIRTY
      // tree either — a human standing at this gate who touches one file
      // (not necessarily running `gtd judge answer`) still lands, at the
      // same conservative target, rather than refusing with "no-match".
      expect((state.on ?? []).find(([p]) => p === "* **")?.[1], judgeState).toBe(fix)
      const dirtyStep = step(definition, judgeState, "judge", {
        changes: [{ status: "M", path: "src/a.ts" }],
        processTrace: [],
      })
      expect(dirtyStep, judgeState).toMatchObject({ kind: "commit", to: fix })
    }
  })

  it("build.health.escalate/packages.item.health.escalate are round-counting check gates — a fresh escalation routes to describe, a second round to the terminal exhausted stop (package 01, task 1/4)", () => {
    const { definition } = compileTemplate()
    for (const escalate of ["build.health.escalate", "packages.item.health.escalate"]) {
      const state = definition.states[escalate]!
      expect(state.actor, escalate).toBe("check")
      expect(state.script, escalate).toBeDefined()
      expect(state.message, escalate).toBeUndefined()
      expect(state.prompt, escalate).toBeUndefined()
      const onEdges = state.on ?? []
      const addRow = onEdges.find(([p]) => p === "A .gtd/ESCALATION.md")
      const modRow = onEdges.find(([p]) => p === "M .gtd/ESCALATION.md")
      const cleanRow = onEdges.find(([p]) => p === "C")
      const describeTarget = escalate.replace(/\.escalate$/, ".describe")
      const exhaustedTarget = escalate.replace(/\.escalate$/, ".exhausted")
      expect(addRow?.[1], escalate).toBe(exhaustedTarget)
      expect(modRow?.[1], escalate).toBe(exhaustedTarget)
      expect(cleanRow?.[1], escalate).toBe(describeTarget)
    }
    // The comment explaining why `retry:` can't express the round cap sits
    // right above the state, in the source (state.script only captures the
    // shell heredoc, not the surrounding YAML comment).
    expect(unifiedYaml).toMatch(/episodeVisits/)
  })

  it("build.health.describe/packages.item.health.describe write .gtd/ESCALATION.md from FEEDBACK.md/PRIOR_FEEDBACK.md/the touched code, and every clean/dirty outcome rests at stop (package 01, task 2/4)", () => {
    const { definition } = compileTemplate()
    for (const describe of ["build.health.describe", "packages.item.health.describe"]) {
      const state = definition.states[describe]!
      expect(state.actor, describe).toBe("agent")
      expect(state.prompt, describe).toBeDefined()
      expect(state.file, describe).toBe(".gtd/FEEDBACK.md")
      expect(state.prompt, describe).toContain(".gtd/FEEDBACK.md")
      expect(state.prompt, describe).toContain(".gtd/PRIOR_FEEDBACK.md")
      expect(state.prompt, describe).toContain(".gtd/ESCALATION.md")
      // Tolerates a missing PRIOR_FEEDBACK.md (the retry-cap path's first
      // round has no prior round to compare).
      expect(state.prompt, describe).toMatch(/when present/)
      const stopTarget = describe.replace(/\.describe$/, ".stop")
      const onEdges = state.on ?? []
      for (const pattern of ["A .gtd/ESCALATION.md", "M .gtd/ESCALATION.md", "C", "* **"]) {
        expect(onEdges.find(([p]) => p === pattern)?.[1], `${describe} "${pattern}"`).toBe(
          stopTarget,
        )
      }
    }
  })

  it("build.health.stop/build.health.exhausted (and the packages.item.health equivalents) are human gates on ESCALATION.md that release straight into the caller's own $onRed fix state, never back through check, and land untouched (a 'C' row) advances too (package 01, task 2/4)", () => {
    const { definition } = compileTemplate()
    const cases: Array<[stop: string, exhausted: string, fix: string]> = [
      ["build.health.stop", "build.health.exhausted", "build.fix"],
      ["packages.item.health.stop", "packages.item.health.exhausted", "packages.item.fix-suite"],
    ]
    for (const [stop, exhausted, fix] of cases) {
      for (const name of [stop, exhausted]) {
        const state = definition.states[name]!
        expect(state.actor, name).toBe("human")
        expect(state.file, name).toBe(".gtd/ESCALATION.md")
        expect(state.message, name).toBeDefined()
        const onEdges = state.on ?? []
        expect(onEdges.find(([p]) => p === "* **")?.[1], name).toBe(fix)
        // Landing untouched must still hand the document to the next fix
        // turn (both messages promise this) — a bare "* **" row never
        // matches a clean tree, so a "C" row is the only way a clean land
        // advances instead of no-opping.
        expect(onEdges.find(([p]) => p === "C")?.[1], name).toBe(fix)
      }
      expect(definition.states[exhausted]!.message).toContain(".gtd/ESCALATION.md")
      expect(definition.states[exhausted]!.message).toContain(".gtd/FEEDBACK.md")
    }
  })

  it("build.health.escalate/packages.item.health.escalate count rounds by describe's own transition subject, not every commit touching ESCALATION.md — so the human's own edit at stop (which lands as an M .gtd/ESCALATION.md commit too) never spends the round budget (package 01, spec-feedback)", () => {
    const { definition } = compileTemplate()
    for (const escalate of ["build.health.escalate", "packages.item.health.escalate"]) {
      const state = definition.states[escalate]!
      // The script must key its round count off `describe` as the commit
      // subject's FROM state (derived from `it.state`, the currently-
      // instantiated `escalate`'s own fully-qualified name), not a bare
      // --diff-filter=AM history of the file — that history also contains
      // the human's edit at `stop`.
      expect(state.script, escalate).toContain('it.state.replace(/\\.escalate$/, ".describe")')
      // The round COUNT is taken with no `-- .gtd/ESCALATION.md` pathspec —
      // a `describe` turn's own landing commit exists every round even when
      // its write is byte-identical to what's already on disk (a `prompt`
      // state's clean step is an attempt, not a no-op), and a pathspec would
      // silently drop that commit from the count.
      expect(state.script, escalate).toMatch(
        /rounds=\$\(git log --format='%s' "\$anchor"\.\.HEAD 2>\/dev\/null \| grep -c -F -- "\$describe_source →"\)/,
      )
      // The RESTORE lookup (only reached when the file is missing) is still
      // pathspec-scoped to ESCALATION.md, since it needs the commit that
      // actually wrote it.
      expect(state.script, escalate).toContain(
        "-- .gtd/ESCALATION.md 2>/dev/null \\\n      | grep -F",
      )
    }
  })

  it("build.health.escalate/packages.item.health.escalate never overwrite a file already on disk at round >= 2 — restoring from history only when ESCALATION.md is missing, so a human's edit at the terminal exhausted stop survives the next arrival (package 01, spec-feedback)", () => {
    const { definition } = compileTemplate()
    for (const escalate of ["build.health.escalate", "packages.item.health.escalate"]) {
      const state = definition.states[escalate]!
      expect(state.script, escalate).toContain("if [ ! -f .gtd/ESCALATION.md ]; then")
    }
  })

  it("architecture-pre judges architectureWarranted over .gtd/REQUIREMENTS.md ONLY — never the bare .gtd/TODO.md — and routes a confident 'no' to architecture-promote, everything else to the full architecture pass (04)", () => {
    const { definition } = compileTemplate()
    const state = definition.states["architecture-pre"]!
    expect(state.judge).toBeDefined()
    expect(state.judge).toContain(".gtd/REQUIREMENTS.md")
    expect(state.judge).not.toContain("TODO.md")
    expect(state.message).toBeDefined()

    const routes = state.routes!
    expect(routes[routes.length - 1]).toEqual({ to: "architecture.author" })
    const noRow = routes.find((r) => r.is === "no")!
    expect(noRow.question).toBe("architectureWarranted")
    expect(noRow.to).toBe("architecture-promote")

    // Skipped judgment (no verdict piped): the conservative default runs the
    // full pass, whether the tree is clean or the human touched a file.
    expect((state.on ?? []).find(([p]) => p === "C")?.[1]).toBe("architecture.author")
    expect((state.on ?? []).find(([p]) => p === "* **")?.[1]).toBe("architecture.author")

    // A "yes" verdict never matches the "no" row regardless of `minP`
    // (unrendered `<%~ it.vars... %>` text at this compiled-but-unrendered
    // layer — the real numeric threshold is exercised end to end by the
    // process-level e2e scenario, not here), so it's the one case this
    // unit-level `step()` can assert without rendering `routes:` first.
    const warranted = step(definition, "architecture-pre", "judge", {
      changes: [],
      processTrace: [],
      routeAnswers: [{ id: "architectureWarranted", answer: "yes", p: 0.99 }],
    })
    expect(warranted).toMatchObject({ kind: "commit", to: "architecture.author" })
  })

  it("architecture-promote writes exactly one .gtd/packages/ file — never leaves the queue empty on the skip path (04)", () => {
    const { definition } = compileTemplate()
    const state = definition.states["architecture-promote"]!
    expect(state.script).toContain(".gtd/packages/")
    expect(state.script).toContain(".gtd/REQUIREMENTS.md")
    expect((state.on ?? []).find(([p]) => p === "* **")?.[1]).toBe("packages.picking")
  })

  it("three attempts still force escalation regardless of verdict — the retry cap on $onRed (fix/fix-suite) overrides a non-identical routes: verdict (package 01, task 7)", () => {
    const { definition } = compileTemplate()
    // packages.item: round 1 bypasses judge straight to fix-suite (1st visit);
    // round 2 goes through judge with a "progress" verdict, routing to
    // fix-suite again (2nd visit, meeting its own max: 3 only after a 3rd).
    // Simulate a trace where fix-suite has already been entered 3 times, so a
    // 4th "progress" verdict must still redirect to escalate.
    const trace = [
      "packages.item.health.check",
      "packages.item.fix-suite",
      "packages.item.health.check",
      "packages.item.health.judge",
      "packages.item.fix-suite",
      "packages.item.health.check",
      "packages.item.health.judge",
      "packages.item.fix-suite",
      "packages.item.health.check",
      "packages.item.health.judge",
    ]
    const decision = step(definition, "packages.item.health.judge", "judge", {
      changes: [],
      processTrace: trace,
      routeAnswers: [{ id: "verdict", answer: "progress", p: 0.9 }],
    })
    expect(decision).toMatchObject({
      kind: "commit",
      to: "packages.item.health.escalate",
    })
  })

  it("packages.item.closing's C row advances to packages.picking on an already-clean tree (package 03) — nothing left to sweep still drains the queue instead of stalling", () => {
    const { definition } = compileTemplate()
    const decision = step(definition, "packages.item.closing", "check", {
      changes: [],
      processTrace: [],
    })
    expect(decision).toMatchObject({
      kind: "commit",
      from: "packages.item.closing",
      to: "packages.picking",
    })
  })

  it("unwind and build.review.deciding each route their clean tree — the ambiguity is resolved in the script, not left as a silent no-op (package 03)", () => {
    // unwind: the script writes FEEDBACK.md when `git revert` exits
    // non-zero, so a clean tree here can only mean the revert succeeded and
    // changed nothing — safe to advance.
    // deciding: the script writes FEEDBACK.md when REVIEW.md is absent, so
    // the clean case is unreachable; it still routes to the human gate
    // rather than nowhere, because a clean tree must never auto-approve an
    // unreviewed round.
    const { definition } = compileTemplate()
    const clean = (name: string) =>
      step(definition, name, definition.states[name]!.actor!, {
        changes: [],
        processTrace: [],
      })
    expect(clean("unwind")).toMatchObject({ kind: "commit", to: "start-gate.check" })
    expect(clean("build.review.deciding")).toMatchObject({
      kind: "commit",
      to: "build.review.review-missing",
    })
  })

  it("every script-content state is POSIX sh, not bash — the driver runs it via `sh -c`", () => {
    // The shebang is inert (the driver runs the script via whatever shell it
    // invokes) but still documents the syntax the body may use. Iterate every
    // script-content state generically so a future one that reintroduces a
    // bashism fails here automatically.
    const { definition } = compileTemplate()
    const scriptStates = Object.entries(definition.states).filter(
      (entry): entry is [string, { script: string }] => entry[1].script !== undefined,
    )
    expect(scriptStates.length).toBeGreaterThan(0)
    const bashisms = [
      /\blocal\s+\w/, // `local` declarations (not POSIX sh)
      /\$'/, // ANSI-C quoting
      /<\(|>\(/, // process substitution
      /<<</, // herestrings
      /(^|\s)\[\[\s/m, // bash `[[ ... ]]` test syntax (not a sed/regex bracket class)
      /\$RANDOM\b/,
    ]
    for (const [name, state] of scriptStates) {
      expect(state.script.startsWith("#!/usr/bin/env sh\n"), `state "${name}"`).toBe(true)
      for (const pattern of bashisms) {
        expect(state.script, `state "${name}" matches ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  const PERSONA_MACHINES = [
    { machine: "designPlan", states: ["design.triage"], personaVar: "designPersona" },
    {
      machine: "archPlan",
      states: ["architecture.author", "architecture.decompose"],
      personaVar: "architectPersona",
    },
    {
      machine: "humanReview",
      states: ["build.review.reviewing", "build.review.collecting"],
      personaVar: "reviewerPersona",
    },
    {
      machine: "specReview",
      states: ["packages.item.spec.review"],
      personaVar: "specReviewerPersona",
    },
    {
      machine: "packageItem",
      states: ["packages.item.building", "packages.item.fix-suite", "packages.item.fix-spec"],
      personaVar: "builderPersona",
    },
    {
      machine: "buildTail",
      states: ["build.fix"],
      personaVar: "finisherPersona",
    },
    {
      machine: "healthGate",
      states: ["build.health.describe", "packages.item.health.describe"],
      personaVar: "escalationPersona",
    },
  ]

  it("no machine's `system:` value is a file reference (package 04)", () => {
    const { definition } = compileTemplate()
    const systemStates = Object.entries(definition.states).filter(([, s]) => Boolean(s.system))
    expect(systemStates.length).toBeGreaterThan(0)
    for (const [name, state] of systemStates) {
      expect(state.system, `state "${name}"`).not.toMatch(/^\.\.?\//)
    }
  })

  it("declares the seven persona variables in vars:, each non-empty (package 04)", () => {
    const { vars } = compileTemplate()
    for (const { personaVar } of PERSONA_MACHINES) {
      expect(vars[personaVar], personaVar).toBeTruthy()
    }
  })

  it("every persona-carrying machine's `system:` uses the raw (unescaped) tag form, referencing a *Persona var (package 04)", () => {
    const { definition } = compileTemplate()
    for (const { states } of PERSONA_MACHINES) {
      for (const name of states) {
        expect(definition.states[name]?.system, `state "${name}"`).toMatch(
          /<%~\s*it\.vars\.\w+Persona\s*%>/,
        )
      }
    }
  })

  it("the machine -> persona-variable table holds by name and count, so an eighth persona site added later fails loudly (package 04)", () => {
    const { definition } = compileTemplate()
    const systemBearing = Object.entries(definition.states)
      .filter(([, s]) => s.prompt !== undefined && Boolean(s.system))
      .map(([name]) => name)
      .sort()
    const expectedStates = PERSONA_MACHINES.flatMap((m) => m.states).sort()
    expect(systemBearing).toEqual(expectedStates)

    const referencedVars = new Set(
      Object.values(definition.states)
        .map((s) => s.system?.match(/it\.vars\.(\w+Persona)\b/)?.[1])
        .filter((v): v is string => v !== undefined),
    )
    expect([...referencedVars].sort()).toEqual(PERSONA_MACHINES.map((m) => m.personaVar).sort())
  })

  it("every persona-carrying machine also declares `model:`, and its persona states carry `prompt` content (package 04)", () => {
    const { definition } = compileTemplate()
    for (const { states } of PERSONA_MACHINES) {
      for (const name of states) {
        const state = definition.states[name]
        expect(state?.model, `state "${name}"`).toBeTruthy()
        expect(state?.prompt, `state "${name}"`).toBeTruthy()
      }
    }
  })

  const SKILLS_STATES = [
    { state: "design.triage", skillsVar: "triageSkills" },
    { state: "architecture.author", skillsVar: "architectureSkills" },
    { state: "architecture.decompose", skillsVar: "decomposeSkills" },
    { state: "packages.item.building", skillsVar: "buildSkills" },
    { state: "packages.item.fix-suite", skillsVar: "fixSkills" },
    { state: "build.fix", skillsVar: "fixSkills" },
    { state: "packages.item.fix-spec", skillsVar: "reviewFixSkills" },
    { state: "build.review.reviewing", skillsVar: "reviewSkills" },
    { state: "packages.item.spec.review", skillsVar: "specReviewSkills" },
    { state: "build.health.describe", skillsVar: "escalateSkills" },
    { state: "packages.item.health.describe", skillsVar: "escalateSkills" },
  ]

  it("declares `skills:` on exactly the eleven compiled states the mapping table names, and nowhere else — build.review.collecting included (package 02)", () => {
    const { definition } = compileTemplate()
    const withSkills = Object.entries(definition.states)
      .filter(([, s]) => s.skills !== undefined)
      .map(([name]) => name)
      .sort()
    expect(withSkills).toEqual(SKILLS_STATES.map((s) => s.state).sort())
    expect(definition.states["build.review.collecting"]?.skills).toBeUndefined()
  })

  // Task 4's guard: a trim overreaching into a state's own file name, finish
  // condition, or routing contract stalls a process weeks later, never as a
  // red test on its own — these per-state assertions are the one mechanical
  // check standing in for that.
  const SKILLS_STATE_CONTRACT: Record<string, { fileNeedle: string; finishNeedle: string }> = {
    "design.triage": { fileNeedle: ".gtd/REQUIREMENTS.md", finishNeedle: "uncommitted and finish" },
    "architecture.author": {
      fileNeedle: ".gtd/ARCHITECTURE.md",
      finishNeedle: "uncommitted and finish",
    },
    "architecture.decompose": {
      fileNeedle: ".gtd/packages/",
      finishNeedle: "uncommitted and finish",
    },
    "packages.item.building": { fileNeedle: ".gtd/SATISFIED.md", finishNeedle: "finish your turn" },
    "packages.item.fix-suite": { fileNeedle: ".gtd/FEEDBACK.md", finishNeedle: "finish your turn" },
    "build.fix": { fileNeedle: ".gtd/FEEDBACK.md", finishNeedle: "do not commit" },
    "packages.item.fix-spec": {
      fileNeedle: ".gtd/SPEC_FEEDBACK.md",
      finishNeedle: "finish your turn",
    },
    "build.review.reviewing": {
      fileNeedle: ".gtd/REVIEW.md",
      finishNeedle: "uncommitted and finish",
    },
    "packages.item.spec.review": {
      fileNeedle: ".gtd/SPEC_FEEDBACK.md",
      finishNeedle: "a later step owns that",
    },
    "build.health.describe": {
      fileNeedle: ".gtd/ESCALATION.md",
      finishNeedle: "only writes the document",
    },
    "packages.item.health.describe": {
      fileNeedle: ".gtd/ESCALATION.md",
      finishNeedle: "only writes the document",
    },
  }

  it("each of the eleven skills-bearing states still names its own steering file and its own finish condition after the trim (package 02, task 4)", () => {
    const { definition } = compileTemplate()
    // `statesReferencing` alone misses `packages.item.fix-suite`/`build.fix`:
    // their prompt text reaches `.gtd/FEEDBACK.md` only through the shared
    // `fixFeedbackPrompt` var tag, not a literal in the raw (unrendered)
    // prompt `statesReferencing` scans — so the needle is checked against
    // the RENDERED prompt here instead, covering every state uniformly.
    const { vars } = compileTemplate()
    const context = { ...varsOnlyContext(vars), read: () => "stub file content" }
    for (const { state } of SKILLS_STATES) {
      const { fileNeedle, finishNeedle } = SKILLS_STATE_CONTRACT[state]!
      const rendered = renderStateTemplate(definition.states[state]!.prompt!, context)
      expect(rendered, `state "${state}" file`).toContain(fileNeedle)
      expect(rendered, `state "${state}" finish`).toContain(finishNeedle)
    }
  })

  // Three of the eleven branch their `on:` on a specific `.gtd/*.md` path
  // (write-vs-don't-write decides the route) rather than falling through a
  // single unconditional edge — those three are where an overreaching trim
  // could delete the very instruction the routing depends on.
  const BRANCHING_STATES = [
    "packages.item.building",
    "packages.item.spec.review",
    "build.health.describe",
    "packages.item.health.describe",
  ]

  it("every branching state's `on:` routing still names, in its own prompt, each `.gtd/*.md` path its routing keys off (package 02, task 4)", () => {
    const { definition } = compileTemplate()
    for (const state of BRANCHING_STATES) {
      const prompt = definition.states[state]!.prompt!
      const edges = definition.states[state]!.on ?? []
      const routedPaths = new Set(
        edges.flatMap(([pattern]) => pattern.match(/\.gtd\/[A-Za-z_]+\.md/g) ?? []),
      )
      expect(routedPaths.size, `state "${state}" has at least one routed path`).toBeGreaterThan(0)
      for (const path of routedPaths) {
        expect(prompt, `state "${state}" names ${path}`).toContain(path)
      }
    }
  })

  it("declares each of the nine `*Skills` vars, non-blank (package 02)", () => {
    const { vars } = compileTemplate()
    const skillsVars = [...new Set(SKILLS_STATES.map((s) => s.skillsVar))]
    expect(skillsVars).toHaveLength(9)
    for (const name of skillsVars) {
      expect(vars[name], name).toBeTruthy()
    }
  })

  it("each skills-bearing state's `skills:` references its own mapping-table var, and renders that var's actual skill names (package 02)", () => {
    const { definition, vars } = compileTemplate()
    const context = { ...varsOnlyContext(vars), read: () => "stub file content" }
    for (const { state, skillsVar } of SKILLS_STATES) {
      const raw = definition.states[state]?.skills
      expect(raw, `state "${state}"`).toMatch(new RegExp(`it\\.vars\\.${skillsVar}\\b`))
      const rendered = renderStateTemplate(raw!, context)
      expect(rendered, `state "${state}"`).toBe(vars[skillsVar])
    }
  })

  it("declares the `skillsPreamble` var, non-blank, reading `it.skills` (package 02)", () => {
    const { vars } = compileTemplate()
    expect(vars.skillsPreamble).toBeTruthy()
    expect(vars.skillsPreamble).toMatch(/it\.skills\b/)
  })

  it("skillsPreamble's three clauses are each present by a distinct phrase (package 02)", () => {
    const { vars } = compileTemplate()
    const preamble = vars.skillsPreamble!
    // Clause 1: load only what your harness has, skip the rest silently.
    expect(preamble).toMatch(/skip\s+anything it doesn't\s*—\s*silently/i)
    // Clause 2: this state's own format/completion outranks a skill, worded
    // to stand on its own — not "the following", not positional.
    expect(preamble).toMatch(
      /this state's own file\s+format and its own completion condition are the final word/i,
    )
    // Clause 3: never turn the turn interactive.
    expect(preamble).toMatch(/never let a loaded skill turn this turn interactive/i)
  })

  // Pinned by stable keyword, never a whole sentence, so a later reword
  // doesn't red this suite for no reason.

  it("design.triage no longer states the vertical-slicing/distinct-acceptance technique — triageSkills (planning-and-task-breakdown) covers it now (package 02)", () => {
    const { definition } = compileTemplate()
    const prompt = definition.states["design.triage"]!.prompt!

    expect(prompt).not.toMatch(/vertical/i)
    expect(prompt).not.toMatch(/never by layer/i)
    expect(prompt).not.toMatch(/scaffolding/i)
    expect(prompt).not.toMatch(/fails\s+before it and passes after/i)
    expect(prompt).not.toMatch(/merge it into\s+its neighbour/i)
  })

  it("architecture.author states the footprint/merge rule under a dedicated `## Merged Concerns` heading, merge only, never split (package 01)", () => {
    const { definition } = compileTemplate()
    const prompt = definition.states["architecture.author"]!.prompt!

    expect(prompt).toMatch(/file footprint/i)
    expect(prompt).toMatch(/## Merged Concerns/)
    expect(prompt).toMatch(/merge only, never to split/i)
    expect(prompt).toMatch(/carrying both merged requirements\s+verbatim/i)
    expect(prompt).toMatch(/raises no open question and stops for no\s+human/i)
    expect(prompt).toMatch(/do not route it to `architecture\.gate` for a veto/i)
  })

  it("the fewer-larger-packages bias survives in architecture.author, but not in design.triage — triageSkills (planning-and-task-breakdown) covers package sizing there now (package 01, 02)", () => {
    const { definition } = compileTemplate()
    const normalize = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase()
    const triagePrompt = normalize(definition.states["design.triage"]!.prompt!)
    const authorPrompt = normalize(definition.states["architecture.author"]!.prompt!)

    const bias =
      "prefer fewer, larger packages — the smallest independently valuable change, not the smallest change that compiles"
    expect(triagePrompt).not.toContain(bias)
    expect(authorPrompt).toContain(bias)
  })

  it("neither the vertical/distinct-acceptance prose nor the footprint/merge prose states a package count as a digit (package 01, 02)", () => {
    const { definition } = compileTemplate()

    // Slice out just the new prose, bounded by the `## ` lap headings a
    // reword cannot move — both prompts carry unrelated digits elsewhere.
    const triagePrompt = definition.states["design.triage"]!.prompt!
    const triageStart = triagePrompt.indexOf("## First lap")
    const triageEnd = triagePrompt.indexOf("## Return lap")
    expect(triageStart).toBeGreaterThan(-1)
    expect(triageEnd).toBeGreaterThan(triageStart)
    const triageSlice = triagePrompt.slice(triageStart, triageEnd)
    expect(triageSlice).not.toMatch(/[0-9]/)

    const authorPrompt = definition.states["architecture.author"]!.prompt!
    const authorStart = authorPrompt.indexOf("## First lap")
    const authorEnd = authorPrompt.indexOf("## Return lap")
    expect(authorStart).toBeGreaterThan(-1)
    expect(authorEnd).toBeGreaterThan(authorStart)
    const authorSlice = authorPrompt.slice(authorStart, authorEnd)
    expect(authorSlice).not.toMatch(/[0-9]/)
  })

  it("both planner prompts carry their three/two lap headers (package 02)", () => {
    const { definition } = compileTemplate()
    const triagePrompt = definition.states["design.triage"]!.prompt!
    expect(triagePrompt).toMatch(/## First lap/)
    expect(triagePrompt).toMatch(/## Return lap/)
    expect(triagePrompt).toMatch(/## Review loop-back/)
    // Order matters: first, then return, then review loop-back.
    const firstIdx = triagePrompt.indexOf("## First lap")
    const returnIdx = triagePrompt.indexOf("## Return lap")
    const loopBackIdx = triagePrompt.indexOf("## Review loop-back")
    expect(firstIdx).toBeLessThan(returnIdx)
    expect(returnIdx).toBeLessThan(loopBackIdx)
    // The old numbered steps are gone — renumbered as sub-headings instead.
    expect(triagePrompt).not.toMatch(/^\s*\d+\.\s/m)

    const authorPrompt = definition.states["architecture.author"]!.prompt!
    expect(authorPrompt).toMatch(/## First lap/)
    expect(authorPrompt).toMatch(/## Return lap/)
    expect(authorPrompt.indexOf("## First lap")).toBeLessThan(authorPrompt.indexOf("## Return lap"))
  })

  it("build.review.reviewing pins the review-document contract: the header/marker shape and the exactly-two-space continuation rule (package 01)", () => {
    const { definition } = compileTemplate()
    const prompt = definition.states["build.review.reviewing"]!.prompt!

    expect(prompt).toMatch(/First non-blank line:\s*`# Review: /)
    expect(prompt).toMatch(/<!-- base: /)
    expect(prompt).toMatch(/indented exactly two spaces/i)
    expect(prompt).toMatch(/never four or\s+more/i)
    expect(prompt).toMatch(/never start\s+with a bare `\.\/path` token/i)
  })

  // Package 01 (shared prompt vars): a misspelt `it.vars.<name>` tag or a
  // blanked override renders the literal string `undefined` into an agent's
  // prompt — silently, with no throw and no warning (Eta just stringifies
  // the missing lookup). Rendering every prompt/system value against the
  // bundled `vars:` defaults is the only automated defence against that.
  it("renders every prompt/system value against the bundled vars defaults with no leaked `undefined` (package 01)", () => {
    const { definition, vars } = compileTemplate()
    const context = { ...varsOnlyContext(vars), read: () => "stub file content" }
    for (const [name, state] of Object.entries(definition.states)) {
      const fields = { script: state.script, prompt: state.prompt, message: state.message }
      for (const [field, content] of Object.entries(fields)) {
        if (content === undefined) continue
        const rendered = renderStateTemplate(content, context)
        expect(rendered, `state "${name}" field "${field}"`).not.toMatch(/undefined/)
      }
    }
    for (const [machineName, machine] of Object.entries(
      parseYaml(unifiedYaml).machines as Record<string, { system?: string }>,
    )) {
      if (machine.system === undefined) continue
      const rendered = renderStateTemplate(machine.system, context)
      expect(rendered, `machine "${machineName}" system`).not.toMatch(/undefined/)
    }
  })

  it("a misspelt `it.vars` tag renders the literal `undefined` — proving the assertion above would catch one (package 01)", () => {
    const { vars } = compileTemplate()
    const context = { ...varsOnlyContext(vars), read: () => "stub file content" }
    expect(renderStateTemplate("A <%~ it.vars.thisNameDoesNotExist %> B", context)).toBe(
      "A undefined B",
    )
  })

  it("a checkbox-few-shot pin on questionBar, the shared open-questions block (package 01)", () => {
    const { vars } = compileTemplate()
    expect(vars.questionBar).toMatch(/- \[ ] <first option.*rationale>/)
    expect(vars.questionBar).toMatch(/- \[ ] <second option>/)
    expect(vars.questionBar).toMatch(/- \[ ] _your answer_/)
  })

  it("questionBar and questionBarReturn pin the Open/Answered Questions positional rule — structurally, not by literal phrasing (package 01)", () => {
    const { vars } = compileTemplate()
    // Structural pin: Open Questions is stated as coming FIRST among `##`
    // sections, Answered Questions as coming LAST — the surviving concept
    // `gtd check qa` enforces, not a specific sentence.
    expect(vars.questionBar).toMatch(/Open Questions[\s\S]{0,200}(first|before every other)/i)
    expect(vars.questionBar).toMatch(/Answered Questions[\s\S]{0,200}(last|after every other)/i)
    expect(vars.questionBarReturn).toMatch(
      /Answered Questions[\s\S]{0,200}(last|after every other)/i,
    )
  })

  it("questionBar sweeps the whole batch before writing, and sharpens the bar's third condition (package 01)", () => {
    const { vars } = compileTemplate()
    expect(vars.questionBar).toMatch(/walk every concern/i)
    expect(vars.questionBar).toMatch(/collect every point above the bar/i)
    expect(vars.questionBar).toMatch(/held back for a later lap is a bug/i)
    expect(vars.questionBar).toMatch(/expensive to undo once\s+packages are written/i)
    expect(vars.questionBar).not.toMatch(/survive to the human review tail/i)
    expect(vars.questionBarReturn).not.toMatch(/survive to the human review tail/i)
  })

  it("questionBarReturn licenses a fresh follow-up fork and states the silence stop (package 01)", () => {
    const { vars } = compileTemplate()
    // Fresh-fork licence, scoped to a fork the answer itself created.
    expect(vars.questionBarReturn).toMatch(/fresh.*Open Questions.*entry/is)
    expect(vars.questionBarReturn).toMatch(/never restate a question\s+already asked/i)
    expect(vars.questionBarReturn).toMatch(/re-open a question\s+already settled/i)
    // The silence stop: a lap with nothing changed ends the questions.
    expect(vars.questionBarReturn).toMatch(/nothing ticked and nothing else changed/i)
    expect(vars.questionBarReturn).toMatch(/ends the\s+questions/i)
    expect(vars.questionBarReturn).toMatch(/decide every remaining question/i)
    expect(vars.questionBarReturn).toMatch(/leave no.*Open Questions.*section behind/is)
    // The old "deleted section = acceptance" rule is retired.
    expect(vars.questionBarReturn).not.toMatch(/treat a deleted.*as acceptance/is)
  })

  it("questionBar states the goal — asking closes a gap in shared understanding — and outranks the three conditions (package 01)", () => {
    const { vars } = compileTemplate()
    expect(vars.questionBar).toMatch(
      /gap between what the human wants and\s+what the agent is about to build/i,
    )
    expect(vars.questionBar).not.toMatch(/all three hold/i)
  })

  it("questionBarReturn states the same goal as continuation of the first lap (package 01)", () => {
    const { vars } = compileTemplate()
    expect(vars.questionBarReturn).toMatch(/continues? the same goal/i)
    expect(vars.questionBarReturn).toMatch(
      /gap\s+between what the human wants and what gets built/i,
    )
  })

  it("design.triage and architecture.author both carry the second-pass wording (via the shared questionBar var) and each carries its OWN strictness sentence, never the other's (package 01)", () => {
    const { definition, vars } = compileTemplate()
    const triagePrompt = definition.states["design.triage"]!.prompt!
    const authorPrompt = definition.states["architecture.author"]!.prompt!

    // Both sites inject the shared questionBar tag, which carries the
    // second-pass wording — pinned on the var itself, since the raw prompt
    // text holds only the uninterpolated `<%~ it.vars.questionBar %>` tag.
    expect(triagePrompt).toContain("<%~ it.vars.questionBar %>")
    expect(authorPrompt).toContain("<%~ it.vars.questionBar %>")
    expect(vars.questionBar).toMatch(/raise first,?\s*narrow second/i)
    expect(vars.questionBar).toMatch(/never\s+license to raise less/i)
    expect(vars.questionBar).toMatch(/skipping the\s+raise.*same bug/is)

    expect(triagePrompt).toMatch(
      /STRICT:\s+answer it yourself only\s+when the product default is unmistakable/is,
    )
    expect(triagePrompt).not.toMatch(/PERMISSIVE/)
    expect(authorPrompt).toMatch(
      /PERMISSIVE:\s+answer it\s+yourself unless you genuinely cannot defend a default/is,
    )
    expect(authorPrompt).not.toMatch(/STRICT/)
  })

  it("design.gate and architecture.gate messages each name what the gate is for, in that site's own voice (package 01)", () => {
    const { definition } = compileTemplate()
    expect(definition.states["design.gate.answer"]?.message).toMatch(
      /closes? a gap between what you want the product to\s+do and what gets built/i,
    )
    expect(definition.states["architecture.gate.answer"]?.message).toMatch(
      /closes? a gap between what you want built and how\s+it actually gets built/i,
    )
    for (const name of ["design.gate.answer", "architecture.gate.answer"]) {
      expect(definition.states[name]?.message, `state "${name}"`).toMatch(/closes? a gap between/i)
    }
  })

  // `footnoteRules` (how a human types one) wires into exactly these three
  // human-gate messages; `footnoteFoldIn` (fold-in/delete/human-only rules)
  // wires into exactly these three agent prompts. Table-driven by name AND
  // count so a seventh injection site added later fails loudly (package 02).
  const FOOTNOTE_RULES_STATES = [
    "design.gate.answer",
    "architecture.gate.answer",
    "build.review.await-review",
  ]
  const FOOTNOTE_FOLD_IN_STATES = [
    "design.triage",
    "architecture.author",
    "build.review.collecting",
  ]

  it("declares footnoteRules and footnoteFoldIn, each non-empty (package 02)", () => {
    const { vars } = compileTemplate()
    expect(vars.footnoteRules).toBeTruthy()
    expect(vars.footnoteFoldIn).toBeTruthy()
  })

  it("wires footnoteRules into exactly the three human-gate messages named above and nowhere else (package 02)", () => {
    const { definition } = compileTemplate()
    expect(statesReferencing(definition, "footnoteRules")).toEqual(
      [...FOOTNOTE_RULES_STATES].sort(),
    )
  })

  it("wires footnoteFoldIn into exactly the three agent prompts named above and nowhere else (package 02)", () => {
    const { definition } = compileTemplate()
    expect(statesReferencing(definition, "footnoteFoldIn")).toEqual(
      [...FOOTNOTE_FOLD_IN_STATES].sort(),
    )
  })

  it("every footnote injection site uses the raw (unescaped) tag form, matching the existing voice-variable wiring (package 02)", () => {
    const { definition } = compileTemplate()
    for (const name of FOOTNOTE_RULES_STATES) {
      expect(definition.states[name]?.message, `state "${name}"`).toMatch(
        /<%~\s*it\.vars\.footnoteRules\s*%>/,
      )
    }
    for (const name of FOOTNOTE_FOLD_IN_STATES) {
      expect(definition.states[name]?.prompt, `state "${name}"`).toMatch(
        /<%~\s*it\.vars\.footnoteFoldIn\s*%>/,
      )
    }
  })

  it("build.review.reviewing — the one state that WRITES a review file — references neither footnote tag (package 02)", () => {
    const { definition } = compileTemplate()
    const reviewing = definition.states["build.review.reviewing"]
    expect(reviewing?.prompt).not.toContain("footnoteRules")
    expect(reviewing?.prompt).not.toContain("footnoteFoldIn")
  })

  it("footnoteFoldIn structurally carries the human-input-only rule and the delete-in-the-same-turn rule, not just exact phrasing (package 02)", () => {
    const { vars } = compileTemplate()
    expect(vars.footnoteFoldIn).toMatch(/human input only|never write one yourself|never author/i)
    expect(vars.footnoteFoldIn).toMatch(/delete/i)
    expect(vars.footnoteFoldIn).toMatch(/same turn/i)
    expect(vars.footnoteFoldIn).toMatch(/anchor|hunk|paragraph/i)
    expect(vars.footnoteFoldIn).toMatch(/whole-file/i)
  })
})

describe("the bundled template's machine boundaries line up with conversational identity (package 08/02)", () => {
  // These invariants are about the RAW `machines:` source, not the compiled
  // (flattened) definition — the compiler stamps a machine-level `model:`
  // onto every one of its own `prompt` states, so a compiled state always
  // carries a `model` regardless of where it was declared. Only the raw
  // source can tell machine-level from state-level.
  const raw = parseYaml(unifiedYaml) as {
    readonly machines: Readonly<
      Record<
        string,
        {
          readonly model?: string
          readonly states: Readonly<Record<string, Readonly<Record<string, unknown>>>>
        }
      >
    >
  }

  /** A local is a REFERENCE iff its raw value carries a `machine` key — mirrors `src/Machines.ts`'s own `isRef`. */
  const isRef = (v: Record<string, unknown>): boolean => typeof v["machine"] === "string"

  /** Every one of `machineName`'s own (non-reference) local names whose raw value declares a `prompt` key — this machine's own `prompt`-content states, never a nested child's. */
  const ownPromptStates = (machineName: string): readonly string[] =>
    Object.entries(raw.machines[machineName]!.states)
      .filter(([, s]) => !isRef(s) && typeof s["prompt"] === "string")
      .map(([name]) => name)
      .sort()

  it("no state anywhere declares `model` directly — every model comes from its owning machine", () => {
    for (const [machineName, machine] of Object.entries(raw.machines)) {
      for (const [stateName, state] of Object.entries(machine.states)) {
        if (isRef(state)) continue
        expect(state, `machine "${machineName}" state "${stateName}"`).not.toHaveProperty("model")
      }
    }
  })

  it("no state anywhere declares `memory` — the key is computed from the machine tree, not authored", () => {
    for (const [machineName, machine] of Object.entries(raw.machines)) {
      for (const [stateName, state] of Object.entries(machine.states)) {
        if (isRef(state)) continue
        expect(state, `machine "${machineName}" state "${stateName}"`).not.toHaveProperty("memory")
      }
    }
  })

  it("every machine that contains a `prompt`-content state declares exactly one `model`", () => {
    for (const [machineName, machine] of Object.entries(raw.machines)) {
      if (ownPromptStates(machineName).length === 0) continue
      expect(typeof machine.model, `machine "${machineName}"`).toBe("string")
    }
  })

  it("the identity table holds: design/architecture/build/packages.item/packages.item.spec/build.review are each exactly one of {planner, coder}, matching the tree", () => {
    const { tree } = compileTemplate()
    // Instance path (e.g. "packages.item") -> the machine it instantiates.
    const machineAt: Record<string, string> = {}
    const walk = (node: MachineNode): void => {
      machineAt[node.key] = node.machine
      node.children.forEach(walk)
    }
    walk(tree!)

    const identityOf = (instancePath: string): "planner" | "coder" | undefined => {
      const model = raw.machines[machineAt[instancePath]!]?.model
      if (model === undefined) return undefined
      if (model.includes("plannerModel")) return "planner"
      if (model.includes("coderModel")) return "coder"
      throw new Error(`instance "${instancePath}": unrecognized model template "${model}"`)
    }

    expect(identityOf("design")).toBe("planner")
    expect(identityOf("architecture")).toBe("planner")
    expect(identityOf("build")).toBe("coder")
    expect(identityOf("packages.item")).toBe("coder")
    expect(identityOf("packages.item.spec")).toBe("planner")
    expect(identityOf("build.review")).toBe("planner")
  })

  it("packages, start-gate, review-gate, design.gate, and architecture.gate have no model — they are identity-free gate/queue machines", () => {
    const { tree } = compileTemplate()
    const machineAt: Record<string, string> = {}
    const walk = (node: MachineNode): void => {
      machineAt[node.key] = node.machine
      node.children.forEach(walk)
    }
    walk(tree!)

    for (const instancePath of [
      "packages",
      "start-gate",
      "review-gate",
      "design.gate",
      "architecture.gate",
    ]) {
      expect(raw.machines[machineAt[instancePath]!]?.model, instancePath).toBeUndefined()
    }
  })

  it("build.health/packages.item.health (healthGate) declare a model — the escalation `describe` turn is a real prompt state, in its own memory scope separate from the surrounding build/packages.item session (package 01)", () => {
    const { tree, scopes } = compileTemplate()
    const machineAt: Record<string, string> = {}
    const walk = (node: MachineNode): void => {
      machineAt[node.key] = node.machine
      node.children.forEach(walk)
    }
    walk(tree!)

    for (const instancePath of ["build.health", "packages.item.health"]) {
      expect(raw.machines[machineAt[instancePath]!]?.model, instancePath).toBeTruthy()
    }
    expect(scopes["build.health.describe"]).toBe("build.health")
    expect(scopes["build.health.describe"]).not.toBe(scopes["build.fix"])
    expect(scopes["packages.item.health.describe"]).toBe("packages.item.health")
  })

  it("`build.review` is nested inside `build`'s own scope, so the review round-trip never breaks the builder's session", () => {
    // humanReview is instantiated as a descendant of buildTail (not a root
    // sibling), so a full round of health -> review -> feedback stays within
    // one memoryScopeAt run. A future refactor hoisting the review tail back
    // to the root would silently undo this.
    const { scopes } = compileTemplate()
    expect(scopes["build.review.reviewing"]).toMatch(/^build\./)
    expect(scopes["build.fix"]).toBe("build")
  })

  it("design and architecture are sibling machines with distinct memory scopes, each declaring the planner model once at machine level", () => {
    const { scopes } = compileTemplate()
    expect(scopes["design.triage"]).toBe("design")
    expect(scopes["architecture.author"]).toBe("architecture")
    expect(scopes["design.triage"]).not.toBe(scopes["architecture.author"])
    expect(raw.machines["designPlan"]!.model).toBeTruthy()
    expect(raw.machines["archPlan"]!.model).toBeTruthy()
  })

  it("no machine contains BOTH a review-content prompt state AND an implementer-content prompt state — the planner/coder identities never overlap within one machine", () => {
    expect(ownPromptStates("designPlan")).toEqual(["triage"])
    expect(ownPromptStates("archPlan")).toEqual(["author", "decompose"])
    expect(ownPromptStates("humanReview")).toEqual(["collecting", "reviewing"])
    expect(ownPromptStates("specReview")).toEqual(["review"])

    expect(ownPromptStates("packageItem")).toEqual(["building", "fix-spec", "fix-suite"])
    expect(ownPromptStates("buildTail")).toEqual(["fix"])

    expect(ownPromptStates("entryGate")).toEqual([])
    expect(ownPromptStates("healthGate")).toEqual(["describe"])
    expect(ownPromptStates("questionGate")).toEqual([])
    expect(ownPromptStates("packageLoop")).toEqual([])
  })

  it("no path closes a process without a human sign-off — every edge landing straight on the sign-off target is one of the four vetted sources, all downstream of a human gate (package 03)", () => {
    // `$onSignoff` resolves to the root's own `idle` — the process-boundary
    // commit. A future state wired straight to it (skipping every human
    // gate entirely) would close a process with no human ever having seen
    // it; this fails loudly the moment a FIFTH source is added, rather than
    // relying on the one e2e scenario that only pins `fastReview` →
    // `await-review`. `fix-precheck` (an already-green baseline needs no
    // repair at all) and `build.review.collecting` (the pre-existing
    // non-actionable short-circuit on a hand-edited round) both predate
    // this package; `build.review.deciding`/`build.review.triaging` are
    // its own two new sources — the note-only round's non-actionable
    // short-circuit, one state earlier than `collecting`'s.
    const { definition } = compileTemplate()
    const SIGNOFF_TARGET = "idle"
    const sourcesOfSignoff = Object.entries(definition.states)
      .filter(([, state]) => {
        const onTargets = (state.on ?? []).map(([, target]) => target)
        const routeTargets = (state.routes ?? []).map((row) => row.to)
        return [...onTargets, ...routeTargets].includes(SIGNOFF_TARGET)
      })
      .map(([name]) => name)
      .sort()
    expect(sourcesOfSignoff).toEqual([
      "build.review.collecting",
      "build.review.deciding",
      "build.review.triaging",
      "fix-precheck",
    ])
  })

  it("actor: judge is EXACTLY the set of states declaring judge: — no other state changes actor, and no state claims a judgment it never renders (package 02)", () => {
    const { definition } = compileTemplate()
    const judgeStates = Object.entries(definition.states)
      .filter(([, state]) => state.judge !== undefined)
      .map(([name]) => name)
      .sort()
    const judgeActorStates = Object.entries(definition.states)
      .filter(([, state]) => state.actor === "judge")
      .map(([name]) => name)
      .sort()
    // Guards against a vacuous pass — the bundled template must actually
    // declare at least one judge: state for this assertion to mean anything.
    expect(judgeStates.length).toBeGreaterThan(0)
    expect(judgeActorStates).toEqual(judgeStates)
  })

  it("every state declaring routes: ends its catch-all on the same conservative target as its own skipped-judgment C and * ** rows — a skipped verdict and a 'keep going' one must land the same place (package 02)", () => {
    const { definition } = compileTemplate()
    const routesStates = Object.entries(definition.states).filter(
      ([, state]) => state.routes !== undefined,
    )
    expect(routesStates.length).toBeGreaterThan(0)
    for (const [name, state] of routesStates) {
      const routes = state.routes!
      const catchAll = routes[routes.length - 1]!.to
      const cTarget = (state.on ?? []).find(([pattern]) => pattern === "C")?.[1]
      const wildTarget = (state.on ?? []).find(([pattern]) => pattern === "* **")?.[1]
      expect(cTarget, name).toBe(catchAll)
      expect(wildTarget, name).toBe(catchAll)
    }
  })
})

describe("a judgment inlines the evidence its questions ask about (package 03)", () => {
  it("build.review.pre's rendered judgment carries real diff hunks in state.diff, and its three questions reference state.diff rather than a command the judge would have to run", () => {
    const { definition, vars } = compileTemplate()
    const state = definition.states["build.review.pre"]!
    const diffText =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n"
    const rendered = renderStateTemplate(state.judge!, {
      ...varsOnlyContext(vars, "build.review.pre"),
      reviewBase: "base123",
      diff: (base: string) => {
        expect(base).toBe("base123")
        return diffText
      },
    })
    const doc = JSON.parse(rendered)
    expect(doc.state.diff).toBe(diffText)
    for (const q of doc.questions) {
      expect(q.instructions).toContain("state.diff")
      expect(q.instructions).not.toMatch(/git diff/)
    }
  })
})
