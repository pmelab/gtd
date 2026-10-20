import { Effect, Option } from "effect"
import { GitService } from "../platform/index.js"
import { parseCommitMessage } from "../replay/index.js"
import { UNATTRIBUTED_MODEL } from "../wire/index.js"
import { historyEntries, resolveHistoryRef, type HistoryEntry } from "./History.js"
import { writeJson, type ArtifactOut, type CommandRequirements, type JsonMode } from "./Output.js"

// Read from commit subjects and trailers alone, never by replay: a metric over
// old histories must not refuse because today's config has moved on. The step
// names below are the bundled feature workflow's public ones.

const QUALITY = ".gtd/QUALITY.md"

export interface MetricCommit {
  readonly message: string
  /** Findings this commit added to the quality lap's file; only a reviewing turn's count is read. */
  readonly findings: number
}

export interface Metrics {
  readonly slices: {
    readonly decided: number
    readonly landed: number
    readonly rebuilt: number
    readonly refactored: number
  }
  /** `rebuilt / decided`, to three places; null without a decision. */
  readonly refactorFirstRate: number | null
  /** Continuation turns per phase, keyed by the step without its `continue` segment. */
  readonly continuations: Readonly<Record<string, number>>
  readonly cost: {
    readonly total: number
    readonly byModel: Readonly<Record<string, number>>
    readonly byPhase: {
      readonly naive: number
      readonly refactor: number
      readonly implement: number
      readonly other: number
    }
    /** A rebuilt slice's naive pass and the implement turns that rebuilt it. */
    readonly doubleWork: {
      readonly naive: number
      readonly rebuild: number
      readonly total: number
    }
  }
  readonly findings: { readonly total: number; readonly byLens: Readonly<Record<string, number>> }
}

type Phase = keyof Metrics["cost"]["byPhase"]

// Keyed by the lap's path without `.reviewing`, so the refactor lap's lenses stay apart from the feature's.
const LENS = /^((?:.*\.)?quality\.[^.]+)\.reviewing$/

const inSeam = (step: string): boolean => step.startsWith("seam.")

// A naive retry after a continuation runs under `seam.fresh.naive`: any seam step named `naive` is the pass.
const phaseOf = (step: string): Phase => {
  const scope = step.split(".")[0]
  if (inSeam(step) && step.endsWith(".naive")) return "naive"
  if (step === "seam.note" || scope === "refactor") return "refactor"
  if (scope === "implement") return "implement"
  return "other"
}

const round = (n: number, places = 6): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

// Keys are model, step and lens names from history: a prototype-free record keeps `constructor` a plain key.
const record = (): Record<string, number> => Object.create(null) as Record<string, number>

const add = (into: Record<string, number>, key: string, n: number): void => {
  into[key] = (into[key] ?? 0) + n
}

const roundAll = (record: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, round(v)]))

interface Tally {
  readonly slices: { decided: number; landed: number; rebuilt: number; refactored: number }
  readonly continuations: Record<string, number>
  readonly byModel: Record<string, number>
  readonly byPhase: Record<Phase, number>
  readonly doubleWork: { naive: number; rebuild: number }
  readonly byLens: Record<string, number>
}

const emptyTally = (): Tally => ({
  slices: { decided: 0, landed: 0, rebuilt: 0, refactored: 0 },
  continuations: record(),
  byModel: record(),
  byPhase: { naive: 0, refactor: 0, implement: 0, other: 0 },
  doubleWork: { naive: 0, rebuild: 0 },
  byLens: record(),
})

const sum = (record: Readonly<Record<string, number>>): number =>
  Object.values(record).reduce((a, b) => a + b, 0)

const finish = (t: Tally): Metrics => ({
  slices: t.slices,
  refactorFirstRate: t.slices.decided === 0 ? null : round(t.slices.rebuilt / t.slices.decided, 3),
  continuations: t.continuations,
  cost: {
    total: round(sum(t.byModel)),
    byModel: roundAll(t.byModel),
    byPhase: roundAll(t.byPhase) as Metrics["cost"]["byPhase"],
    doubleWork: {
      naive: round(t.doubleWork.naive),
      rebuild: round(t.doubleWork.rebuild),
      total: round(t.doubleWork.naive + t.doubleWork.rebuild),
    },
  },
  findings: { total: sum(t.byLens), byLens: t.byLens },
})

/** The open slice: its naive cost so far, and whether its implement turns rebuild it. */
interface Slice {
  naive: number
  rebuilding: boolean
  /** Landed, not yet applied, with its naive cost: an apply that fails turns it into a rebuild. */
  applying: number | undefined
}

const tallyCost = (
  t: Tally,
  open: Slice,
  costs: ReturnType<typeof parseCommitMessage>["cost"],
  phase: Phase,
): void => {
  for (const { cost, model } of costs) {
    add(t.byModel, model ?? UNATTRIBUTED_MODEL, cost)
    t.byPhase[phase] += cost
    if (phase === "naive") open.naive += cost
    if (phase === "implement" && open.rebuilding) t.doubleWork.rebuild += cost
  }
}

/** A slice is decided where its turns leave the seam: for `implement.applying` the naive pass landed — unless it fails to apply and is built afresh — anywhere else it is rebuilt. */
const tallyDecision = (t: Tally, open: Slice, at: string, to: string): void => {
  // The slice's closing ends its rebuild: later implement turns (an amend after review) are new work.
  if (at === "implement.closing") open.rebuilding = false
  if (open.applying !== undefined && at === "implement.applying") {
    const naive = open.applying
    open.applying = undefined
    if (to !== "implement.building") return
    t.slices.landed--
    rebuild(t, open, naive)
    return
  }
  if (!inSeam(at) || inSeam(to)) return
  t.slices.decided++
  const naive = open.naive
  open.naive = 0
  if (to === "implement.applying") {
    open.applying = naive
    open.rebuilding = false
    t.slices.landed++
    return
  }
  rebuild(t, open, naive)
  if (at === "seam.note") t.slices.refactored++
}

const rebuild = (t: Tally, open: Slice, naive: number): void => {
  open.rebuilding = true
  t.slices.rebuilt++
  t.doubleWork.naive += naive
}

/** Oldest first; a commit gtd did not write is skipped. */
export const processMetrics = (commits: readonly MetricCommit[]): Metrics => {
  const t = emptyTally()
  const open: Slice = { naive: 0, rebuilding: false, applying: undefined }
  for (const commit of commits) {
    const message = parseCommitMessage(commit.message)
    const subject = message.parsed
    if (subject === undefined) continue
    const at = subject.from ?? subject.to
    tallyCost(t, open, message.cost, phaseOf(at))
    if (subject.actor === "agent" && at.split(".").includes("continue"))
      add(t.continuations, at.replace(/(^|\.)continue\./, "$1"), 1)
    const lens = LENS.exec(at)?.[1]
    if (lens !== undefined && commit.findings > 0) add(t.byLens, lens, commit.findings)
    tallyDecision(t, open, at, subject.to)
  }
  return finish(t)
}

export const totalMetrics = (all: readonly Metrics[]): Metrics & { readonly processes: number } => {
  const t = emptyTally()
  for (const m of all) {
    for (const key of Object.keys(t.slices) as (keyof Tally["slices"])[])
      t.slices[key] += m.slices[key]
    for (const [k, v] of Object.entries(m.continuations)) add(t.continuations, k, v)
    for (const [k, v] of Object.entries(m.cost.byModel)) add(t.byModel, k, v)
    for (const key of Object.keys(t.byPhase) as Phase[]) t.byPhase[key] += m.cost.byPhase[key]
    t.doubleWork.naive += m.cost.doubleWork.naive
    t.doubleWork.rebuild += m.cost.doubleWork.rebuild
    for (const [k, v] of Object.entries(m.findings.byLens)) add(t.byLens, k, v)
  }
  return { processes: all.length, ...finish(t) }
}

const chunks = (content: string | undefined): number =>
  content === undefined ? 0 : (content.match(/^## /gm) ?? []).length

export interface ProcessMetrics extends Metrics {
  /** The opening commit's `Gtd-Workflow`; null for the default workflow. */
  readonly workflow: string | null
}

export const readProcessMetrics = (
  entry: Pick<HistoryEntry, "entry" | "tip">,
): Effect.Effect<ProcessMetrics, Error, GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const base = Option.getOrUndefined(yield* git.readRefOption(`${entry.entry}^`))
    const commits = yield* git.commitHistory(base, entry.tip)
    const quality = (hash: string) =>
      git.readFileAtRef(hash, QUALITY).pipe(
        Effect.map((content): string | undefined => content),
        Effect.orElseSucceed(() => undefined),
      )
    // Only a commit that touched the file changes it: carry the last content forward.
    let count = chunks(base === undefined ? undefined : yield* quality(base))
    const read: MetricCommit[] = []
    for (const { hash, message, touched } of commits) {
      const before = count
      if (touched.includes(QUALITY)) count = chunks(yield* quality(hash))
      read.push({ message, findings: Math.max(0, count - before) })
    }
    const workflow =
      commits[0] === undefined ? undefined : parseCommitMessage(commits[0].message).workflow
    return { workflow: workflow ?? null, ...processMetrics(read) }
  })

// Keys come from fetched history: never let them put control bytes on a terminal.
// eslint-disable-next-line no-control-regex -- the control range IS the point
const printable = (s: string): string => s.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, "?")

const listed = (record: Readonly<Record<string, number>>): string =>
  Object.entries(record)
    .map(([k, v]) => `${printable(k)} ${v}`)
    .join(", ")

const line = (label: string, m: Metrics): string => {
  const { slices, cost } = m
  const percent = m.refactorFirstRate === null ? "-" : `${Math.round(m.refactorFirstRate * 100)}%`
  const continued = sum(m.continuations)
  return [
    `${label}: ${slices.decided} slices, ${slices.rebuilt} rebuilt (refactor-first ${percent}), ${slices.refactored} refactored`,
    `${continued} continuations${continued > 0 ? ` (${listed(m.continuations)})` : ""}`,
    `cost ${cost.total} (${listed(cost.byPhase)}), double work ${cost.doubleWork.total}`,
    `${m.findings.total} findings${m.findings.total > 0 ? ` (${listed(m.findings.byLens)})` : ""}`,
  ].join("; ")
}

export const runHistoryMetricsCommand = (
  refs: readonly string[],
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const entries = yield* historyEntries
    const chosen =
      refs.length === 0
        ? entries
        : yield* Effect.forEach(refs, (ref) => resolveHistoryRef(ref, entries))
    const unique = chosen.filter((e, i) => chosen.findIndex((o) => o.ref === e.ref) === i)
    const processes = yield* Effect.forEach(
      unique,
      (e) =>
        readProcessMetrics(e).pipe(
          Effect.map((metrics) => ({
            ref: e.ref,
            entry: e.entry,
            branch: e.branch,
            tip: e.tip,
            ...metrics,
          })),
        ),
      { concurrency: 4 },
    )
    const document = { processes, total: totalMetrics(processes) }
    if (yield* writeJson(json, out, document)) return
    if (processes.length === 0) {
      out.write("no history refs; run gtd history fetch | sh to pull them\n")
      return
    }
    const lines = processes.map((p) =>
      line(
        `${p.entry.slice(0, 7)} ${printable(p.branch ?? "-")}${p.workflow === null ? "" : ` (${printable(p.workflow)})`}`,
        p,
      ),
    )
    lines.push(line(`total (${processes.length} processes)`, document.total))
    out.write(`${lines.join("\n")}\n`)
  })
