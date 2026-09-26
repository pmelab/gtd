import {
  added,
  agent,
  changed,
  deleted,
  history,
  human,
  judge,
  modified,
  read,
  refs,
  refuse,
  run,
  scope,
  sections,
  stepName,
  tail,
  type JudgeQuestion,
} from "./runtime.js"

// Reusable pieces of the bundled workflow. Each takes its texts, caps and
// callbacks as arguments and never reads `vars`. The step names a fragment
// declares are its public API: renaming one breaks every process resting on
// it, so a rename is a breaking change.

/** Text computed when its step is reached. */
export type Text = () => string

export interface AgentSpec {
  readonly prompt: Text
  readonly label?: string
  readonly file?: string
  readonly mode?: string
  readonly requireProgress?: boolean
  readonly skills?: Text
  readonly model?: Text
  readonly system?: Text
}

export interface HumanSpec {
  readonly message: Text
  readonly label?: string
  readonly file?: string
  readonly mode?: string
  readonly answerGate?: boolean
}

export interface RunSpec {
  readonly script: Text
  readonly label?: string
}

export interface JudgeSpec {
  readonly message: Text
  readonly label?: string
}

const FEEDBACK = ".gtd/FEEDBACK.md"

const wrote = (path: string): boolean => added(path).length > 0 || modified(path).length > 0

const agentStep = (name: string, spec: AgentSpec, allowEmpty = false): Promise<void> =>
  agent(name, spec.prompt(), {
    label: spec.label,
    file: spec.file,
    mode: spec.mode,
    requireProgress: spec.requireProgress,
    skills: spec.skills?.(),
    model: spec.model?.(),
    system: spec.system?.(),
    allowEmpty,
  })

const humanStep = (name: string, spec: HumanSpec, acceptClean = false): Promise<void> =>
  human(name, {
    message: spec.message(),
    label: spec.label,
    file: spec.file,
    mode: spec.mode,
    answerGate: spec.answerGate,
    acceptClean,
  })

/** Refuse a landing none of a step's expected outcomes explains. */
export const noMatch = (name: string, expected: readonly string[]): never =>
  refuse(
    `gtd land: no declared pattern matches the pending changes at "${stepName(name)}" — declared patterns: ${expected.join(", ")}`,
  )

/**
 * Run the suite as step `name`. Red means the run added or rewrote
 * `.gtd/FEEDBACK.md`; resolves `true` when it did not.
 */
export const green = async (name: string, check: RunSpec): Promise<boolean> => {
  await run(name, check.script(), { label: check.label })
  return !wrote(FEEDBACK)
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface EscalationTexts {
  /** Takes the scoped name of the describe step, whose subjects it counts. */
  readonly escalate: { readonly script: (describeStep: string) => string; readonly label: string }
  readonly describe: AgentSpec
  readonly stop: HumanSpec
  readonly exhausted: HumanSpec
}

/**
 * Hand a red suite that repeated attempts could not fix to a person: an
 * agent writes `.gtd/ESCALATION.md`, a human narrows it. The second round is
 * `health.exhausted` instead. Steps: `health.escalate`, `health.describe`,
 * `health.stop`, `health.exhausted`.
 */
export const escalation = async (texts: EscalationTexts): Promise<void> => {
  await run("health.escalate", texts.escalate.script(stepName("health.describe")), {
    label: texts.escalate.label,
  })
  if (wrote(".gtd/ESCALATION.md")) {
    await humanStep("health.exhausted", texts.exhausted, true)
    return
  }
  await agentStep("health.describe", texts.describe, true)
  await humanStep("health.stop", texts.stop, true)
}

export interface HealthTexts {
  readonly check: RunSpec
  readonly judge: JudgeSpec
  readonly escalation: EscalationTexts
}

export interface HealthOptions {
  readonly texts: HealthTexts
  /** The caller's fix turn, run on every red round. */
  readonly fix: () => Promise<void>
  /** Fix turns allowed before escalating instead. */
  readonly cap: number
  /** Fix turns already spent on this red streak before the first check. */
  readonly fixesSoFar?: number
  /** The confidence an "identical" verdict needs to escalate early. */
  readonly identicalMinP: number
}

const STAMP = /\n<!-- gtd check [0-9a-f]+ -->\n?$/
const stripStamp = (text: string): string => text.replace(STAMP, "\n")

/**
 * Evidence for "is this red round the same failure as the last one?" — two
 * bounded tails, unless the bound made them unusable: an empty cut, or cuts
 * that match while the whole reports differ, never read as sameness.
 */
const retryJudgment = (previousWhole: string) => {
  const current = stripStamp(tail(FEEDBACK, 0.5))
  const previous = stripStamp(tail(previousWhole, 0.5))
  const notComparable =
    current === "" ||
    previous === "" ||
    (current === previous && stripStamp(read(FEEDBACK) ?? "") !== stripStamp(previousWhole))
  const question: JudgeQuestion = {
    id: "verdict",
    primitive: "choice",
    instructions: notComparable
      ? "state carries tailsNotComparable: the two bounded tails came back unusable as evidence (see criteria). There is nothing to compare here; answer from criteria alone."
      : "Compare this round's failing check output (current) against the previous round's (previous), both in state. Classify the change.",
    criteria: notComparable
      ? "state carries tailsNotComparable instead of current/previous: the two bounded tails are not usable evidence (one came back empty, or both matched only because the cut tails agree while the two full reports actually differ). identical is FORBIDDEN here — answer new-failure or progress instead, defaulting to progress if genuinely unsure."
      : "identical: the same failure restated, byte-for-byte or the same root cause — the trailing `<!-- gtd check <sha> -->` stamp is already stripped from both, but ignore it too if it ever reappears. new-failure: a materially different symptom than previous. progress: still red, but measurably closer to green (fewer failures, a later stage reached).",
  }
  return {
    question,
    evidence: notComparable ? { tailsNotComparable: true } : { current, previous },
  }
}

/**
 * Loop until the suite is green: check, and on red either fix or — once the
 * fix cap is spent, or a judge calls the failure identical to the previous
 * round's — escalate first. Steps: `health.check`, `health.judge`, and
 * `escalation`'s.
 */
export const healthy = async (options: HealthOptions): Promise<void> => {
  let fixes = options.fixesSoFar ?? 0
  for (;;) {
    if (await green("health.check", options.texts.check)) return
    const previous = history.previous(FEEDBACK, { since: "health.check" })
    let stuck = false
    if (previous !== undefined) {
      const { question, evidence } = retryJudgment(previous)
      const verdict = await judge("health.judge", question, evidence, {
        message: options.texts.judge.message(),
        label: options.texts.judge.label,
        minP: options.identicalMinP,
      })
      stuck = verdict === "identical"
    }
    if (stuck || fixes >= options.cap) {
      await escalation(options.texts.escalation)
      fixes = 0
    }
    fixes++
    await options.fix()
  }
}

// ── Gates ───────────────────────────────────────────────────────────────────

export interface EntryGateTexts {
  readonly check: RunSpec
  readonly blocked: HumanSpec
}

/** Hold the process at `blocked` until the suite is green. Steps: `check`, `blocked`. */
export const entryGate = async (texts: EntryGateTexts): Promise<void> => {
  while (!(await green("check", texts.check))) {
    await humanStep("blocked", texts.blocked)
  }
}

export interface QuestionGateTexts {
  readonly check: RunSpec
  readonly answer: HumanSpec
}

/**
 * Stop for a human only while the steering file still has open questions.
 * Resolves `true` when the human answered (the author revises), `false` when
 * no question was left. Steps: `gate.check`, `gate.answer`.
 */
export const questionGate = async (texts: QuestionGateTexts): Promise<boolean> => {
  await run("gate.check", texts.check.script(), { label: texts.check.label })
  if (!wrote(".gtd/QUESTIONS.md")) return false
  await humanStep("gate.answer", texts.answer, true)
  return true
}

/** An author turn and its question gate, repeated until no question is left. Steps: `name` and `questionGate`'s. */
export const designLoop = async (
  name: string,
  author: AgentSpec,
  gate: QuestionGateTexts,
): Promise<void> => {
  do {
    await agentStep(name, author)
  } while (await questionGate(gate))
}

// ── The per-package queue ───────────────────────────────────────────────────

export interface SpecReviewTexts {
  readonly pre: JudgeSpec
  readonly scoping: RunSpec
  readonly review: AgentSpec
}

const MAX_SECTIONS = 8

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Where heading `title` sits in `text` at or after `from`, matched per word so setext and oddly spaced ATX headings are found. */
const findTitleOffset = (text: string, title: string, from: number): number => {
  const words = title.split(/\s+/).filter(Boolean).map(escapeRegExp)
  if (words.length === 0) return -1
  const re = new RegExp(`^(?:#{1,6}[ \\t]+)?${words.join("\\s+")}(?:[ \\t]+#{1,6})?[ \\t]*$`, "m")
  const m = re.exec(text.slice(from))
  return m ? from + m.index : -1
}

/**
 * Which headings of `whole` survive in a tail cut starting at `tailStart`,
 * read off byte position — a second heading parse of the cut text would
 * mis-read a fence straddling the cut. A heading not found is treated as
 * surviving, never as truncated.
 */
const survivors = (whole: string, titles: readonly string[], tailStart: number): boolean[] => {
  let searchFrom = 0
  return titles.map((title) => {
    const idx = findTitleOffset(whole, title, searchFrom)
    if (idx === -1) return true
    const nl = whole.indexOf("\n", idx)
    searchFrom = nl === -1 ? whole.length : nl + 1
    return idx >= tailStart
  })
}

const structural = (id: string, instructions: string): JudgeQuestion => ({
  id,
  primitive: "noul",
  instructions,
  criteria: "Structural, not a judgment call — no is the only correct answer.",
})

/** One noul per `## ` section, padded to a fixed eight slots so a partial verdict can never approve an unanswered section. */
const specQuestions = (pkg: string, whole: string, tailText: string): JudgeQuestion[] => {
  const titles = sections(pkg)
  const survives = survivors(whole, titles, whole.length - tailText.length)
  const questions: JudgeQuestion[] = []
  for (let i = 0; i < MAX_SECTIONS; i += 1) {
    const id = `section-${i + 1}`
    const title = titles[i]
    if (titles.length > MAX_SECTIONS) {
      questions.push(
        structural(
          id,
          "This package has more `## ` sections than this gate can judge (max 8) — always answer no, never yes: a confident approval here would silently skip review of the sections beyond the eighth.",
        ),
      )
    } else if (title !== undefined && !survives[i]) {
      questions.push({
        id,
        primitive: "noul",
        instructions: `Section "${title}": the evidence for this section was truncated away.`,
        criteria:
          "Always answer the conservative value, never the approving one: no (not yet satisfied), never yes.",
      })
    } else if (title !== undefined) {
      questions.push({
        id,
        primitive: "noul",
        instructions: `Is the requirement "${title}" already fully satisfied by the code on the range from ${refs.start} to the working tree?`,
        criteria:
          "Judge from the package markdown plus that range, read yourself. Only answer yes at a probability clearing the threshold below if genuinely confident nothing in this section is missing.",
      })
    } else if (titles.length === 0) {
      questions.push(
        structural(
          id,
          "This package has no `## ` sections at all — there is nothing to judge. Always answer no, never yes: a confident approval here would silently skip the only review this package would ever get.",
        ),
      )
    } else {
      questions.push({
        id,
        primitive: "noul",
        instructions:
          "Padding slot: this package has fewer than 8 `## ` sections. There is no corresponding requirement.",
        criteria: "Always answer yes at p 1 — nothing to evaluate.",
      })
    }
  }
  return questions
}

/**
 * Review one freshly built package against its spec: a pre-judge per
 * section, a scoping check that decides from the recorded verdict, then an
 * agent review unless everything cleared. Resolves `true` when approved.
 * Steps: `spec.pre`, `spec.scoping`, `spec.review`.
 */
export const specReview = async (texts: SpecReviewTexts): Promise<boolean> => {
  const pkg = (read(".gtd/NEXT.md") ?? "").trim()
  const whole = read(pkg) ?? ""
  const tailText = tail(pkg, 1)
  await judge(
    "spec.pre",
    specQuestions(pkg, whole, tailText),
    { package: tailText },
    {
      message: texts.pre.message(),
      label: texts.pre.label,
    },
  )
  await run("spec.scoping", texts.scoping.script(), { label: texts.scoping.label })
  if (added(".gtd/SPEC_CLEARED.md").length > 0) return true
  await agentStep("spec.review", texts.review, true)
  if (wrote(".gtd/SPEC_FEEDBACK.md")) return false
  if (deleted(".gtd/SPEC_FEEDBACK.md").length > 0 || changed().length === 0) return true
  return noMatch("spec.review", [
    "A .gtd/SPEC_FEEDBACK.md",
    "M .gtd/SPEC_FEEDBACK.md",
    "D .gtd/SPEC_FEEDBACK.md",
    "C",
  ])
}

export interface PackageTexts {
  readonly picking: RunSpec
  readonly building: AgentSpec
  readonly fixSuite: AgentSpec
  readonly fixSpec: AgentSpec
  readonly closing: RunSpec
  readonly health: HealthTexts
  readonly spec: SpecReviewTexts
}

export interface PackageOptions {
  readonly fixCap: number
  readonly identicalMinP: number
}

/**
 * Build every package file under `.gtd/packages/` in turn: pick one into
 * `.gtd/NEXT.md`, build it, keep the suite green, review it against its spec,
 * close it out. Steps: `picking`, `item.building`, `item.fix-suite`,
 * `item.fix-spec`, `item.closing`, and `item.`-prefixed `healthy`/`specReview`.
 */
export const packageQueue = async (texts: PackageTexts, options: PackageOptions): Promise<void> => {
  for (;;) {
    await run("picking", texts.picking.script(), { label: texts.picking.label })
    if (!wrote(".gtd/NEXT.md")) return
    await scope("item", () => packageItem(texts, options))
  }
}

const packageItem = async (texts: PackageTexts, options: PackageOptions): Promise<void> => {
  await agentStep("building", texts.building)
  for (;;) {
    await healthy({
      texts: texts.health,
      fix: () => agentStep("fix-suite", texts.fixSuite),
      cap: options.fixCap,
      identicalMinP: options.identicalMinP,
    })
    if (await specReview(texts.spec)) break
    await agentStep("fix-spec", texts.fixSpec)
  }
  await run("closing", texts.closing.script(), { label: texts.closing.label })
}

// ── Quality lap ─────────────────────────────────────────────────────────────

export interface QualityTexts {
  readonly seeding: RunSpec
  readonly picking: RunSpec
  readonly reviewing: AgentSpec
}

/**
 * One review turn per configured lens over the whole change. Resolves
 * `"findings"` when a lens wrote `.gtd/QUALITY.md`. Steps: `quality.seeding`,
 * `quality.picking`, `quality.reviewing`.
 */
export const qualityLap = async (texts: QualityTexts): Promise<"clean" | "findings"> => {
  await run("quality.seeding", texts.seeding.script(), { label: texts.seeding.label })
  if (changed(".gtd/reviews/**").length === 0) return "clean"
  for (;;) {
    await run("quality.picking", texts.picking.script(), { label: texts.picking.label })
    if (!wrote(".gtd/NEXT_REVIEW.md")) {
      return added(".gtd/QUALITY_READY.md").length > 0 ? "findings" : "clean"
    }
    await agentStep("quality.reviewing", texts.reviewing, true)
  }
}

// ── Human review ────────────────────────────────────────────────────────────

export interface ReviewTexts {
  readonly reviewing: AgentSpec
  readonly awaitReview: HumanSpec
  readonly deciding: RunSpec
  readonly missing: HumanSpec
  readonly triage: JudgeSpec
  readonly triaging: RunSpec
  readonly collecting: AgentSpec
}

/** One noul per `## ` chunk of `.gtd/REVIEW.md`: is its note actionable? */
const triageQuestions = (whole: string, tailText: string): JudgeQuestion[] => {
  const chunks = sections(".gtd/REVIEW.md")
  const survives = survivors(whole, chunks, whole.length - tailText.length)
  return chunks.map((title, i) =>
    survives[i]
      ? {
          id: `chunk-${i + 1}`,
          primitive: "noul",
          instructions: `Is the note under review chunk "${title}" (in .gtd/REVIEW.md) actionable — anything beyond an approving remark with no code edit?`,
          criteria:
            "A concrete request, a question, a code comment, or a hand-edit under this chunk answers yes. No note, or a purely approving remark, answers no.",
        }
      : {
          id: `chunk-${i + 1}`,
          primitive: "noul",
          instructions: `Review chunk "${title}" (in .gtd/REVIEW.md): the evidence for this section was truncated away.`,
          criteria:
            "Always answer the conservative value, never the approving one: yes (actionable), never no.",
        },
  )
}

const collect = async (texts: ReviewTexts): Promise<"signoff" | "feedback"> => {
  await agentStep("review.collecting", texts.collecting)
  if (wrote(".gtd/REQUIREMENTS.md")) return "feedback"
  if (deleted(".gtd/REVIEW_RAW.md").length > 0) return "signoff"
  return noMatch("review.collecting", [
    "A .gtd/REQUIREMENTS.md",
    "M .gtd/REQUIREMENTS.md",
    "D .gtd/REVIEW_RAW.md",
  ])
}

/**
 * A reviewer writes `.gtd/REVIEW.md`, a human reviews and signs off or
 * comments, and a comment is classified into requirements for another lap.
 * Resolves `"signoff"` or `"feedback"`. Steps: `review.reviewing`,
 * `review.await-review`, `review.deciding`, `review.review-missing`,
 * `review.triage`, `review.triaging`, `review.collecting`.
 */
/** A note-only round: judge whether it asks for anything, and sign off when it does not. */
const triage = async (texts: ReviewTexts): Promise<"signoff" | "feedback"> => {
  const whole = read(".gtd/REVIEW.md") ?? ""
  const tailText = tail(".gtd/REVIEW.md", 1)
  await judge(
    "review.triage",
    triageQuestions(whole, tailText),
    { review: tailText },
    { message: texts.triage.message(), label: texts.triage.label },
  )
  await run("review.triaging", texts.triaging.script(), { label: texts.triaging.label })
  if (deleted(".gtd/REVIEW.md").length > 0 && added(".gtd/REVIEW_RAW.md").length === 0)
    return "signoff"
  return collect(texts)
}

export const reviewTail = async (texts: ReviewTexts): Promise<"signoff" | "feedback"> => {
  for (;;) {
    await agentStep("review.reviewing", texts.reviewing)
    await humanStep("review.await-review", texts.awaitReview)
    await run("review.deciding", texts.deciding.script(), {
      label: texts.deciding.label,
      file: ".gtd/REVIEW.md",
      mode: "review",
      reviewBase: true,
    })
    if (!wrote(FEEDBACK)) {
      if (wrote(".gtd/REVIEW_RAW.md")) return collect(texts)
      if (added(".gtd/REVIEW_NOTE.md").length > 0) return triage(texts)
      if (deleted(".gtd/REVIEW.md").length > 0) return "signoff"
    }
    await humanStep("review.review-missing", texts.missing)
  }
}
