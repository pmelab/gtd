import {
  answered,
  designLoop,
  entryGate,
  escalation,
  green,
  healthy,
  packageQueue,
  qualityLap,
  requireRevert,
  moveScript,
  restoreScript,
  revertScript,
  reviewTail,
  type AgentSpec,
  type PackageAgentSpec,
  type EscalationCount,
  type EscalationTexts,
  type HealthTexts,
  type ReviewOutcome,
  agent,
  changes,
  glob,
  head,
  human,
  judge,
  read,
  refuse,
  run,
  scope,
  sections,
  start,
  vars,
  type EntryBase,
  type FlowArgs,
  type Summary,
} from "../flows/index.js"
import * as t from "./text.js"
export { defaults } from "./vars.js"

// gtd's built-in default workflow. Any change to the tree starts a process:
// `idle` → `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design, architecture and one package per concern →
// the quality lap → human review, which signs off (the episode ends back at
// `idle`) or sends a full re-plan lap. `--entry fix-precheck`, `--entry
// review-gate.check --var reviewBase=<commitish>` and `--entry
// start-gate.check` enter the same flow further in.

/** A `vars:` probability threshold; blank or non-numeric can never be cleared. */
const threshold = (value: string | undefined): number => {
  const n = Number(value)
  return value === undefined || value.trim() === "" || !Number.isFinite(n) ? Infinity : n
}

const planner = { model: () => vars.plannerModel ?? "" }
const coder = { model: () => vars.coderModel ?? "" }

const FIX_CAP = 3

/** Run one agent spec as a step of its own name. */
export const runAgentSpec = (
  name: string,
  spec: AgentSpec,
  extra: { readonly allowEmpty?: boolean } = {},
): Promise<void> =>
  agent(name, spec.prompt(), {
    label: spec.label,
    file: spec.file,
    mode: spec.mode,
    model: spec.model?.(),
    system: spec.system?.(),
    ...extra,
  })

// ── Agent steps ─────────────────────────────────────────────────────────────

const buildFix: AgentSpec = {
  prompt: () => t.withSkills(vars.fixSkills, t.buildFixPrompt()),
  label: "Fixing the check",
  file: ".gtd/FEEDBACK.md",
  model: coder.model,
  system: t.finisherSystem,
}

const fixQuality: AgentSpec = {
  prompt: () => t.withSkills(vars.reviewFixSkills, t.buildFixQualityPrompt()),
  label: "Fixing quality findings",
  file: ".gtd/QUALITY.md",
  model: coder.model,
  system: t.finisherSystem,
}

const reviewing = {
  label: "Reviewing",
  file: ".gtd/REVIEW.md",
  mode: "review",
  model: planner.model,
  system: t.reviewerSystem,
}

const collecting = {
  label: "Collecting your feedback",
  file: ".gtd/REQUIREMENTS.md",
  mode: "qa",
  model: planner.model,
  system: t.reviewerSystem,
}

const designTriage = (base: () => string): AgentSpec => ({
  prompt: () => t.withSkills(vars.triageSkills, t.designTriagePrompt(base())),
  label: "Triaging the change",
  file: ".gtd/REQUIREMENTS.md",
  mode: "qa",
  model: planner.model,
  system: t.designSystem,
})

const architectureAuthor: AgentSpec = {
  prompt: () => t.withSkills(vars.architectureSkills, t.architectureAuthorPrompt()),
  label: "Refining the technical plan",
  file: ".gtd/ARCHITECTURE.md",
  mode: "qa",
  model: planner.model,
  system: t.architectSystem,
}

const decompose: AgentSpec = {
  prompt: () => t.withSkills(vars.decomposeSkills, t.architectureDecomposePrompt()),
  label: "Decomposing into packages",
  model: planner.model,
  system: t.architectSystem,
}

const building: PackageAgentSpec = {
  prompt: (pkg) => t.withSkills(vars.buildSkills, t.packagesItemBuildingPrompt(pkg)),
  label: "Building",
  model: coder.model,
  system: t.builderSystem,
}

const fixSuite: AgentSpec = {
  prompt: () => t.withSkills(vars.fixSkills, t.packagesItemFixSuitePrompt()),
  label: "Fixing the check",
  file: ".gtd/FEEDBACK.md",
  model: coder.model,
  system: t.builderSystem,
}

const fixSpec: PackageAgentSpec = {
  prompt: (pkg) => t.withSkills(vars.reviewFixSkills, t.packagesItemFixSpecPrompt(pkg)),
  label: "Fixing review feedback",
  file: ".gtd/SPEC_FEEDBACK.md",
  model: coder.model,
  system: t.builderSystem,
}

const specReviewer = {
  label: "Reviewing the package",
  model: planner.model,
  system: t.specReviewerSystem,
}

const collectingPrompt = (capture: string): string =>
  t.withSkills(vars.reviewSkills, t.buildReviewCollectingPrompt(capture))

/** The first queued package — the one a package step works on. */
const firstPackage = (): string => [...glob(".gtd/packages/*.md")].sort()[0] ?? ""

/**
 * The bundled agent steps by full step name — what the prompt evals enter one
 * at a time, with the same prompt and persona the workflow gives them. Steps
 * that review since a base see the process's own diff base; package steps
 * work on the first queued package; collecting reads its capture from
 * `.gtd/REVIEW_RAW.md`, where an eval fixture puts it.
 */
export const agentSpecs: Readonly<Record<string, AgentSpec>> = {
  "build.review.reviewing": {
    ...reviewing,
    prompt: () => t.withSkills(vars.reviewSkills, t.buildReviewReviewingPrompt(start())),
  },
  "build.review.collecting": {
    ...collecting,
    prompt: () => collectingPrompt(read(".gtd/REVIEW_RAW.md") ?? ""),
  },
  "design.triage": designTriage(start),
  "architecture.author": architectureAuthor,
  "packages.item.building": { ...building, prompt: () => building.prompt(firstPackage()) },
  "packages.item.fix-suite": fixSuite,
  "packages.item.fix-spec": { ...fixSpec, prompt: () => fixSpec.prompt(firstPackage()) },
  "packages.item.spec.review": {
    ...specReviewer,
    prompt: () =>
      t.withSkills(vars.specReviewSkills, t.packagesItemSpecReviewPrompt(firstPackage())),
  },
  "architecture.decompose": decompose,
  "build.fix": buildFix,
}

// ── Keeping the suite green ─────────────────────────────────────────────────

const escalationTexts: EscalationTexts = {
  describe: {
    prompt: () => t.withSkills(vars.escalateSkills, t.healthDescribePrompt()),
    label: "Describing the escalation",
    file: ".gtd/FEEDBACK.md",
    model: coder.model,
    system: t.escalationSystem,
  },
  stop: {
    message: t.healthStopMessage,
    label: "Escalating to a human",
    file: ".gtd/ESCALATION.md",
  },
  exhausted: {
    message: t.healthExhaustedMessage,
    label: "Escalation exhausted",
    file: ".gtd/ESCALATION.md",
  },
}

const testCommand = (): string => vars.testCommand ?? ""

const healthTexts: HealthTexts = {
  check: {
    command: testCommand,
    label: "Running checks",
    // Swept only on green: an unresolved analysis survives every retry.
    sweepOnGreen: [".gtd/ESCALATION.md"],
  },
  judge: { message: t.healthJudgeMessage, label: "Judging the retry" },
  escalation: escalationTexts,
}

const suiteCheck = { command: testCommand, label: "Checking the baseline" }

const buildHealth = (fixesSoFar: number, escalations: EscalationCount): Promise<void> =>
  healthy({
    texts: healthTexts,
    fix: () => runAgentSpec("fix", buildFix),
    cap: FIX_CAP,
    fixesSoFar,
    identicalMinP: threshold(vars.judgeIdenticalMinP),
    escalations,
  })

/** Resolves `true` once `.gtd/QUALITY.md` is resolved, `false` when the fix cap escalated instead. */
const fixQualityFindings = async (escalations: EscalationCount): Promise<boolean> => {
  for (let turns = 0; turns < FIX_CAP; turns++) {
    await runAgentSpec("fix-quality", fixQuality, { allowEmpty: true })
    if (changes(".gtd/QUALITY.md").some((c) => c.status === "deleted")) return true
  }
  await escalation(escalationTexts, escalations)
  return false
}

// ── Review ──────────────────────────────────────────────────────────────────

/** A confidence floor from `vars:`; blank or non-numeric floors nothing. */
const floor = (value: string | undefined): number => {
  const n = Number(value)
  return value === undefined || value.trim() === "" || !Number.isFinite(n) ? 0 : n
}

const review = (base: string): Promise<ReviewOutcome> =>
  reviewTail(
    {
      reviewing: {
        ...reviewing,
        prompt: (base) => t.withSkills(vars.reviewSkills, t.buildReviewReviewingPrompt(base)),
      },
      awaitReview: {
        message: t.buildReviewAwaitReviewMessage,
        label: "Awaiting your review",
        file: ".gtd/REVIEW.md",
        mode: "review",
      },
      missing: { message: t.buildReviewReviewMissingMessage, label: "Nothing to review" },
      closing: { label: "Closing the review" },
      triage: { message: t.buildReviewTriageMessage, label: "Judging feedback actionability" },
      capture: { edits: t.reviewEditsCapture, notes: t.reviewNotesCapture },
      actionableMinP: floor(vars.reviewNoteActionable),
      collecting: { ...collecting, prompt: collectingPrompt },
    },
    base,
  )

const quality = {
  lenses: () =>
    (vars.qualityReviews ?? "")
      .split(",")
      .map((lens) => lens.trim())
      .filter((lens) => lens !== ""),
  reviewing: {
    prompt: (lens: string) => t.withSkills(lens, t.buildQualityReviewingPrompt(lens)),
    label: "Reviewing (one quality lens)",
    file: ".gtd/QUALITY.md",
    model: planner.model,
    system: t.reviewerSystem,
  },
}

/** The build tail: fix (when entered red), keep green, the quality lap, then human review since `base`. */
const buildTail = (fixFirst: boolean, base: string): Promise<ReviewOutcome> =>
  scope("build", async () => {
    const escalations: EscalationCount = { rounds: 0 }
    let redFirst = fixFirst
    // The lap runs once a tail: after its findings are fixed, review follows.
    let lapped = false
    for (;;) {
      if (redFirst) {
        await runAgentSpec("fix", buildFix)
        await buildHealth(1, escalations)
        redFirst = false
      }
      const lap = lapped ? "clean" : await qualityLap(quality)
      lapped = true
      if (lap === "clean") return review(base)
      if (await fixQualityFindings(escalations)) await buildHealth(0, escalations)
      else redFirst = true
    }
  })

// ── Planning ────────────────────────────────────────────────────────────────

const design = (base: string): Promise<void> =>
  scope("design", () =>
    designLoop(
      "triage",
      designTriage(() => base),
      {
        file: () => ".gtd/REQUIREMENTS.md",
        answer: {
          message: t.designGateAnswerMessage,
          label: "Awaiting your product answers",
          file: ".gtd/REQUIREMENTS.md",
          mode: "qa",
        },
      },
      ".gtd/REQUIREMENTS.md",
    ),
  )

const architecture = (): Promise<void> =>
  scope("architecture", async () => {
    await designLoop("author", architectureAuthor, {
      file: () => ".gtd/ARCHITECTURE.md",
      answer: {
        message: t.architectureGateAnswerMessage,
        label: "Awaiting your technical answers",
        file: ".gtd/ARCHITECTURE.md",
        mode: "qa",
      },
    })
    await runAgentSpec("decompose", decompose)
    if (changes(".gtd/packages/**").length === 0) {
      refuse("gtd land: decompose: write at least one package under .gtd/packages/")
    }
  })

/** A package file name from a plan's first heading. */
const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "package"

/** Whether the settled plan needs its own architecture pass, or goes straight to one package. */
const architecturePass = async (): Promise<void> => {
  const { answers, truncated } = await judge("architecture-pre", {
    questions: [
      {
        id: "architectureWarranted",
        primitive: "noul",
        instructions:
          "Given the settled concerns in `.gtd/REQUIREMENTS.md` (in state), does this plan warrant a dedicated architecture pass — real structural decisions, multiple integration points, or a non-obvious tradeoff — before packages are written?",
        criteria:
          "Answer yes if uncertain; a trivial, single-concern, mechanical plan with no real design decision answers no.",
      },
    ],
    evidence: { requirements: read(".gtd/REQUIREMENTS.md") ?? "" },
    message: t.architecturePreMessage(),
    label: "Judging whether this plan warrants an architecture pass",
  })
  // A plan the budget cut can hide its structural concerns from the judge:
  // never skip the architecture pass on it, however confident the "no".
  const skip =
    truncated.length === 0 &&
    answered(answers.architectureWarranted, "no", threshold(vars.architectureSkipMinP))
  const plan = read(".gtd/REQUIREMENTS.md")
  if (skip && plan !== undefined) {
    const target = `.gtd/packages/01-${slug(sections(plan)[0] ?? "")}.md`
    await run("architecture-promote", moveScript(".gtd/REQUIREMENTS.md", target), {
      label: "Promoting the plan straight to a package",
    })
    return
  }
  await architecture()
}

const packages = (): Promise<void> =>
  scope("packages", () =>
    packageQueue(
      {
        building,
        fixSuite,
        fixSpec,
        closing: {
          label: "Closing out the package",
          // The spent technical plan goes with the first package built from it.
          sweep: [".gtd/SPEC_FEEDBACK.md", ".gtd/SATISFIED.md", ".gtd/ARCHITECTURE.md"],
        },
        health: healthTexts,
        spec: {
          pre: { message: t.packagesItemSpecPreMessage, label: "Judging spec coverage" },
          review: {
            ...specReviewer,
            prompt: (pkg, failing) =>
              t.withSkills(vars.specReviewSkills, t.packagesItemSpecReviewPrompt(pkg, failing)),
          },
          clearMinP: threshold(vars.specPreJudge),
        },
      },
      { fixCap: FIX_CAP, identicalMinP: threshold(vars.judgeIdenticalMinP) },
    ),
  )

// ── The flow ────────────────────────────────────────────────────────────────

/**
 * Undo the human's review-round code edits. A path changed since the human
 * left it is not overwritten; requireRevert names it instead.
 */
const reUnwind = async (feedback: Extract<ReviewOutcome, { verdict: "feedback" }>) => {
  const { base, edited } = feedback
  const restore = edited.filter((c) => c.status !== "added").map((c) => c.path)
  const remove = edited.filter((c) => c.status === "added").map((c) => c.path)
  await run("re-unwind", restoreScript(base, { restore, remove }), {
    label: "Re-unwinding your review edit",
    file: ".gtd/REVIEW.md",
    base,
  })
  requireRevert(edited, base)
}

/** Plan, build and review until a review round signs off; feedback re-plans from scratch. */
const planAndBuild = async (firstBase: string): Promise<void> => {
  let base = firstBase
  for (;;) {
    await design(base)
    await architecturePass()
    await packages()
    const outcome = await buildTail(false, base)
    if (outcome.verdict === "signoff") return
    await reUnwind(outcome)
    base = outcome.base
  }
}

/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. */
const afterTail = async (outcome: ReviewOutcome): Promise<void> => {
  if (outcome.verdict === "signoff") return
  await reUnwind(outcome)
  await planAndBuild(outcome.base)
}

const gate = (name: string, message: () => string): Promise<void> =>
  scope(name, () =>
    entryGate({
      check: suiteCheck,
      blocked: { message, label: "Baseline is red", file: ".gtd/FEEDBACK.md" },
    }),
  )

/** Revert the sketch that started the process out of the working tree; its intent survives in history. */
const unwind = (): Promise<void> => {
  const commit = head()
  return run("unwind", revertScript(commit, ".gtd/FEEDBACK.md", t.unwindFailure(commit)), {
    label: "Unwinding your input",
  })
}

const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  await unwind()
  if (changes(".gtd/FEEDBACK.md").some((c) => c.status !== "deleted")) {
    await human("unwind-failed", {
      message: t.unwindFailedMessage(),
      label: "Could not unwind your input",
      file: ".gtd/FEEDBACK.md",
    })
  }
  await gate("start-gate", t.startGateBlockedMessage)
  await planAndBuild(start())
}

const ENTRIES = ["fix-precheck", "review-gate.check", "start-gate.check"]

export default async function unified({ entry }: FlowArgs): Promise<void> {
  if (entry === undefined) return ordinaryStart()
  if (entry === "fix-precheck") {
    if (await green("fix-precheck", suiteCheck)) return
    return afterTail(await buildTail(true, start()))
  }
  if (entry === "review-gate.check") {
    await gate("review-gate", t.reviewGateBlockedMessage)
    return afterTail(await buildTail(false, start()))
  }
  if (entry === "start-gate.check") {
    await gate("start-gate", t.startGateBlockedMessage)
    return planAndBuild(start())
  }
  refuse(
    `"${entry}" is not an enterable state — enterable states:\n${ENTRIES.map((name) => `  ${name}`).join("\n")}`,
  )
}

export const summary: Summary = t.summaryPrompt

export const base: EntryBase = (entry, vars) =>
  entry === "review-gate.check" ? (vars.reviewBase ?? "") : undefined
