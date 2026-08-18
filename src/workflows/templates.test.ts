import { parse as parseYaml } from "yaml"
import { describe, expect, it } from "vitest"
import { stateDirError, validateDefinition } from "../PatternMachine.js"
import { seededValidateCommand } from "../SteeringFormats.js"
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
} from "./templates.js"
import unifiedYaml from "./unified.yaml"

/** State names (sorted) whose script/prompt/message/commit contains `needle`. */
function statesReferencing(
  definition: ReturnType<typeof compileTemplate>["definition"],
  needle: string,
): string[] {
  const contentsOf = (state: (typeof definition.states)[string]): string[] =>
    [state.script, state.prompt, state.message, state.commit].filter(
      (c): c is string => c !== undefined,
    )
  return Object.entries(definition.states)
    .filter(([, state]) => contentsOf(state).some((c) => c.includes(needle)))
    .map(([name]) => name)
    .sort()
}

describe("the bundled unified workflow template", () => {
  it("compiles with no validation findings and exactly one initial state", () => {
    const { definition } = compileTemplate()
    expect(validateDefinition(definition)).toEqual([])
    expect(definition.entries.default).toBeTruthy()
    expect(definition.states[definition.entries.default]).toBeDefined()
  })

  it("declares a `stateDir` that renders from its own `stateDir` var", () => {
    const { definition } = compileTemplate()
    expect(definition.stateDir).toBe("<%= it.vars.stateDir %>")
    expect(defaultWorkflowVars.stateDir).toBe(".gtd")
    // The declaration's own template only ever substitutes the var verbatim,
    // so the var's default value IS the rendered result `stateDirError` sees.
    expect(stateDirError(defaultWorkflowVars.stateDir!)).toBeUndefined()
  })

  it("declares no `prose` mode, plus the built-in registry's `qa`/`review` seeded with their validate command", () => {
    const { definition } = compileTemplate()
    expect(definition.modes?.["prose"]).toBeUndefined()
    expect(definition.modes?.["qa"]).toEqual({ validate: seededValidateCommand("qa") })
    expect(definition.modes?.["review"]).toEqual({ validate: seededValidateCommand("review") })
  })

  it("declares exactly one review checkout window and one review entry", () => {
    // The process runs to a human review gate, so it must declare exactly one
    // `reviewWindow: true` state (the gate that opens the editor's checkout
    // window) and exactly one manual entry named `review-gate.check` (the
    // `gtd --entry review-gate.check` entry point) — see src/ReviewWindow.ts.
    const { definition } = compileTemplate()
    const states = Object.values(definition.states)
    expect(states.filter((s) => s.reviewWindow === true)).toHaveLength(1)
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
      for (const content of [state.script, state.prompt, state.message, state.commit]) {
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
    // unwind has exactly one inbound edge (idle's) and one outbound edge,
    // into the single start gate — the single inbound edge is what makes an
    // idempotence guard unnecessary there (see unified.yaml's own comment).
    const inbound = Object.entries(definition.states).flatMap(([from, s]) =>
      (s.on ?? []).filter(([, to]) => to === "unwind").map(() => from),
    )
    expect(inbound).toEqual(["idle"])
    const unwindTargets = (definition.states.unwind!.on ?? []).map(([, to]) => to)
    expect(unwindTargets).toEqual(["start-gate.check"])
    // The gate proceeds to triage once green.
    expect((definition.states["start-gate.check"]!.on ?? []).map(([, to]) => to)).toContain(
      "design.triage",
    )
  })

  it("declares exactly the three qualified entryGate/fix-precheck states as manual entries", () => {
    // Both `entryGate` instances (start-gate/review-gate) declare `entry:
    // true` on their shared `check` local — the dedup means marking one
    // marks both, even though only `review-gate.check` actually needs the
    // reachability root — plus `fix-precheck`'s own.
    const { definition } = compileTemplate()
    const { default: def, manual } = definition.entries
    expect(def).toBeTruthy()
    expect(manual).toEqual(["fix-precheck", "review-gate.check", "start-gate.check"])
    expect(new Set([def, ...manual]).size).toBe(4)
    expect(definition.states[def]).toBeDefined()
    for (const state of manual) expect(definition.states[state]).toBeDefined()
  })

  it("compiles exactly one template-form reviewBase, and no truthy reviewBase on start-gate", () => {
    // `review-gate.check` fixes the whole process's diff base to a
    // manually-supplied commitish (a template string, via its `$reviewBase`
    // binding). `start-gate.check` binds the same param to the literal empty
    // string, which compiles away to "field absent".
    const { definition } = compileTemplate()
    const states = definition.states
    const templateReviewBase = Object.entries(states).filter(
      ([, s]) => typeof s.reviewBase === "string",
    )
    expect(templateReviewBase.map(([name]) => name)).toEqual(["review-gate.check"])
    expect(states["start-gate.check"]!.reviewBase).toBeUndefined()
  })

  it("declares exactly two questionGate instances, each `check` with the mandatory C row and each `answer` with no C row", () => {
    const { definition } = compileTemplate()
    // Pinned by COUNT (mirrors the entryGate manual-entries pin above) — a
    // third `.gate.check` added later without updating this test would
    // otherwise pass silently.
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
      const answerPatterns = (answer.on ?? []).map(([pattern]) => pattern)
      expect(answerPatterns, prefix).not.toContain("C")
    }
  })

  it("no state declares `mode: prose`", () => {
    const { definition } = compileTemplate()
    for (const [name, state] of Object.entries(definition.states)) {
      expect(state.mode, `state "${name}"`).not.toBe("prose")
    }
  })

  it("exposes the compiled default as the built-in fallback (definition + its own vars)", () => {
    // `src/Config.ts` and the in-memory test layer fall back to these when no
    // `workflow:` is configured — so they must be the same compiled shape the
    // template produces, with the template's own `vars:` defaults intact.
    expect(validateDefinition(defaultWorkflowDefinition)).toEqual([])
    expect(defaultWorkflowDefinition).toEqual(compileTemplate().definition)
    expect(defaultWorkflowVars).toEqual(compileTemplate().vars)
    expect(defaultWorkflowVars.testCommand).toBe("npm test")
  })

  it("exposes defaultStateScopes covering every state in the compiled default", () => {
    // src/Config.ts exposes this as ConfigOperations.stateScopes for the
    // built-in default — it must be the same scopes map the template
    // produces, with an entry for every single compiled state.
    expect(defaultStateScopes).toEqual(compileTemplate().scopes)
    expect(Object.keys(defaultStateScopes).sort()).toEqual(
      Object.keys(defaultWorkflowDefinition.states).sort(),
    )
  })

  it("renders the full workflow config with the $schema key first (renderInitConfig)", () => {
    // renderInitConfig materializes the built-in default into a `workflow:`
    // config — the way to eject/customize the machine, and the hermetic
    // `Given the workflow` test fixture (modes-free).
    const rendered = renderInitConfig()
    const parsed = JSON.parse(rendered) as { $schema: string; workflow: unknown; modes?: unknown }
    expect(parsed.$schema).toBe(SCHEMA_URL)
    expect(parsed.workflow).toBeTypeOf("object")
    expect(parsed.modes).toBeUndefined()
    expect(rendered.endsWith("\n")).toBe(true)
  })

  describe("renderInitScaffold — the minimal config `gtd init` writes", () => {
    it("seeds only the default vars and the Prettier modes suggestion, no workflow", () => {
      const { config } = renderInitScaffold()
      const parsed = JSON.parse(config) as {
        $schema: string
        vars: unknown
        modes: unknown
        workflow?: unknown
      }
      expect(parsed.$schema).toBe(SCHEMA_URL)
      expect(parsed.vars).toEqual(INIT_VARS)
      expect(parsed.modes).toEqual(MODES_SUGGESTION)
      // The workflow is built in — init never writes it.
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
    // A package whose acceptance criteria are already met (an earlier
    // package's fix turn pulled the work in) must have a legal, non-empty way
    // to say so, rather than dead-ending in an empty attempt + stall.
    const { definition } = compileTemplate()
    const building = definition.states["packages.item.building"]!
    const edges = building.on ?? []
    const satisfiedAdd = edges.find(([pattern]) => pattern.includes("A "))
    const satisfiedMod = edges.find(([pattern]) => pattern.includes("M "))
    expect(satisfiedAdd?.[1]).toBe("packages.item.health.check")
    expect(satisfiedAdd?.[3]).toBeTruthy() // action
    expect(satisfiedMod?.[1]).toBe(satisfiedAdd?.[1])
  })

  // The three unstructured-file authoring prompts (package 02) — voice only,
  // no structural override, since nothing parses their output.
  const PROSE_PROMPTS = ["architecture.decompose", "packages.item.spec.review", "build.squashing"]

  // The four machine-parsed prompts (package 03) — the only states that
  // interpolate both a `file:` and a `mode:` of `qa`/`review` — get BOTH the
  // voice and the structural override that outranks it.
  const PARSED_PROMPTS = [
    "design.triage",
    "architecture.author",
    "build.review.collecting",
    "build.review.reviewing",
  ]

  it("declares the styleBlock/styleFormatContract voice variables, non-empty, styleFormatContract on-message (package 01)", () => {
    // Settled shape: two independently-overridable vars, one for the free
    // prose sites and one for the machine-parsed override — see
    // .gtd/packages/01-style-vars-and-attribution.md.
    const { vars } = compileTemplate()
    expect(vars.styleBlock).toBeTruthy()
    expect(vars.styleFormatContract).toBeTruthy()

    // The structural override names its consequence, not a polite ask.
    expect(vars.styleFormatContract).toMatch(/checkbox/)
    expect(vars.styleFormatContract).toMatch(/##.*###.*heading/)
    expect(vars.styleFormatContract).toMatch(/renumber or\s+rename/)
    expect(vars.styleFormatContract).toMatch(/refuses the turn|refused/)

    // Attribution: upstream name, URL, licence, and the version derived from.
    expect(unifiedYaml).toMatch(/attention-span/)
    expect(unifiedYaml).toMatch(/https:\/\/github\.com\/alexgreensh\/attention-span/)
    expect(unifiedYaml).toMatch(/AGPL-3\.0/)
    expect(unifiedYaml).toMatch(/version 0\.6|v0\.6/)
  })

  it("pins the seven voice-bearing prompts by name and count, so an eighth site added later fails loudly (package 02, 03)", () => {
    expect([...PROSE_PROMPTS, ...PARSED_PROMPTS].sort()).toEqual(
      [
        "architecture.decompose",
        "packages.item.spec.review",
        "build.squashing",
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
    expect(closing.script).toContain("it.vars.satisfiedFile")
    const buildHealthCheck = definition.states["build.health.check"]!
    const packagesHealthCheck = definition.states["packages.item.health.check"]!
    expect(buildHealthCheck.script).not.toContain("it.vars.satisfiedFile")
    expect(packagesHealthCheck.script).not.toContain("it.vars.satisfiedFile")
  })
})

describe("the bundled template's machine boundaries line up with conversational identity (package 08/02)", () => {
  // These invariants are about the RAW `machines:` source, not the compiled
  // (flattened) definition — the compiler STAMPS a machine-level `model:`
  // onto every one of its own `prompt` states (src/Machines.ts's
  // `resolveInstanceModel`), so by the time a state is compiled it always
  // carries a `model` whether it was declared machine-level or (the thing
  // this restructure eliminates) state-level. Only the raw source can tell
  // the two apart.
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
    walk(tree)

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

  it("packages, build.health, packages.item.health, start-gate, review-gate, design.gate, and architecture.gate have no model — they are identity-free gate/queue machines", () => {
    const { tree } = compileTemplate()
    const machineAt: Record<string, string> = {}
    const walk = (node: MachineNode): void => {
      machineAt[node.key] = node.machine
      node.children.forEach(walk)
    }
    walk(tree)

    for (const instancePath of [
      "packages",
      "build.health",
      "packages.item.health",
      "start-gate",
      "review-gate",
      "design.gate",
      "architecture.gate",
    ]) {
      expect(raw.machines[machineAt[instancePath]!]?.model, instancePath).toBeUndefined()
    }
  })

  it("`build.review` is nested inside `build`'s own scope, so the review round-trip never breaks the builder's session", () => {
    // The load-bearing point of this restructure: humanReview is instantiated
    // as a descendant of buildTail (not a root sibling), so a full round of
    // health -> review -> feedback stays within one memoryScopeAt run. A
    // future refactor that hoists the review tail back to the root would
    // silently undo this — pin it here.
    const { scopes } = compileTemplate()
    expect(scopes["build.review.reviewing"]).toMatch(/^build\./)
    for (const state of ["fix", "squashing"]) {
      expect(scopes[`build.${state}`]).toBe("build")
    }
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
    // Planner machines: every one of their OWN prompt states is a
    // plan-development/review action, never a write-code one.
    expect(ownPromptStates("designPlan")).toEqual(["triage"])
    expect(ownPromptStates("archPlan")).toEqual(["author", "decompose"])
    expect(ownPromptStates("humanReview")).toEqual(["collecting", "reviewing"])
    expect(ownPromptStates("specReview")).toEqual(["review"])

    // Coder machines: every one of their OWN prompt states is a
    // write/fix-code action, never a plan-development/review one.
    expect(ownPromptStates("packageItem")).toEqual(["building", "fix-spec", "fix-suite"])
    expect(ownPromptStates("buildTail")).toEqual(["fix", "squashing"])

    // Identity-free gate/queue machines own no prompt state at all.
    expect(ownPromptStates("entryGate")).toEqual([])
    expect(ownPromptStates("healthGate")).toEqual([])
    expect(ownPromptStates("questionGate")).toEqual([])
    expect(ownPromptStates("packageLoop")).toEqual([])
  })
})
