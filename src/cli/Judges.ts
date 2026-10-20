import { Effect, Option } from "effect"
import { answered, numeric } from "../flows/index.js"
import { GitService } from "../platform/index.js"
import { parseCommitMessage, type JudgeVerdict } from "../replay/index.js"
import { headingSectionBodies } from "../steering/index.js"
import { selectHistoryEntries, type HistoryEntry } from "./History.js"
import { printable } from "./Metrics.js"
import { writeJson, type ArtifactOut, type CommandRequirements, type JsonMode } from "./Output.js"

// Judge calibration reads recorded `Gtd-Judge:` verdicts and the trees around
// them, never replays and never asks a model: like the metrics, it must
// survive a config that has moved on. The step names, files and thresholds
// below are the bundled feature workflow's public ones.

const FEEDBACK = ".gtd/FEEDBACK.md"
const QUALITY = ".gtd/QUALITY.md"
const REVIEW = ".gtd/REVIEW.md"
const REQUIREMENTS = ".gtd/REQUIREMENTS.md"

export type JudgeName = "retry" | "triage" | "clear"

const JUDGE_STEPS: readonly (readonly [JudgeName, RegExp])[] = [
  ["retry", /(^|\.)health\.judge$/],
  ["triage", /(^|\.)quality\.triage$/],
  ["clear", /(^|\.)design\.clear$/],
]

/** One `## ` finding of `.gtd/QUALITY.md`, numbered as the quality lap numbers it. */
export interface Finding {
  readonly id: string
  readonly title: string
  readonly body: string
}

/** What one commit of a kept process holds that a verdict's outcome or state reads. */
export interface JudgeCommit {
  readonly hash: string
  readonly message: string
  /** The red report a health check wrote, stamp stripped; absent when the check was green. */
  readonly feedback?: string
  /** `.gtd/QUALITY.md`'s findings just before a triage verdict. */
  readonly findings?: readonly Finding[]
  /** `.gtd/REVIEW.md` around a commit that changed it. */
  readonly review?: { readonly before: string; readonly after: string }
  /** The commit changed the `## Acceptance Criteria` of `.gtd/REQUIREMENTS.md`. */
  readonly criteriaChanged?: boolean
  /** The `TODO.md` the opening commit's sketch wrote. */
  readonly sketch?: string
}

export type Outcome = "overturned" | "held"

export interface Judgment {
  readonly judge: JudgeName
  readonly commit: string
  readonly step: string
  readonly question: string
  /** The evidence the judge saw, as far as the tree still shows it. */
  readonly state: Readonly<Record<string, string>>
  readonly answer: JudgeVerdict["answer"]
  readonly p: number
  /** Null when nothing later in the process says whether the verdict held. */
  readonly outcome: Outcome | null
}

/** A threshold `--var` may re-decide past verdicts under. */
interface Threshold {
  readonly judge: JudgeName
  readonly decide: (answer: JudgeVerdict["answer"], p: number, minP: number) => string
  /** Each decision as `[one, many, with an article]`. */
  readonly labels: Readonly<Record<string, readonly [string, string, string]>>
}

// Replay reads a boolean verdict as yes/no; so does every decision here.
const answerOf = (answer: JudgeVerdict["answer"]): string =>
  typeof answer === "boolean" ? (answer ? "yes" : "no") : String(answer)

const verdictOf = (answer: JudgeVerdict["answer"], p: number) => ({ answer: answerOf(answer), p })

// Mirrors the flows: an answer counts only at or above the process's threshold.
export const THRESHOLDS: Readonly<Record<string, Threshold>> = {
  judgeIdenticalMinP: {
    judge: "retry",
    decide: (answer, p, minP) =>
      (["identical", "progress"] as const).find((k) => answered(verdictOf(answer, p), k, minP)) ??
      "retry",
    labels: {
      identical: ["escalation", "escalations", "an escalation"],
      progress: ["progress verdict", "progress verdicts", "a progress verdict"],
      retry: ["plain retry", "plain retries", "a plain retry"],
    },
  },
  qualityTriageMinP: {
    judge: "triage",
    decide: (answer, p, minP) =>
      (["mechanical", "noise"] as const).find((k) => answered(verdictOf(answer, p), k, minP)) ??
      "design",
    labels: {
      mechanical: ["auto-fix", "auto-fixes", "an auto-fix"],
      noise: ["noise drop", "noise drops", "a noise drop"],
      design: ["note", "notes", "a note"],
    },
  },
}

interface Read {
  readonly commit: JudgeCommit
  readonly actor: string | undefined
  readonly at: string
  readonly judge: readonly JudgeVerdict[]
}

const UNTITLED = "Quality findings"

/** The quality lap's own numbering: prose outside every `## ` section is finding Q1. */
export const findingsOf = (text: string): readonly Finding[] => {
  const sections = headingSectionBodies(text)
  const stray = sections
    .reduce((rest, s) => rest.replace(s.body, "\n"), text)
    .split("\n")
    .filter((line) => !/^#\s/.test(line))
    .join("\n")
    .trim()
  return [
    ...(stray === "" ? [] : [{ title: UNTITLED, body: stray }]),
    ...sections.map((s) => ({
      title: s.title,
      body: s.body.split("\n").slice(1).join("\n").trim(),
    })),
  ].map((f, i) => ({ id: `Q${i + 1}`, ...f }))
}

const criteriaOf = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined
  const section = headingSectionBodies(text).find((s) =>
    /^acceptance criteria$/i.test(s.title.trim()),
  )
  return section?.body.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim()
}

export const criteriaChanged = (before: string | undefined, after: string | undefined): boolean =>
  criteriaOf(before) !== criteriaOf(after)

const chunkLines = (doc: string, title: string): readonly string[] =>
  headingSectionBodies(doc)
    .find((s) => s.title === title)
    ?.body.split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l !== "") ?? []

const retryOutcome = (reads: readonly Read[], i: number, scope: string): Outcome | null => {
  const isCheck = (r: Read) => r.at === `${scope}health.check` || r.at === `${scope}health.recheck`
  let fixed = false
  for (const r of reads.slice(i + 1)) {
    if (!fixed) {
      // A re-check that passed before any fix ends the loop: no fix turn to judge by.
      if (isCheck(r) && r.commit.feedback === undefined) return null
      fixed = r.actor === "agent" && !r.at.startsWith(`${scope}health.`)
    } else if (r.at === `${scope}health.check`) {
      return r.commit.feedback === undefined ? "overturned" : "held"
    }
  }
  return null
}

const RESHOWN: Readonly<Record<string, string>> = {
  mechanical: "Fixed automatically",
  noise: "Dropped as noise",
}

const triageOutcome = (
  reads: readonly Read[],
  i: number,
  answer: string,
  finding: Finding | undefined,
): Outcome | null => {
  const chunk = RESHOWN[answer]
  if (chunk === undefined || finding === undefined) return null
  for (const r of reads.slice(i + 1)) {
    if (judgeOf(r.at) === "triage") return null
    const review = r.commit.review
    if (r.actor !== "human" || review === undefined) continue
    const before = chunkLines(review.before, chunk)
    // Only a finding the review listed as fixed or dropped was acted on: one the fix cap left is a note.
    if (!before.some((l) => l.startsWith(`- ${finding.title} (`))) return null
    const added = chunkLines(review.after, chunk).filter((l) => !before.includes(l))
    return added.some((l) => l.includes(finding.title)) ? "overturned" : "held"
  }
  return null
}

const clearOutcome = (reads: readonly Read[], i: number, answer: string): Outcome | null => {
  if (answer !== "yes") return null
  const edited = reads
    .slice(i + 1)
    .some(
      (r) =>
        r.actor === "human" && /(^|\.)design\./.test(r.at) && r.commit.criteriaChanged === true,
    )
  return edited ? "overturned" : "held"
}

const judgeOf = (step: string): JudgeName | undefined =>
  JUDGE_STEPS.find(([, pattern]) => pattern.test(step))?.[0]

const reportsBefore = (reads: readonly Read[], i: number, scope: string): readonly string[] =>
  reads
    .slice(0, i)
    .filter(
      (r) =>
        (r.at === `${scope}health.check` || r.at === `${scope}health.recheck`) &&
        r.commit.feedback !== undefined,
    )
    .map((r) => r.commit.feedback!)

/** Oldest first: every verdict of a calibrated judge, with its outcome. */
export const processJudgments = (commits: readonly JudgeCommit[]): readonly Judgment[] => {
  const reads: Read[] = commits.map((commit) => {
    const message = parseCommitMessage(commit.message)
    const subject = message.parsed
    return {
      commit,
      actor: subject?.actor,
      at: subject === undefined ? "" : (subject.from ?? subject.to),
      judge: message.judge,
    }
  })
  const sketch = commits[0]?.sketch
  return reads.flatMap((r, i) => {
    const judge = judgeOf(r.at)
    if (judge === undefined) return []
    const scope = r.at.slice(0, r.at.length - r.at.split(".").slice(-2).join(".").length)
    const at: Site = { reads, i, scope, sketch }
    return r.judge.map(
      (v): Judgment => ({
        judge,
        commit: r.commit.hash,
        step: r.at,
        question: v.id,
        ...JUDGES[judge](at, v),
        answer: v.answer,
        p: v.p,
      }),
    )
  })
}

/** Where a verdict was recorded: its commit among the process's, and the scope its step sits in. */
interface Site {
  readonly reads: readonly Read[]
  readonly i: number
  readonly scope: string
  readonly sketch: string | undefined
}

const field = (key: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [key]: value }

type Verdict = (at: Site, v: JudgeVerdict) => Pick<Judgment, "state" | "outcome">

const JUDGES: Readonly<Record<JudgeName, Verdict>> = {
  retry: ({ reads, i, scope }, v) => {
    const reports = reportsBefore(reads, i, scope)
    return {
      state: {
        ...field("previous", reports.at(-2)),
        ...field("current", reports.at(-1)),
      },
      outcome: answerOf(v.answer) === "identical" ? retryOutcome(reads, i, scope) : null,
    }
  },
  triage: ({ reads, i }, v) => {
    const finding = reads[i]!.commit.findings?.find((f) => f.id === v.id)
    return {
      state: field(v.id, finding && `## ${finding.title}\n\n${finding.body}`),
      outcome: triageOutcome(reads, i, answerOf(v.answer), finding),
    }
  },
  clear: ({ reads, i, sketch }, v) => ({
    state: field("sketch", sketch),
    outcome: clearOutcome(reads, i, answerOf(v.answer)),
  }),
}

export interface Bucket {
  /** The bucket's lower bound; it spans a tenth of p, the last one including 1. */
  readonly p: number
  readonly scored: number
  readonly overturned: number
  readonly rate: number
}

export interface Calibration {
  readonly verdicts: number
  /** Verdicts with an outcome. */
  readonly scored: number
  readonly overturned: number
  /** Non-empty buckets only, lowest p first. */
  readonly buckets: readonly Bucket[]
}

const rate = (overturned: number, scored: number): number =>
  Math.round((overturned / scored) * 1000) / 1000

const bucketOf = (p: number): number => Math.min(9, Math.max(0, Math.floor(p * 10))) / 10

export const calibrate = (judgments: readonly Judgment[]): Record<JudgeName, Calibration> => {
  const of = (judge: JudgeName): Calibration => {
    const all = judgments.filter((j) => j.judge === judge)
    const scored = all.filter((j) => j.outcome !== null)
    const buckets = new Map<number, { scored: number; overturned: number }>()
    for (const j of scored) {
      const b = buckets.get(bucketOf(j.p)) ?? { scored: 0, overturned: 0 }
      b.scored++
      if (j.outcome === "overturned") b.overturned++
      buckets.set(bucketOf(j.p), b)
    }
    const overturned = scored.filter((j) => j.outcome === "overturned").length
    return {
      verdicts: all.length,
      scored: scored.length,
      overturned,
      buckets: [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([p, b]) => ({ p, ...b, rate: rate(b.overturned, b.scored) })),
    }
  }
  return { retry: of("retry"), triage: of("triage"), clear: of("clear") }
}

export interface Change {
  readonly from: string
  readonly to: string
  readonly count: number
  /** Of those, verdicts later overturned. */
  readonly overturned: number
}

export interface WhatIf {
  readonly var: string
  readonly value: string
  readonly judge: JudgeName
  readonly changes: readonly Change[]
}

export interface ProcessJudgments {
  /** The process's recorded `Gtd-Var` settings. */
  readonly vars: Readonly<Record<string, string>>
  readonly judgments: readonly Judgment[]
}

/** Each past verdict decided under its process's recorded threshold, then under `value`. */
export const whatIf = (
  processes: readonly ProcessJudgments[],
  name: string,
  value: string,
): WhatIf => {
  const threshold = THRESHOLDS[name]!
  const changes = new Map<string, Change>()
  for (const { vars, judgments } of processes) {
    const was = numeric(vars[name], Infinity)
    const now = numeric(value, Infinity)
    for (const j of judgments) {
      if (j.judge !== threshold.judge) continue
      const from = threshold.decide(j.answer, j.p, was)
      const to = threshold.decide(j.answer, j.p, now)
      if (from === to) continue
      const key = `${from} ${to}`
      const c = changes.get(key) ?? { from, to, count: 0, overturned: 0 }
      changes.set(key, {
        ...c,
        count: c.count + 1,
        overturned: c.overturned + (j.outcome === "overturned" ? 1 : 0),
      })
    }
  }
  return { var: name, value, judge: threshold.judge, changes: [...changes.values()] }
}

const changeLine = (labels: Threshold["labels"], c: Change): string => {
  const [one, many] = labels[c.from]!
  const [, toMany, toOne] = labels[c.to]!
  const what = c.count === 1 ? `1 ${one} becomes ${toOne}` : `${c.count} ${many} become ${toMany}`
  return c.overturned > 0 ? `${what} (${c.overturned} overturned)` : what
}

type FileAt = (
  ref: string | undefined,
  path: string,
) => Effect.Effect<string | undefined, never, never>

interface Touched {
  readonly hash: string
  readonly message: string
  readonly touched: readonly string[]
}

const reportFact = (at: FileAt, c: Touched, from: string) =>
  /(^|\.)health\.(re)?check$/.test(from) && c.touched.includes(FEEDBACK)
    ? at(c.hash, FEEDBACK).pipe(
        Effect.map((r) => (r === undefined ? {} : { feedback: stripStamp(r) })),
      )
    : Effect.succeed({})

const findingsFact = (at: FileAt, parent: string | undefined, from: string) =>
  judgeOf(from) === "triage"
    ? at(parent, QUALITY).pipe(Effect.map((q) => ({ findings: findingsOf(q ?? "") })))
    : Effect.succeed({})

const reviewFact = (at: FileAt, c: Touched, parent: string | undefined) =>
  c.touched.includes(REVIEW)
    ? Effect.all([at(parent, REVIEW), at(c.hash, REVIEW)]).pipe(
        Effect.map(([before, after]) => ({ review: { before: before ?? "", after: after ?? "" } })),
      )
    : Effect.succeed({})

const criteriaFact = (at: FileAt, c: Touched, parent: string | undefined) =>
  c.touched.includes(REQUIREMENTS)
    ? Effect.all([at(parent, REQUIREMENTS), at(c.hash, REQUIREMENTS)]).pipe(
        Effect.map(([before, after]) => ({ criteriaChanged: criteriaChanged(before, after) })),
      )
    : Effect.succeed({})

const sketchFact = (at: FileAt, c: Touched, opening: boolean) => {
  const todo = c.touched.filter((p) => /(^|\/)TODO\.md$/.test(p))
  return opening && todo.length === 1
    ? at(c.hash, todo[0]!).pipe(Effect.map((s) => (s === undefined ? {} : { sketch: s })))
    : Effect.succeed({})
}

/** Only the files a verdict's outcome or state reads, and only at the commits that can matter. */
const commitFacts = (
  at: FileAt,
  c: Touched,
  parent: string | undefined,
  opening: boolean,
): Effect.Effect<JudgeCommit> => {
  const step = parseCommitMessage(c.message).parsed
  const from = step === undefined ? "" : (step.from ?? step.to)
  return Effect.all([
    reportFact(at, c, from),
    findingsFact(at, parent, from),
    reviewFact(at, c, parent),
    criteriaFact(at, c, parent),
    sketchFact(at, c, opening),
  ]).pipe(Effect.map((facts) => Object.assign({ hash: c.hash, message: c.message }, ...facts)))
}

const readProcessJudgments = (
  entry: Pick<HistoryEntry, "entry" | "tip">,
): Effect.Effect<ProcessJudgments, Error, GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const base = Option.getOrUndefined(yield* git.readRefOption(`${entry.entry}^`))
    const commits = yield* git.commitHistory(base, entry.tip)
    const at: FileAt = (ref, path) =>
      ref === undefined
        ? Effect.succeed(undefined)
        : git.readFileAtRef(ref, path).pipe(
            Effect.map((content): string | undefined => content),
            Effect.orElseSucceed(() => undefined),
          )
    const read = yield* Effect.forEach(commits, (commit, i) =>
      commitFacts(at, commit, i === 0 ? base : commits[i - 1]!.hash, i === 0),
    )
    const vars = commits[0] === undefined ? {} : parseCommitMessage(commits[0].message).vars
    return { vars, judgments: processJudgments(read) }
  })

// check() stamps the report with the commit it ran at; the judge compared it without.
const stripStamp = (text: string): string =>
  text.replace(/\n<!-- gtd check [0-9a-f]+ -->\n?$/, "\n")

const NAMES: readonly JudgeName[] = ["retry", "triage", "clear"]

const calibrationLine = (name: JudgeName, c: Calibration): string => {
  const buckets = c.buckets
    .map((b) => `${b.p.toFixed(1)}-${(b.p + 0.1).toFixed(1)}: ${b.overturned}/${b.scored}`)
    .join(", ")
  return `${name}: ${c.verdicts} verdicts, ${c.scored} scored, ${c.overturned} overturned${buckets === "" ? "" : ` (${buckets})`}`
}

export const runHistoryJudgesCommand = (
  refs: readonly string[],
  vars: Readonly<Record<string, string>>,
  jsonl: boolean,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const entries = yield* selectHistoryEntries(refs)
    const processes = yield* Effect.forEach(
      entries,
      (e) =>
        readProcessJudgments(e).pipe(Effect.map((p) => ({ ...p, entry: e.entry, ref: e.ref }))),
      { concurrency: 4 },
    )
    if (jsonl) {
      for (const p of processes)
        for (const { judge, commit, step, question, state, answer, p: pr, outcome } of p.judgments)
          out.write(
            `${JSON.stringify({ process: p.entry, judge, commit, step, question, state, answer, p: pr, outcome })}\n`,
          )
      return
    }
    const judges = calibrate(processes.flatMap((p) => p.judgments))
    const whatIfs = Object.entries(vars).map(([name, value]) => whatIf(processes, name, value))
    if (yield* writeJson(json, out, { processes: processes.length, judges, whatIf: whatIfs }))
      return
    if (processes.length === 0) {
      out.write("no history refs; run gtd history fetch | sh to pull them\n")
      return
    }
    const lines = NAMES.map((name) => calibrationLine(name, judges[name]))
    for (const w of whatIfs) {
      const labels = THRESHOLDS[w.var]!.labels
      const changes = w.changes.map((c) => changeLine(labels, c)).join(", ")
      lines.push(`what-if ${w.var}=${printable(w.value)}: ${changes || "no decision changes"}`)
    }
    out.write(`${lines.join("\n")}\n`)
  })
