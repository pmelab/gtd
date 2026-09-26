import {
  designLoop,
  entryGate,
  escalation,
  green,
  healthy,
  noMatch,
  packageQueue,
  qualityLap,
  reviewTail,
  type AgentSpec,
  type EscalationTexts,
  type HealthTexts,
} from "./fragments.js"
import {
  added,
  agent,
  changed,
  deleted,
  human,
  judge,
  modified,
  run,
  scope,
  tail,
  vars,
  workflow,
} from "./runtime.js"
import * as t from "./unified/text.js"
import { defaults } from "./unified/vars.js"

// gtd's built-in default workflow. Any change to the tree starts a process:
// `idle` → `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design, architecture and one package per concern →
// the quality lap → human review, which signs off (the episode ends back at
// `idle`) or sends a full re-plan lap. `--entry review-gate.check --var
// reviewBase=<commitish>` and `--entry fix-precheck` enter the same flow.

/** A `vars:` probability threshold; blank or non-numeric can never be cleared. */
const threshold = (value: string | undefined): number => {
  const n = Number(value)
  return value === undefined || value.trim() === "" || !Number.isFinite(n) ? Infinity : n
}

const planner = { model: () => vars.plannerModel ?? "" }
const coder = { model: () => vars.coderModel ?? "" }

const FIX_CAP = 3

const escalationTexts: EscalationTexts = {
  escalate: { script: t.escalateScript, label: "Counting escalation rounds" },
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

const fix = (): Promise<void> =>
  agent("fix", buildFix.prompt(), {
    label: buildFix.label,
    file: buildFix.file,
    skills: buildFix.skills?.(),
    model: buildFix.model?.(),
    system: buildFix.system?.(),
  })

const buildHealth = (fixesSoFar: number): Promise<void> =>
  healthy({
    texts: healthTexts,
    fix,
    cap: FIX_CAP,
    fixesSoFar,
    identicalMinP: threshold(vars.judgeIdenticalMinP),
  })

/** Resolves `true` once `.gtd/QUALITY.md` is resolved, `false` when the fix cap escalated instead. */
const fixQualityFindings = async (): Promise<boolean> => {
  for (let entries = 0; entries < FIX_CAP; entries++) {
    await agent("fix-quality", fixQuality.prompt(), {
      label: fixQuality.label,
      file: fixQuality.file,
      skills: fixQuality.skills?.(),
      model: fixQuality.model?.(),
      system: fixQuality.system?.(),
      allowEmpty: true,
    })
    if (deleted(".gtd/QUALITY.md").length > 0) return true
  }
  await escalation(escalationTexts)
  return false
}

const review = (): Promise<"signoff" | "feedback"> =>
  reviewTail({
    reviewing: {
      prompt: t.buildReviewReviewingPrompt,
      label: "Reviewing",
      file: ".gtd/REVIEW.md",
      mode: "review",
      skills: () => vars.reviewSkills ?? "",
      model: planner.model,
      system: t.reviewerSystem,
    },
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
    triaging: { script: t.buildReviewTriagingScript, label: "Filtering non-actionable feedback" },
    collecting: {
      prompt: t.buildReviewCollectingPrompt,
      label: "Collecting your feedback",
      file: ".gtd/REQUIREMENTS.md",
      mode: "qa",
      model: planner.model,
      system: t.reviewerSystem,
    },
  })

/** The build tail: fix (when entered red), keep green, the quality lap, then human review. */
const buildTail = (fixFirst: boolean): Promise<"signoff" | "feedback"> =>
  scope("build", async () => {
    let redFirst = fixFirst
    for (;;) {
      if (redFirst) {
        await fix()
        await buildHealth(1)
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
      if (lap === "clean") return review()
      if (await fixQualityFindings()) await buildHealth(0)
      else redFirst = true
    }
  })

const design = (): Promise<void> =>
  scope("design", () =>
    designLoop(
      "triage",
      {
        prompt: t.designTriagePrompt,
        label: "Triaging the change",
        file: ".gtd/REQUIREMENTS.md",
        mode: "qa",
        requireProgress: true,
        skills: () => vars.triageSkills ?? "",
        model: planner.model,
        system: t.designSystem,
      },
      {
        check: { script: t.questionCheckScript, label: "Checking for open questions" },
        answer: {
          message: t.designGateAnswerMessage,
          label: "Awaiting your product answers",
          file: ".gtd/REQUIREMENTS.md",
          mode: "qa",
          answerGate: true,
        },
      },
    ),
  )

const architecture = (): Promise<void> =>
  scope("architecture", async () => {
    await designLoop(
      "author",
      {
        prompt: t.architectureAuthorPrompt,
        label: "Refining the technical plan",
        file: ".gtd/ARCHITECTURE.md",
        mode: "qa",
        skills: () => vars.architectureSkills ?? "",
        model: planner.model,
        system: t.architectSystem,
      },
      {
        check: { script: t.questionCheckScript, label: "Checking for open questions" },
        answer: {
          message: t.architectureGateAnswerMessage,
          label: "Awaiting your technical answers",
          file: ".gtd/ARCHITECTURE.md",
          mode: "qa",
          answerGate: true,
        },
      },
    )
    await agent("decompose", t.architectureDecomposePrompt(), {
      label: "Decomposing into packages",
      skills: vars.decomposeSkills,
      model: vars.plannerModel,
      system: t.architectSystem(),
    })
    if (changed(".gtd/packages/**").length === 0) noMatch("decompose", ["* .gtd/packages/**"])
  })

/** Whether the settled plan needs its own architecture pass, or goes straight to one package. */
const architecturePass = async (): Promise<void> => {
  const warranted = await judge(
    "architecture-pre",
    {
      id: "architectureWarranted",
      primitive: "noul",
      instructions:
        "Given the settled concerns in `.gtd/REQUIREMENTS.md` (in state), does this plan warrant a dedicated architecture pass — real structural decisions, multiple integration points, or a non-obvious tradeoff — before packages are written?",
      criteria:
        "Answer yes if uncertain; a trivial, single-concern, mechanical plan with no real design decision answers no.",
    },
    { requirements: tail(".gtd/REQUIREMENTS.md", 1) },
    {
      message: t.architecturePreMessage(),
      label: "Judging whether this plan warrants an architecture pass",
      minP: threshold(vars.architectureSkipMinP),
    },
  )
  if (warranted === "no") {
    await run("architecture-promote", t.architecturePromoteScript(), {
      label: "Promoting the plan straight to a package",
    })
    if (changed().length > 0) return
  }
  await architecture()
}

const packages = (): Promise<void> =>
  scope("packages", () =>
    packageQueue(
      {
        picking: { script: t.packagesPickingScript, label: "Picking the next package" },
        building: {
          prompt: t.packagesItemBuildingPrompt,
          label: "Building",
          skills: () => vars.buildSkills ?? "",
          model: coder.model,
          system: t.builderSystem,
        },
        fixSuite: {
          prompt: t.packagesItemFixSuitePrompt,
          label: "Fixing the check",
          file: ".gtd/FEEDBACK.md",
          skills: () => vars.fixSkills ?? "",
          model: coder.model,
          system: t.builderSystem,
        },
        fixSpec: {
          prompt: t.packagesItemFixSpecPrompt,
          label: "Fixing review feedback",
          file: ".gtd/SPEC_FEEDBACK.md",
          skills: () => vars.reviewFixSkills ?? "",
          model: coder.model,
          system: t.builderSystem,
        },
        closing: { script: t.packagesItemClosingScript, label: "Closing out the package" },
        health: healthTexts,
        spec: {
          pre: { message: t.packagesItemSpecPreMessage, label: "Judging spec coverage" },
          scoping: {
            script: t.packagesItemSpecScopingScript,
            label: "Scoping the review to the failing sections",
          },
          review: {
            prompt: t.packagesItemSpecReviewPrompt,
            label: "Reviewing the package",
            skills: () => vars.specReviewSkills ?? "",
            model: planner.model,
            system: t.specReviewerSystem,
          },
        },
      },
      { fixCap: FIX_CAP, identicalMinP: threshold(vars.judgeIdenticalMinP) },
    ),
  )

/** Plan, build and review until a review round signs off; feedback re-plans from scratch. */
const planAndBuild = async (): Promise<void> => {
  for (;;) {
    await design()
    await architecturePass()
    await packages()
    if ((await buildTail(false)) === "signoff") return
    await reUnwind()
  }
}

const reUnwind = (): Promise<void> =>
  run("re-unwind", t.reUnwindScript(), {
    label: "Re-unwinding your review edit",
    file: ".gtd/REVIEW.md",
    requireRevert: true,
  })

const startGate = (): Promise<void> =>
  scope("start-gate", () =>
    entryGate({
      check: suiteCheck,
      blocked: {
        message: t.startGateBlockedMessage,
        label: "Baseline is red",
        file: ".gtd/FEEDBACK.md",
      },
    }),
  )

/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. */
const afterTail = async (verdict: "signoff" | "feedback"): Promise<void> => {
  if (verdict === "signoff") return
  await reUnwind()
  await planAndBuild()
}

export default workflow(
  {
    default: async () => {
      await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
      await run("unwind", t.unwindScript(), { label: "Unwinding your input" })
      if (added(".gtd/FEEDBACK.md").length > 0 || modified(".gtd/FEEDBACK.md").length > 0) {
        await human("unwind-failed", {
          message: t.unwindFailedMessage(),
          label: "Could not unwind your input",
          file: ".gtd/FEEDBACK.md",
        })
      }
      await startGate()
      await planAndBuild()
    },
    "fix-precheck": async () => {
      if (await green("fix-precheck", suiteCheck)) return
      await afterTail(await buildTail(true))
    },
    "review-gate.check": {
      flow: async () => {
        await scope("review-gate", () =>
          entryGate({
            check: suiteCheck,
            blocked: {
              message: t.reviewGateBlockedMessage,
              label: "Baseline is red",
              file: ".gtd/FEEDBACK.md",
            },
          }),
        )
        await afterTail(await buildTail(false))
      },
      base: (v) => v.reviewBase ?? "",
    },
    "start-gate.check": async () => {
      await startGate()
      await planAndBuild()
    },
  },
  { vars: defaults, summary: t.summaryPrompt },
)
