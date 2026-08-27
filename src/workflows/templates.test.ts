import { parse as parseYaml } from "yaml"
import { describe, expect, it } from "vitest"
import { step, validateDefinition } from "../PatternMachine.js"
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
} from "./templates.js"
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

  it("declares exactly two questionGate instances, each `check` with the mandatory C row and each `answer` with no C row", () => {
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
    expect(vars.styleFormatContract).toMatch(/renumber or\s+rename/)
    expect(vars.styleFormatContract).toMatch(/refuses the turn|refused/)

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
  ]

  it("no machine's `system:` value is a file reference (package 04)", () => {
    const { definition } = compileTemplate()
    const systemStates = Object.entries(definition.states).filter(([, s]) => Boolean(s.system))
    expect(systemStates.length).toBeGreaterThan(0)
    for (const [name, state] of systemStates) {
      expect(state.system, `state "${name}"`).not.toMatch(/^\.\.?\//)
    }
  })

  it("declares the six persona variables in vars:, each non-empty (package 04)", () => {
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

  // Pinned by stable keyword, never a whole sentence, so a later reword
  // doesn't red this suite for no reason.

  it("design.triage's grouping step states the vertical-slicing test and the distinct-acceptance test (package 01)", () => {
    const { definition } = compileTemplate()
    const prompt = definition.states["design.triage"]!.prompt!

    expect(prompt).toMatch(/vertical/i)
    expect(prompt).toMatch(/capability/i)
    expect(prompt).toMatch(/never by layer/i)
    expect(prompt).toMatch(/scaffolding/i)

    expect(prompt).toMatch(/fails\s+before it and passes after/i)
    expect(prompt).toMatch(/merge it into\s+its neighbour/i)
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

  it("the fewer-larger-packages bias is the same literal sentence in both design.triage and architecture.author (package 01)", () => {
    const { definition } = compileTemplate()
    const normalize = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase()
    const triagePrompt = normalize(definition.states["design.triage"]!.prompt!)
    const authorPrompt = normalize(definition.states["architecture.author"]!.prompt!)

    const bias =
      "prefer fewer, larger packages — the smallest independently valuable change, not the smallest change that compiles"
    expect(triagePrompt).toContain(bias)
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

  it("questionBar and questionBarReturn pin the exact Open/Answered Questions positional rule (package 01)", () => {
    const { vars } = compileTemplate()
    expect(vars.questionBar).toMatch(/before every other `##`\s+section/)
    expect(vars.questionBar).toMatch(
      /`## Answered Questions` must come after\s+every other `##` section/,
    )
    expect(vars.questionBarReturn).toMatch(
      /`## Answered Questions` must come after\s+every other `##`\s+section/,
    )
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
    expect(ownPromptStates("healthGate")).toEqual([])
    expect(ownPromptStates("questionGate")).toEqual([])
    expect(ownPromptStates("packageLoop")).toEqual([])
  })
})
