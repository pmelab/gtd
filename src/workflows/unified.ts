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

const collecting: AgentSpec = {
  prompt: t.buildReviewCollectingPrompt,
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

const building: AgentSpec = {
  prompt: () => t.withSkills(vars.buildSkills, t.packagesItemBuildingPrompt()),
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

const fixSpec: AgentSpec = {
  prompt: () => t.withSkills(vars.reviewFixSkills, t.packagesItemFixSpecPrompt()),
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

/**
 * The bundled agent steps by full step name — what the prompt evals enter one
 * at a time, with the same prompt and persona the workflow gives them. Steps
 * that review since a base see the process's own diff base here.
 */
export const agentSpecs: Readonly<Record<string, AgentSpec>> = {
  "build.review.reviewing": {
    ...reviewing,
    prompt: () => t.withSkills(vars.reviewSkills, t.buildReviewReviewingPrompt(start())),
  },
  "build.review.collecting": collecting,
  "design.triage": designTriage(start),
  "architecture.author": architectureAuthor,
  "packages.item.building": building,
  "packages.item.fix-suite": fixSuite,
  "packages.item.fix-spec": fixSpec,
  "packages.item.spec.review": {
    ...specReviewer,
    prompt: () => t.withSkills(vars.specReviewSkills, t.packagesItemSpecReviewPrompt()),
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

// A raw review capture an abandoned process left behind is swept by every
// check: no ordinary path from deciding or collecting reaches one.
const healthTexts: HealthTexts = {
  check: {
    command: testCommand,
    label: "Running checks",
    sweep: [".gtd/REVIEW_RAW.md"],
    // Swept only on green: an unresolved analysis survives every retry.
    sweepOnGreen: [".gtd/ESCALATION.md"],
  },
  judge: { message: t.healthJudgeMessage, label: "Judging the retry" },
  escalation: escalationTexts,
}

/** The quality lap's own state: its queue, the picked lens, its findings and markers. */
const QUALITY_STATE = [
  ".gtd/NEXT_REVIEW.md",
  ".gtd/QUALITY.md",
  ".gtd/QUALITY_DONE.md",
  ".gtd/QUALITY_READY.md",
  ".gtd/reviews",
]

// An entry is a new episode: the whole quality lap state goes, or a later
// entry would skip every lens.
const suiteCheck = {
  command: testCommand,
  label: "Checking the baseline",
  sweep: [".gtd/REVIEW_RAW.md", ...QUALITY_STATE],
}

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
      deciding: {
        label: "Reviewing",
        missing: t.reviewMissingFeedback,
        edits: t.reviewEditsCapture,
        note: t.reviewNoteCapture,
      },
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
        seeding: {
          label: "Seeding the quality review queue",
          lenses: () =>
            (vars.qualityReviews ?? "")
              .split(",")
              .map((lens) => lens.trim())
              .filter((lens) => lens !== ""),
        },
        picking: { label: "Picking the next quality lens" },
        reviewing: {
          prompt: () =>
            t.withSkills(t.buildQualityReviewingSkills(), t.buildQualityReviewingPrompt()),
          label: "Reviewing (one quality lens)",
          file: ".gtd/NEXT_REVIEW.md",
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
        check: questionCheck,
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

// architecture.author deletes REQUIREMENTS.md in the turn it writes
// ARCHITECTURE.md, so exactly one of them is there to check.
const questionCheck = {
  label: "Checking for open questions",
  file: () =>
    read(".gtd/REQUIREMENTS.md") !== undefined ? ".gtd/REQUIREMENTS.md" : ".gtd/ARCHITECTURE.md",
}

const architecture = (): Promise<void> =>
  scope("architecture", async () => {
    await designLoop("author", architectureAuthor, {
      check: questionCheck,
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
  if (skip) {
    const plan = read(".gtd/REQUIREMENTS.md")
    const target = `.gtd/packages/01-${slug(sections(plan ?? "")[0] ?? "")}.md`
    await run(
      "architecture-promote",
      ({ fs }) => {
        if (plan === undefined) return
        fs.write(target, plan)
        fs.rm(".gtd/REQUIREMENTS.md")
      },
      { label: "Promoting the plan straight to a package" },
    )
    if (plan !== undefined) return
  }
  await architecture()
}

const packages = (): Promise<void> =>
  scope("packages", () =>
    packageQueue(
      {
        picking: {
          label: "Picking the next package",
          // The spent design/architecture files, a loop-back's raw capture,
          // and the quality lap's state, so a loop-back re-runs the lap.
          sweep: [
            ".gtd/REQUIREMENTS.md",
            ".gtd/ARCHITECTURE.md",
            ".gtd/QUESTIONS.md",
            ".gtd/REVIEW_RAW.md",
            ...QUALITY_STATE,
          ],
        },
        building,
        fixSuite,
        fixSpec,
        closing: {
          label: "Closing out the package",
          sweep: [".gtd/SPEC_FEEDBACK.md", ".gtd/SATISFIED.md"],
        },
        health: healthTexts,
        spec: {
          pre: { message: t.packagesItemSpecPreMessage, label: "Judging spec coverage" },
          review: {
            ...specReviewer,
            prompt: (failing) =>
              t.withSkills(vars.specReviewSkills, t.packagesItemSpecReviewPrompt(failing)),
          },
          clearMinP: threshold(vars.specPreJudge),
        },
      },
      { fixCap: FIX_CAP, identicalMinP: threshold(vars.judgeIdenticalMinP) },
    ),
  )

// ── The flow ────────────────────────────────────────────────────────────────

/** Undo the human's review-round code edit, so planning reads it from history. */
/**
 * Undo the human's review-round code edits. Only a path still exactly as the
 * human left it is reverted; one changed since is left for requireRevert to
 * name, never overwritten.
 */
const reUnwind = async (feedback: Extract<ReviewOutcome, { verdict: "feedback" }>) => {
  const { base, edited } = feedback
  await run(
    "re-unwind",
    async ({ sh, fs }) => {
      const untouched = edited.filter((c) => fs.read(c.path) === c.after)
      fs.rm(...untouched.filter((c) => c.status === "added").map((c) => c.path))
      const restored = untouched.filter((c) => c.status !== "added").map((c) => shellQuote(c.path))
      if (restored.length > 0) await sh(`git checkout ${base}~1 -- ${restored.join(" ")}`)
    },
    { label: "Re-unwinding your review edit", file: ".gtd/REVIEW.md", base },
  )
  requireRevert(edited, base)
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

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

/**
 * Revert the sketch that started the process out of the tree; its intent
 * survives in history. A failed revert is written to FEEDBACK.md, since a
 * failure and a genuine no-op can both leave the tree clean.
 */
const unwind = (): Promise<void> => {
  const commit = head()
  return run(
    "unwind",
    async ({ sh, fs }) => {
      const { ok, code, output } = await sh(`git revert --no-commit ${commit}`)
      if (ok) return
      fs.write(".gtd/FEEDBACK.md", t.unwindFailure(commit, code, output))
    },
    { label: "Unwinding your input" },
  )
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
