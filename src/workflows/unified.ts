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
  reviewTail,
  type AgentSpec,
  type EscalationCount,
  type EscalationTexts,
  type HealthTexts,
  type ReviewOutcome,
  agent,
  changes,
  human,
  judge,
  read,
  refuse,
  run,
  scope,
  start,
  vars,
  workflow,
} from "../flows/index.js"
import * as t from "./text.js"
import { defaults } from "./vars.js"

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
    skills: spec.skills?.(),
    model: spec.model?.(),
    system: spec.system?.(),
    ...extra,
  })

// ── Agent steps ─────────────────────────────────────────────────────────────

const buildFix: AgentSpec = {
  prompt: t.buildFixPrompt,
  label: "Fixing the check",
  file: ".gtd/FEEDBACK.md",
  skills: () => vars.fixSkills ?? "",
  model: coder.model,
  system: t.finisherSystem,
}

const fixQuality: AgentSpec = {
  prompt: t.buildFixQualityPrompt,
  label: "Fixing quality findings",
  file: ".gtd/QUALITY.md",
  skills: () => vars.reviewFixSkills ?? "",
  model: coder.model,
  system: t.finisherSystem,
}

const reviewing = {
  label: "Reviewing",
  file: ".gtd/REVIEW.md",
  mode: "review",
  skills: () => vars.reviewSkills ?? "",
  model: planner.model,
  system: t.reviewerSystem,
}

const collecting: AgentSpec = {
  prompt: t.buildReviewCollectingPrompt,
  label: "Collecting your feedback",
  file: ".gtd/REQUIREMENTS.md",
  mode: "qa",
  model: planner.model,
  system: t.reviewerSystem,
}

const designTriage = (base: () => string): AgentSpec => ({
  prompt: () => t.designTriagePrompt(base()),
  label: "Triaging the change",
  file: ".gtd/REQUIREMENTS.md",
  mode: "qa",
  skills: () => vars.triageSkills ?? "",
  model: planner.model,
  system: t.designSystem,
})

const architectureAuthor: AgentSpec = {
  prompt: t.architectureAuthorPrompt,
  label: "Refining the technical plan",
  file: ".gtd/ARCHITECTURE.md",
  mode: "qa",
  skills: () => vars.architectureSkills ?? "",
  model: planner.model,
  system: t.architectSystem,
}

const decompose: AgentSpec = {
  prompt: t.architectureDecomposePrompt,
  label: "Decomposing into packages",
  skills: () => vars.decomposeSkills ?? "",
  model: planner.model,
  system: t.architectSystem,
}

const building: AgentSpec = {
  prompt: t.packagesItemBuildingPrompt,
  label: "Building",
  skills: () => vars.buildSkills ?? "",
  model: coder.model,
  system: t.builderSystem,
}

const fixSuite: AgentSpec = {
  prompt: t.packagesItemFixSuitePrompt,
  label: "Fixing the check",
  file: ".gtd/FEEDBACK.md",
  skills: () => vars.fixSkills ?? "",
  model: coder.model,
  system: t.builderSystem,
}

const fixSpec: AgentSpec = {
  prompt: t.packagesItemFixSpecPrompt,
  label: "Fixing review feedback",
  file: ".gtd/SPEC_FEEDBACK.md",
  skills: () => vars.reviewFixSkills ?? "",
  model: coder.model,
  system: t.builderSystem,
}

const specReviewer = {
  label: "Reviewing the package",
  skills: () => vars.specReviewSkills ?? "",
  model: planner.model,
  system: t.specReviewerSystem,
}

/**
 * The bundled agent steps by full step name — what the prompt evals enter one
 * at a time, with the same prompt and persona the workflow gives them. Steps
 * that review since a base see the process's own diff base here.
 */
export const agentSpecs: Readonly<Record<string, AgentSpec>> = {
  "build.review.reviewing": {
    ...reviewing,
    prompt: () => t.buildReviewReviewingPrompt(start()),
  },
  "build.review.collecting": collecting,
  "design.triage": designTriage(start),
  "architecture.author": architectureAuthor,
  "packages.item.building": building,
  "packages.item.fix-suite": fixSuite,
  "packages.item.fix-spec": fixSpec,
  "packages.item.spec.review": { ...specReviewer, prompt: () => t.packagesItemSpecReviewPrompt() },
  "architecture.decompose": decompose,
  "build.fix": buildFix,
}

// ── Keeping the suite green ─────────────────────────────────────────────────

const escalationTexts: EscalationTexts = {
  describe: {
    prompt: t.healthDescribePrompt,
    label: "Describing the escalation",
    file: ".gtd/FEEDBACK.md",
    skills: () => vars.escalateSkills ?? "",
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

const healthTexts: HealthTexts = {
  check: { script: t.healthCheckScript, label: "Running checks" },
  judge: { message: t.healthJudgeMessage, label: "Judging the retry" },
  escalation: escalationTexts,
}

const suiteCheck = { script: t.suiteCheckScript, label: "Checking the baseline" }

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
      reviewing: { ...reviewing, prompt: t.buildReviewReviewingPrompt },
      awaitReview: {
        message: t.buildReviewAwaitReviewMessage,
        label: "Awaiting your review",
        file: ".gtd/REVIEW.md",
        mode: "review",
      },
      deciding: { script: t.buildReviewDecidingScript, label: "Reviewing" },
      missing: {
        message: t.buildReviewReviewMissingMessage,
        label: "Nothing to review",
        file: ".gtd/FEEDBACK.md",
      },
      triage: { message: t.buildReviewTriageMessage, label: "Judging feedback actionability" },
      rawCapture: t.reviewRawCapture,
      actionableMinP: floor(vars.reviewNoteActionable),
      collecting,
    },
    base,
  )

/** The build tail: fix (when entered red), keep green, the quality lap, then human review since `base`. */
const buildTail = (fixFirst: boolean, base: string): Promise<ReviewOutcome> =>
  scope("build", async () => {
    const escalations: EscalationCount = { rounds: 0 }
    let redFirst = fixFirst
    for (;;) {
      if (redFirst) {
        await runAgentSpec("fix", buildFix)
        await buildHealth(1, escalations)
        redFirst = false
      }
      const lap = await qualityLap({
        seeding: { script: t.buildQualitySeedingScript, label: "Seeding the quality review queue" },
        picking: { script: t.buildQualityPickingScript, label: "Picking the next quality lens" },
        reviewing: {
          prompt: t.buildQualityReviewingPrompt,
          label: "Reviewing (one quality lens)",
          file: ".gtd/NEXT_REVIEW.md",
          skills: t.buildQualityReviewingSkills,
          model: planner.model,
          system: t.reviewerSystem,
        },
      })
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
        check: { script: t.questionCheckScript, label: "Checking for open questions" },
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
      check: { script: t.questionCheckScript, label: "Checking for open questions" },
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
  if (skip) {
    await run("architecture-promote", t.architecturePromoteScript(), {
      label: "Promoting the plan straight to a package",
    })
    if (changes().length > 0) return
  }
  await architecture()
}

const packages = (): Promise<void> =>
  scope("packages", () =>
    packageQueue(
      {
        picking: { script: t.packagesPickingScript, label: "Picking the next package" },
        building,
        fixSuite,
        fixSpec,
        closing: { script: t.packagesItemClosingScript, label: "Closing out the package" },
        health: healthTexts,
        spec: {
          pre: { message: t.packagesItemSpecPreMessage, label: "Judging spec coverage" },
          review: { ...specReviewer, prompt: t.packagesItemSpecReviewPrompt },
          clearMinP: threshold(vars.specPreJudge),
        },
      },
      { fixCap: FIX_CAP, identicalMinP: threshold(vars.judgeIdenticalMinP) },
    ),
  )

// ── The flow ────────────────────────────────────────────────────────────────

/** Undo the human's review-round code edit, so planning reads it from history. */
const reUnwind = async (feedback: Extract<ReviewOutcome, { verdict: "feedback" }>) => {
  await run("re-unwind", t.reUnwindScript(feedback.base), {
    label: "Re-unwinding your review edit",
    file: ".gtd/REVIEW.md",
    base: feedback.base,
  })
  requireRevert(feedback.edited, feedback.base)
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

const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  await run("unwind", t.unwindScript(), { label: "Unwinding your input" })
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

export default workflow(
  async ({ entry }) => {
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
  },
  {
    vars: defaults,
    summary: t.summaryPrompt,
    base: (entry, vars) => (entry === "review-gate.check" ? (vars.reviewBase ?? "") : undefined),
  },
)
