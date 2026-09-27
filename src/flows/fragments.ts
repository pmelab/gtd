import {
  agent,
  changes,
  glob,
  head,
  human,
  judge,
  openQuestions,
  read,
  refuse,
  run,
  scope,
  sections,
  start,
  type Change,
  type JudgeAnswer,
  type JudgeQuestion,
} from "./runtime.js"
import { checkScript } from "./scripts.js"

// Reusable pieces of the bundled workflow. Each takes its texts, caps and
// thresholds as arguments and never reads `vars`. The step names a fragment
// declares are its public API: renaming one breaks every process resting on
// it, so a rename is a breaking change.

/** Text computed when its step is reached. */
export type Text = () => string

export interface AgentSpec {
  readonly prompt: Text
  readonly label?: string | undefined
  readonly file?: string
  readonly mode?: string
  readonly model?: Text
  readonly system?: Text
}

export interface HumanSpec {
  readonly message: Text
  readonly label?: string | undefined
  readonly file?: string
  readonly mode?: string
}

/** A run of the test suite: red leaves the output in `.gtd/FEEDBACK.md`. */
export interface CheckSpec {
  readonly command: Text
  readonly label?: string | undefined
  /** Paths removed before the suite runs. */
  readonly sweep?: readonly string[] | undefined
  /** Paths removed once it is green. */
  readonly sweepOnGreen?: readonly string[] | undefined
}

/** A bookkeeping step: only its label is text. */
export interface StepLabel {
  readonly label?: string | undefined
}

export interface JudgeTexts {
  readonly message: Text
  readonly label?: string | undefined
}

const FEEDBACK = ".gtd/FEEDBACK.md"
const REVIEW = ".gtd/REVIEW.md"
const QUESTIONS = ".gtd/QUESTIONS.md"
const NEXT = ".gtd/NEXT.md"

/** Whether the last step added or rewrote `path`. */
const wrote = (path: string): boolean => changes(path).some((c) => c.status !== "deleted")

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

const agentStep = (
  name: string,
  spec: AgentSpec,
  extra: { readonly allowEmpty?: boolean; readonly base?: string } = {},
): Promise<void> =>
  agent(name, spec.prompt(), {
    label: spec.label,
    file: spec.file,
    mode: spec.mode,
    model: spec.model?.(),
    system: spec.system?.(),
    ...extra,
  })

const humanStep = (
  name: string,
  spec: HumanSpec,
  extra: { readonly acceptClean?: boolean; readonly base?: string } = {},
): Promise<void> =>
  human(name, {
    message: spec.message(),
    label: spec.label,
    file: spec.file,
    mode: spec.mode,
    ...extra,
  })

/** Whether a judge answered `question` with `answer` at a probability of at least `minP`. */
export const answered = (
  answer: JudgeAnswer | undefined,
  expected: string,
  minP: number,
): boolean => answer !== undefined && answer.answer === expected && answer.p >= minP

/** `.gtd/<name>` stamped with the commit it was written at, so a repeat of the same report still changes the file. */
const stamped = (text: string, commit: string): string =>
  `${text}\n<!-- gtd check ${commit.slice(0, 7)} -->\n`

export interface CheckOptions {
  /** Where a failing run leaves its output. */
  readonly report: string
  readonly label?: string | undefined
  /** Paths removed before the command runs. */
  readonly sweep?: readonly string[] | undefined
  /** Paths removed once it passes. */
  readonly sweepOnGreen?: readonly string[] | undefined
}

/**
 * A step that runs `command` through the driver and keeps its outcome in the
 * tree: a failure writes `report`, a pass removes it. Resolves `true` when the
 * command passed.
 */
export const check = async (
  name: string,
  command: string,
  options: CheckOptions,
): Promise<boolean> => {
  const { report, label, sweep, sweepOnGreen } = options
  await run(
    name,
    checkScript(command, { report, stamp: head().slice(0, 7), sweep, sweepOnGreen }),
    {
      label,
    },
  )
  return !wrote(report)
}

/** Run the suite as step `name`; resolves `true` when it passed. A failure is in `.gtd/FEEDBACK.md`. */
export const green = (name: string, spec: CheckSpec): Promise<boolean> =>
  check(name, spec.command(), {
    report: FEEDBACK,
    label: spec.label,
    sweep: spec.sweep,
    sweepOnGreen: spec.sweepOnGreen,
  })

// ── Guards ──────────────────────────────────────────────────────────────────

/** Refuse a turn whose only change deletes `file` — unless it says it found nothing to do. */
export const requireProgress = (file: string): void => {
  const change = changes().get(file)
  if (change?.status !== "deleted") return
  if (changes().some((c) => isCode(c.path))) return
  if ((change.before ?? "").trim().startsWith("NOTHING ACTIONABLE")) return
  refuse(
    `gtd land: feedback-progress: ${file} was deleted without addressing its instructions — implement the changes it lists (then delete it), don't just remove the file.`,
  )
}

/** Refuse a turn that leaves a question in `file` unanswered. An untouched tree is silence, and allowed. */
export const requireAnswers = (file: string): void => {
  if (changes().length === 0) return
  const open = openQuestions(read(file) ?? "")
  if (open.length === 0) return
  const list = open.map((q) => `  - ${file}:${q.line}: ${q.question}`).join("\n")
  refuse(
    `gtd land: answer-completeness: ${open.length} open question(s) in ${file} not answered — tick exactly one option per question, or delete a question you don't want to answer. To accept the plan as-is instead, revert everything and re-run:\n${list}`,
  )
}

/** Refuse a turn that did not undo the code edits `edited` recorded, back to their content before `base`. */
export const requireRevert = (edited: readonly Change[], base: string): void => {
  const residue = edited.filter((c) => read(c.path) !== c.before).map((c) => c.path)
  if (residue.length === 0) return
  const quoted = residue.map((path) => `'${path.replace(/'/g, "'\\''")}'`).join(" ")
  refuse(
    `gtd land: require-revert: ${residue.join(", ")} still differ from ${base}~1 — the revert did not take. Run \`git checkout ${base}~1 -- ${quoted}\`, then \`gtd land\` again.`,
  )
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface EscalationTexts {
  readonly describe: AgentSpec
  readonly stop: HumanSpec
  readonly exhausted: HumanSpec
}

/** How many escalation rounds a run of red checks has spent — reset once the suite goes green. */
export interface EscalationCount {
  rounds: number
}

/**
 * Hand a red suite that repeated attempts could not fix to a person: an
 * agent writes `.gtd/ESCALATION.md`, a human narrows it. From the third round
 * on, the human is told the budget is spent instead. Steps: `health.describe`,
 * `health.stop`, `health.exhausted`.
 */
export const escalation = async (texts: EscalationTexts, count: EscalationCount): Promise<void> => {
  if (count.rounds >= 2) {
    await humanStep("health.exhausted", texts.exhausted, { acceptClean: true })
    return
  }
  count.rounds++
  await agentStep("health.describe", texts.describe, { allowEmpty: true })
  await humanStep("health.stop", texts.stop, { acceptClean: true })
}

export interface HealthTexts {
  readonly check: CheckSpec
  readonly judge: JudgeTexts
  readonly escalation: EscalationTexts
}

export interface HealthOptions {
  readonly texts: HealthTexts
  /** The caller's fix turn, run on every red round. */
  readonly fix: () => Promise<void>
  /** Fix turns allowed before escalating. */
  readonly cap: number
  /** Fix turns already spent before this call. */
  readonly fixesSoFar?: number
  /** The confidence an "identical" verdict needs to escalate early. */
  readonly identicalMinP: number
  /** Escalation rounds shared with other callers in the same run of red checks. */
  readonly escalations?: EscalationCount
}

const STAMP = /\n<!-- gtd check [0-9a-f]+ -->\n?$/
const stripStamp = (text: string): string => text.replace(STAMP, "\n")

/** "Is this red round the same failure as the last one?" — asked of two reports, or of nothing when one is empty. */
const retryQuestion = (comparable: boolean): JudgeQuestion =>
  comparable
    ? {
        id: "verdict",
        primitive: "choice",
        instructions:
          "Compare this round's failing check output (current) against the previous round's (previous), both in state. Classify the change.",
        criteria:
          "identical: the same failure restated, byte-for-byte or the same root cause — the trailing `<!-- gtd check <sha> -->` stamp is already stripped from both, but ignore it too if it ever reappears. new-failure: a materially different symptom than previous. progress: still red, but measurably closer to green (fewer failures, a later stage reached).",
      }
    : {
        id: "verdict",
        primitive: "choice",
        instructions:
          "state carries tailsNotComparable: one of the two check reports came back empty. There is nothing to compare here; answer from criteria alone.",
        criteria:
          "identical is FORBIDDEN here — answer new-failure or progress instead, defaulting to progress if genuinely unsure.",
      }

/**
 * Loop until the suite is green: check, and on red either fix or — once the
 * fix cap is spent, or a judge calls the failure identical to the previous
 * round's — escalate first. Steps: `health.check`, `health.judge`, and
 * `escalation`'s.
 */
export const healthy = async (options: HealthOptions): Promise<void> => {
  const escalations = options.escalations ?? { rounds: 0 }
  let fixes = options.fixesSoFar ?? 0
  let previous: string | undefined
  for (;;) {
    if (await green("health.check", options.texts.check)) {
      escalations.rounds = 0
      return
    }
    const current = stripStamp(read(FEEDBACK) ?? "")
    const stuck = previous !== undefined && (await sameFailure(options, previous, current))
    previous = current
    if (stuck || fixes >= options.cap) {
      await escalation(options.texts.escalation, escalations)
      fixes = 0
    }
    fixes++
    await options.fix()
  }
}

const sameFailure = async (
  options: HealthOptions,
  previous: string,
  current: string,
): Promise<boolean> => {
  const comparable = current.trim() !== "" && previous.trim() !== ""
  const { answers, truncated } = await judge("health.judge", {
    questions: [retryQuestion(comparable)],
    evidence: comparable ? { current, previous } : { tailsNotComparable: "true" },
    message: options.texts.judge.message(),
    label: options.texts.judge.label,
  })
  // Evidence the budget cut can make two different reports look alike: never sameness.
  return (
    comparable &&
    truncated.length === 0 &&
    answered(answers.verdict, "identical", options.identicalMinP)
  )
}

// ── Gates ───────────────────────────────────────────────────────────────────

export interface EntryGateTexts {
  readonly check: CheckSpec
  readonly blocked: HumanSpec
}

/** Hold the process at `blocked` until the suite is green. Steps: `check`, `blocked`. */
export const entryGate = async (texts: EntryGateTexts): Promise<void> => {
  while (!(await green("check", texts.check))) {
    await humanStep("blocked", texts.blocked)
  }
}

export interface QuestionGateTexts {
  /** `file`: the steering file whose open questions stop the process. */
  readonly check: StepLabel & { readonly file: Text }
  readonly answer: HumanSpec & { readonly file: string }
}

/**
 * Stop for a human only while the steering file still has open questions.
 * Resolves `true` when the human answered (the author revises), `false` when
 * no question was left. Steps: `gate.check`, `gate.answer`.
 */
export const questionGate = async (texts: QuestionGateTexts): Promise<boolean> => {
  const file = texts.check.file()
  const content = read(file)
  const open = content === undefined || openQuestions(content).length > 0
  const commit = head()
  await run(
    "gate.check",
    ({ fs }) => {
      if (open) fs.write(QUESTIONS, stamped(`open questions remain in ${file}\n`, commit))
      else fs.rm(QUESTIONS)
    },
    { label: texts.check.label },
  )
  if (!open) return false
  await humanStep("gate.answer", texts.answer, { acceptClean: true })
  requireAnswers(texts.answer.file)
  return true
}

/**
 * An author turn and its question gate, repeated until no question is left.
 * `progressOn` names a file the author may not simply delete. Steps: `name`
 * and `questionGate`'s.
 */
export const designLoop = async (
  name: string,
  author: AgentSpec,
  gate: QuestionGateTexts,
  progressOn?: string,
): Promise<void> => {
  do {
    await agentStep(name, author)
    if (progressOn !== undefined) requireProgress(progressOn)
  } while (await questionGate(gate))
}

// ── The per-package queue ───────────────────────────────────────────────────

export interface SpecReviewTexts {
  readonly pre: JudgeTexts
  /** The review prompt, given the sections the pre-judge could not clear. */
  readonly review: Omit<AgentSpec, "prompt"> & {
    readonly prompt: (failing: readonly string[]) => string
  }
  /** The confidence a "yes" needs to clear a section without review. */
  readonly clearMinP: number
}

const MAX_SECTIONS = 8

/** Each `## ` section's own text, by title. */
const sectionTexts = (text: string, titles: readonly string[]): string[] => {
  const lines = text.split("\n")
  const starts = titles.map((title) =>
    lines.findIndex((l) => l.replace(/^#+\s*/, "").trim() === title),
  )
  return starts.map((from, i) => {
    if (from === -1) return ""
    const next = starts.slice(i + 1).find((n) => n > from) ?? lines.length
    return lines.slice(from, next).join("\n")
  })
}

const sectionQuestion = (id: string, title: string): JudgeQuestion => ({
  id,
  primitive: "noul",
  instructions: `Is the requirement "${title}" already fully satisfied by the code on the range from ${start()} to the working tree?`,
  criteria:
    "Judge from the package markdown plus that range, read yourself. Only answer yes at a probability clearing the threshold below if genuinely confident nothing in this section is missing.",
})

/**
 * Review one freshly built package against its spec: a pre-judge per
 * section, then an agent review of the sections it did not confidently
 * clear. Resolves `true` when approved. Steps: `spec.pre`, `spec.review`.
 */
export const specReview = async (texts: SpecReviewTexts): Promise<boolean> => {
  const pkg = (read(".gtd/NEXT.md") ?? "").trim()
  const whole = read(pkg) ?? ""
  const titles = sections(whole)
  const judged = titles.length > 0 && titles.length <= MAX_SECTIONS
  const bodies = sectionTexts(whole, titles)
  const evidence: Record<string, string> = {}
  const questions: JudgeQuestion[] = []
  if (judged) {
    titles.forEach((title, i) => {
      evidence[`section-${i + 1}`] = bodies[i]!
      questions.push(sectionQuestion(`section-${i + 1}`, title))
    })
  }
  const { answers, truncated } = await judge("spec.pre", {
    questions,
    evidence,
    message: texts.pre.message(),
    label: texts.pre.label,
  })
  // A section is cleared only by a confident yes on evidence that was not cut.
  const failing = titles.filter((_, i) => {
    const id = `section-${i + 1}`
    return !judged || truncated.includes(id) || !answered(answers[id], "yes", texts.clearMinP)
  })
  if (titles.length > 0 && failing.length === 0) return true
  await agent("spec.review", texts.review.prompt(failing), {
    label: texts.review.label,
    file: texts.review.file,
    mode: texts.review.mode,
    model: texts.review.model?.(),
    system: texts.review.system?.(),
    allowEmpty: true,
  })
  if (wrote(".gtd/SPEC_FEEDBACK.md")) return false
  if (changes(".gtd/SPEC_FEEDBACK.md").length > 0 || changes().length === 0) return true
  return refuse(
    "gtd land: no declared pattern matches the pending changes — write .gtd/SPEC_FEEDBACK.md to request changes, or change nothing to approve",
  )
}

export interface PackageTexts {
  /** `sweep`: spent steering files picking removes ahead of every package. */
  readonly picking: StepLabel & { readonly sweep: readonly string[] }
  readonly building: AgentSpec
  readonly fixSuite: AgentSpec
  readonly fixSpec: AgentSpec
  /** `sweep`: the package's leftovers closing removes with it. */
  readonly closing: StepLabel & { readonly sweep: readonly string[] }
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
    const next = [...glob(".gtd/packages/*.md")].sort()[0]
    await run(
      "picking",
      ({ fs }) => {
        fs.rm(...texts.picking.sweep)
        if (next === undefined) fs.rm(NEXT)
        else fs.write(NEXT, next)
      },
      { label: texts.picking.label },
    )
    if (next === undefined) return
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
  const pkg = (read(NEXT) ?? "").trimEnd()
  await run(
    "closing",
    ({ fs }) => {
      if (pkg !== "") fs.rm(pkg)
      fs.rm(NEXT, ...texts.closing.sweep)
    },
    { label: texts.closing.label },
  )
}

// ── Quality lap ─────────────────────────────────────────────────────────────

export interface QualityTexts {
  /** `lenses`: the skills the lap reviews with, one turn each. */
  readonly seeding: StepLabel & { readonly lenses: () => readonly string[] }
  readonly picking: StepLabel
  readonly reviewing: AgentSpec
}

const QUALITY = ".gtd/QUALITY.md"
const QUALITY_DONE = ".gtd/QUALITY_DONE.md"
const NEXT_REVIEW = ".gtd/NEXT_REVIEW.md"

/** One queue file per lens, numbered in list order. */
const lensQueue = (lenses: readonly string[]): [string, string][] =>
  lenses.map((lens, i) => [`.gtd/reviews/${String(i + 1).padStart(2, "0")}-${lens}.md`, lens])

/**
 * One review turn per configured lens over the whole change. Resolves
 * `"findings"` when a lens wrote `.gtd/QUALITY.md`. Steps: `quality.seeding`,
 * `quality.picking`, `quality.reviewing`.
 */
export const qualityLap = async (texts: QualityTexts): Promise<"clean" | "findings"> => {
  // The lap runs once an episode: QUALITY_DONE.md marks it spent.
  const queue = read(QUALITY_DONE) === undefined ? lensQueue(texts.seeding.lenses()) : []
  await run(
    "quality.seeding",
    ({ fs }) => {
      for (const [path, lens] of queue) fs.write(path, lens)
    },
    { label: texts.seeding.label },
  )
  if (queue.length === 0) return "clean"
  for (;;) {
    const next = [...glob(".gtd/reviews/*.md")].sort()[0]
    const lens = next === undefined ? undefined : (read(next) ?? "")
    const findings = (read(QUALITY) ?? "").length > 0
    await run(
      "quality.picking",
      ({ fs }) => {
        if (next !== undefined && lens !== undefined) {
          fs.write(NEXT_REVIEW, lens)
          fs.rm(next)
          return
        }
        fs.rm(NEXT_REVIEW)
        fs.write(QUALITY_DONE, "")
        if (findings) fs.write(".gtd/QUALITY_READY.md", "")
      },
      { label: texts.picking.label },
    )
    if (next === undefined) return findings ? "findings" : "clean"
    await agentStep("quality.reviewing", texts.reviewing, { allowEmpty: true })
  }
}

// ── Human review ────────────────────────────────────────────────────────────

export interface ReviewTexts {
  /** The reviewer's prompt and the review gate's message take the round's base. */
  readonly reviewing: Omit<AgentSpec, "prompt"> & { readonly prompt: (base: string) => string }
  readonly awaitReview: Omit<HumanSpec, "message"> & { readonly message: (base: string) => string }
  /** What `review.deciding` writes for a round, each naming the round's commit. */
  readonly deciding: {
    readonly label?: string
    /** `.gtd/FEEDBACK.md` when the round left no `.gtd/REVIEW.md`. */
    readonly missing: (commit: string) => string
    /** `.gtd/REVIEW_RAW.md` when the human edited code. */
    readonly edits: (commit: string) => string
    /** `.gtd/REVIEW_NOTE.md` when the human only left notes. */
    readonly note: (commit: string) => string
  }
  readonly missing: HumanSpec
  readonly triage: JudgeTexts
  /** What `review.triaging` writes to `.gtd/REVIEW_RAW.md` for an actionable round. */
  readonly rawCapture: Text
  /** The confidence a "yes, actionable" needs; a less confident yes counts as no. */
  readonly actionableMinP: number
  readonly collecting: AgentSpec
}

/** How a review round ended. `feedback` carries what the human edited, for the re-unwind to undo. */
export type ReviewOutcome =
  | { readonly verdict: "signoff" }
  | {
      readonly verdict: "feedback"
      /** The commit the human's review edit landed as. */
      readonly base: string
      /** The code paths that edit changed, with their content before it. */
      readonly edited: readonly Change[]
    }

/** One noul per `## ` chunk of `.gtd/REVIEW.md`: is its note actionable? */
const triageQuestions = (chunks: readonly string[]): JudgeQuestion[] =>
  chunks.map((title, i) => ({
    id: `chunk-${i + 1}`,
    primitive: "noul",
    instructions: `Is the note under review chunk "${title}" (in .gtd/REVIEW.md) actionable — anything beyond an approving remark with no code edit?`,
    criteria:
      "A concrete request, a question, a code comment, or a hand-edit under this chunk answers yes. No note, or a purely approving remark, answers no.",
  }))

/** A note-only round: judge whether any chunk asks for something; a round nothing asks for signs off. */
const triage = async (texts: ReviewTexts): Promise<boolean> => {
  const review = read(".gtd/REVIEW.md") ?? ""
  const chunks = sections(review)
  const bodies = sectionTexts(review, chunks)
  const evidence = Object.fromEntries(chunks.map((_, i) => [`chunk-${i + 1}`, bodies[i]!]))
  const { answers, truncated } = await judge("review.triage", {
    questions: triageQuestions(chunks),
    evidence,
    message: texts.triage.message(),
    label: texts.triage.label,
  })
  // A chunk counts as actionable unless the judge confidently said no, or
  // said yes without enough confidence; a cut or unanswered chunk is actionable.
  const actionable =
    chunks.length === 0 ||
    chunks.some((_, i) => {
      const id = `chunk-${i + 1}`
      const answer = answers[id]
      if (truncated.includes(id) || answer === undefined) return true
      if (answer.answer === "no") return false
      return answer.p >= texts.actionableMinP
    })
  await run(
    "review.triaging",
    ({ fs }) => {
      if (actionable) fs.write(".gtd/REVIEW_RAW.md", texts.rawCapture())
      fs.rm(".gtd/REVIEW.md", ".gtd/REVIEW_NOTE.md")
    },
    { label: "Filtering non-actionable feedback" },
  )
  return actionable
}

const collect = async (texts: ReviewTexts): Promise<"signoff" | "feedback"> => {
  await agentStep("review.collecting", texts.collecting)
  if (wrote(".gtd/REQUIREMENTS.md")) return "feedback"
  if (changes(".gtd/REVIEW_RAW.md").some((c) => c.status === "deleted")) return "signoff"
  return refuse(
    "gtd land: no declared pattern matches the pending changes — write .gtd/REQUIREMENTS.md from the feedback, or delete .gtd/REVIEW_RAW.md when it asks for nothing",
  )
}

/**
 * A reviewer writes `.gtd/REVIEW.md` over everything since `base`, a human
 * reviews and signs off or comments, and a comment is classified into
 * requirements for another lap. Steps: `review.reviewing`,
 * `review.await-review`, `review.deciding`, `review.review-missing`,
 * `review.triage`, `review.triaging`, `review.collecting`.
 */
export const reviewTail = async (texts: ReviewTexts, base: string): Promise<ReviewOutcome> => {
  for (;;) {
    await agent("review.reviewing", texts.reviewing.prompt(base), {
      label: texts.reviewing.label,
      file: texts.reviewing.file,
      mode: texts.reviewing.mode,
      model: texts.reviewing.model?.(),
      system: texts.reviewing.system?.(),
      base,
    })
    await human("review.await-review", {
      message: texts.awaitReview.message(base),
      label: texts.awaitReview.label,
      file: texts.awaitReview.file,
      mode: texts.awaitReview.mode,
      base,
    })
    if (changes(".gtd/REVIEW.md").some((c) => c.status === "deleted")) {
      refuse(
        "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note (or edit code) to request changes.",
      )
    }
    const edited = changes().filter((c) => isCode(c.path))
    const round = head()
    const kind = roundKind(edited)
    await deciding(texts, kind, round)
    const verdict = await decided(texts, kind)
    if (verdict === "signoff") return { verdict }
    if (verdict === "feedback") return { verdict, base: round, edited }
    await humanStep("review.review-missing", texts.missing)
  }
}

/**
 * What the human's review round was. The review gate clears every tick
 * before its commit, so a changed `.gtd/REVIEW.md` is a note, never a tick.
 */
type RoundKind = "missing" | "edits" | "note" | "signoff"

const roundKind = (edited: readonly Change[]): RoundKind => {
  if (read(REVIEW) === undefined) return "missing"
  if (edited.length > 0) return "edits"
  if (changes(REVIEW).length > 0) return "note"
  return "signoff"
}

/** Capture the round for the steps after it: a hand edit for collecting, a note for triage. */
const deciding = (texts: ReviewTexts, kind: RoundKind, commit: string): Promise<void> => {
  const { missing, edits, note } = texts.deciding
  return run(
    "review.deciding",
    ({ fs }) => {
      if (kind === "missing") fs.write(FEEDBACK, missing(commit))
      if (kind === "edits") fs.write(".gtd/REVIEW_RAW.md", edits(commit))
      if (kind === "note") fs.write(".gtd/REVIEW_NOTE.md", note(commit))
      if (kind === "edits" || kind === "signoff") fs.rm(REVIEW)
    },
    { label: texts.deciding.label, file: REVIEW, mode: "review", base: commit },
  )
}

/** `undefined` when there was no review to act on. */
const decided = async (
  texts: ReviewTexts,
  kind: RoundKind,
): Promise<"signoff" | "feedback" | undefined> => {
  if (kind === "missing") return undefined
  if (kind === "edits") return collect(texts)
  if (kind === "note") return (await triage(texts)) ? collect(texts) : "signoff"
  return "signoff"
}
