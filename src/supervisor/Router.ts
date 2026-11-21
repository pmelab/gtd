import { initTRPC, TRPCError } from "@trpc/server"
import { parseFootnotes, parseWidgets } from "../steering/index.js"
import { ActionRefusal, type ActionRuns } from "./Actions.js"
import type { PressAction, PressOutcome } from "./Controls.js"
import type { Dispatcher } from "./Dispatch.js"
import type { FeedRunner } from "./Feeds.js"
import { pauseScope, type Pauses, type PauseScope } from "./Pauses.js"
import type { ProjectView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"
import { WorktreeRefusal, type Caller, type WorktreeChanges } from "./WorktreeChanges.js"

interface WorkspaceRouterContext {
  /** Every project with its worktrees and their statuses, as of now. */
  readonly projects: () => readonly ProjectView[]
  /** Problems with the workspace itself. */
  readonly banners: () => readonly Banner[]
  readonly actions: ActionRuns
  readonly feeds: FeedRunner
  /** Proceed or Retry, as the identity that sent the request. */
  readonly press: (
    action: PressAction,
    input: { readonly worktree: string; readonly commit: string },
  ) => Promise<PressOutcome>
  readonly dispatch: Dispatcher
  readonly pauses: Pauses
  readonly worktreeChanges: WorktreeChanges
  /** Runs `git <args>` in `cwd`; rejects when git fails. */
  readonly git: (cwd: string, args: readonly string[]) => Promise<string>
  /** Who sent the request, and where, for the audit log. */
  readonly caller: Caller
}

const t = initTRPC.context<WorkspaceRouterContext>().create()

const pauseInput = (value: unknown): PauseScope => {
  const scope = pauseScope(value ?? {})
  if (scope === undefined)
    throw new TRPCError({ code: "BAD_REQUEST", message: "expected { project?, feed? }" })
  return scope
}

const setPause = (ctx: WorkspaceRouterContext, scope: PauseScope, paused: boolean): void => {
  const refusal = ctx.pauses.set(scope, paused, ctx.caller)
  if (refusal !== undefined) throw new TRPCError({ code: "NOT_FOUND", message: refusal })
}

const text = (value: unknown, key: string): string => {
  const field = (value as Record<string, unknown> | null | undefined)?.[key]
  if (typeof field !== "string" || field === "") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${key} must be a non-empty string` })
  }
  return field
}

const worktreeInput = (value: unknown) => ({
  project: text(value, "project"),
  /** The worktree's path, as the `projects` query reports it. */
  worktree: text(value, "worktree"),
})

/** `head` only keys the client's cache: a new HEAD reloads the tab. */
const retrospectiveInput = (value: unknown) => ({
  ...worktreeInput(value),
  head: ((value as Record<string, unknown>)["head"] ?? "") as string,
})

const runActionInput = (value: unknown) => ({
  ...worktreeInput(value),
  action: text(value, "action"),
  values: (value as Record<string, unknown>)["values"] ?? {},
})

const REFUSAL_CODES = {
  notFound: "NOT_FOUND",
  notOffered: "CONFLICT",
  invalid: "BAD_REQUEST",
  protected: "CONFLICT",
  unsupported: "PRECONDITION_FAILED",
} as const

const optionalText = (value: unknown, key: string): string | undefined => {
  const field = (value as Record<string, unknown> | null | undefined)?.[key]
  if (field !== undefined && typeof field !== "string") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${key} must be a string` })
  }
  return field
}

const createWorktreeInput = (value: unknown) => {
  const branch = optionalText(value, "branch")
  const base = optionalText(value, "base")
  const description = optionalText(value, "description")
  if (branch === undefined && description === undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "expected { project, branch, base? } or { project, description }",
    })
  }
  return {
    project: text(value, "project"),
    branch: branch ?? "",
    ...(description !== undefined ? { description } : {}),
    ...(base !== undefined ? { base } : {}),
  }
}

const removeWorktreeInput = (value: unknown) => ({
  ...worktreeInput(value),
  confirmed: (value as Record<string, unknown>)["confirmed"] === true,
})

const refusals = async <A>(body: () => Promise<A>): Promise<A> => {
  try {
    return await body()
  } catch (error) {
    if (error instanceof ActionRefusal || error instanceof WorktreeRefusal) {
      throw new TRPCError({ code: REFUSAL_CODES[error.reason], message: error.message })
    }
    throw error
  }
}

const itemRef = (input: unknown): { feed: string; key: string } => {
  const { feed, key } = (input ?? {}) as Record<string, unknown>
  if (typeof feed !== "string" || typeof key !== "string")
    throw new TRPCError({ code: "BAD_REQUEST", message: "expected { feed, key }" })
  return { feed, key }
}

const pressInput = (input: unknown): { worktree: string; commit: string } => {
  const { worktree, commit } = (input ?? {}) as Record<string, unknown>
  if (typeof worktree !== "string" || typeof commit !== "string")
    throw new TRPCError({ code: "BAD_REQUEST", message: "expected { worktree, commit }" })
  return { worktree, commit }
}

const pressed = async (outcome: Promise<PressOutcome>): Promise<void> => {
  const result = await outcome
  if (result.outcome === "accepted") return
  throw new TRPCError({
    code: result.outcome === "unknown" ? "NOT_FOUND" : "CONFLICT",
    message: result.message,
  })
}

export interface RetroCost {
  readonly cost: number
  readonly model: string | undefined
}

export interface RetroVerdict {
  readonly id: string
  readonly answer: string | number | boolean
  readonly p: number
  readonly sentBack: boolean
}

export interface RetroStep {
  readonly hash: string
  readonly actor: string
  readonly from: string | undefined
  readonly to: string
  readonly time: string
  /** Seconds since the previous step of the process; `undefined` for the first. */
  readonly gap: number | undefined
  readonly costs: readonly RetroCost[]
  readonly verdicts: readonly RetroVerdict[]
  readonly approvedBy: string | undefined
  /** The ship a ship step put on the user's branch; no subject when that commit is gone. */
  readonly shipped: { readonly hash: string; readonly subject: string | undefined } | undefined
  /** A check step's exit code; `undefined` when the commit has none. */
  readonly exit: number | undefined
  readonly ticked: readonly string[]
  readonly written: readonly string[]
  readonly notes: readonly string[]
  /** The to-do the entry commit added; first step only. */
  readonly todo: string | undefined
}

export interface RetroProcess {
  readonly entry: string
  readonly finished: boolean
  readonly steps: readonly RetroStep[]
  readonly total: number
  readonly byModel: Readonly<Record<string, number>>
}

export interface Retrospective {
  /** Newest process first; steps inside oldest first. */
  readonly processes: readonly RetroProcess[]
  readonly total: number
  readonly byModel: Readonly<Record<string, number>>
}

type Git = WorkspaceRouterContext["git"]

const PROCESS_HISTORY_PREFIX = "refs/gtd/history/"

// The supervisor may not import the engine's commit codec, so it reads the few
// trailers the tab shows itself; a malformed line is skipped.
interface Message {
  readonly parsed: { actor: string; to: string; from?: string } | undefined
  readonly workflow: string | undefined
  readonly branch: string | undefined
  readonly pin: boolean
  readonly exit: number | undefined
  readonly approvedBy: string | undefined
  readonly shipped: string | undefined
  readonly cost: RetroCost[]
  readonly judge: { id: string; answer: string | number | boolean; p: number }[]
}

const SUBJECT = /^gtd\(([^()]+)\): (.+)$/

const json = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

// fallow-ignore-next-line complexity
const parseCommitMessage = (message: string): Message => {
  const [subject = "", ...rest] = message.split("\n")
  const match = SUBJECT.exec(subject.trim())
  const arrow = match?.[2]?.lastIndexOf(" → ") ?? -1
  const parsed =
    match === null
      ? undefined
      : arrow === -1
        ? { actor: match[1]!, to: match[2]! }
        : {
            actor: match[1]!,
            from: match[2]!.slice(0, arrow),
            to: match[2]!.slice(arrow + 3),
          }
  const out: {
    workflow?: string
    branch?: string
    pin: boolean
    exit?: number
    approvedBy?: string
    shipped?: string
    cost: RetroCost[]
    judge: Message["judge"]
  } = { pin: false, cost: [], judge: [] }
  for (const line of rest) {
    const t = /^(Gtd-[A-Za-z-]+):[ \t]*(.*?)[ \t]*$/.exec(line)
    if (t === null) continue
    const [, key, value = ""] = t
    if (key === "Gtd-Workflow" && value !== "") out.workflow ??= value
    else if (key === "Gtd-Branch" && value !== "") out.branch ??= value
    else if (key === "Gtd-Pin") out.pin = true
    else if (key === "Gtd-Shipped" && /^[0-9a-f]{40}$/.test(value)) out.shipped ??= value
    else if (key === "Gtd-Exit" && /^[0-9]{1,3}$/.test(value)) out.exit ??= Number(value)
    else if (key === "Gtd-Cost") {
      const c = /^([0-9]+(?:\.[0-9]+)?)(?:[ \t]+(.+))?$/.exec(value)
      if (c !== null) out.cost.push({ cost: Number(c[1]), model: c[2]?.trim() || undefined })
    } else if (key === "Gtd-Judge") {
      const v = json(value) as Message["judge"][number] | undefined
      if (typeof v?.id === "string" && typeof v.p === "number") out.judge.push(v)
    } else if (key === "Gtd-Approved") {
      const a = json(value) as { name?: unknown } | undefined
      if (typeof a?.name === "string") out.approvedBy ??= a.name
    }
  }
  return { parsed, ...out } as Message
}

const RECORD = "\x1e"
const FIELD = "\x1f"
const ENTRY_HASH = /^[0-9a-f]{40}([0-9a-f]{24})?$/

interface RawCommit {
  readonly hash: string
  readonly time: string
  readonly message: string
}

const logOf = async (
  git: Git,
  cwd: string,
  rev: string,
  extra: readonly string[] = [],
): Promise<readonly RawCommit[]> => {
  const out = await git(cwd, [
    "log",
    "--first-parent",
    "--reverse",
    ...extra,
    `--format=%H${FIELD}%cI${FIELD}%B${RECORD}`,
    rev,
  ])
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r !== "")
    .map((r) => {
      const [hash = "", time = "", message = ""] = r.split(FIELD)
      return { hash, time, message }
    })
}

const tryGit = async (git: Git, cwd: string, args: readonly string[]): Promise<string> => {
  try {
    return await git(cwd, args)
  } catch {
    return ""
  }
}

// fallow-ignore-next-line complexity
const inputsOf = (before: string, after: string) => {
  const was = parseWidgets(before).widgets
  const ticked: string[] = []
  const written: string[] = []
  for (const w of parseWidgets(after).widgets) {
    const old = was.find((o) => o.kind === w.kind && o.title === w.title)
    if (w.kind === "boolean") {
      if (w.checked && !(old?.kind === "boolean" && old.checked)) ticked.push(w.label)
    } else if (w.kind === "single-select" || w.kind === "multi-select") {
      const prev = old?.kind === w.kind ? old : undefined
      for (const o of w.options) {
        if (o.checked && !prev?.options.some((p) => p.label === o.label && p.checked))
          ticked.push(o.label)
      }
      if (w.custom !== undefined && w.custom.text !== "" && w.custom.text !== prev?.custom?.text)
        written.push(w.custom.text)
    }
  }
  const notes = parseFootnotes(after).definitions.filter(
    (d) => !parseFootnotes(before).definitions.some((p) => p.name === d.name && p.body === d.body),
  )
  return { ticked, written, notes: notes.map((d) => d.body) }
}

const changedMarkdown = async (git: Git, cwd: string, hash: string): Promise<string[]> =>
  (await tryGit(git, cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", hash]))
    .split("\n")
    .filter((f) => /\.md$/i.test(f) && f.startsWith(".gtd/"))

const TODO_LIMIT = 4000

const todoOf = async (git: Git, cwd: string, hash: string): Promise<string | undefined> => {
  const files = (
    await tryGit(git, cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", hash])
  )
    .split("\n")
    .filter((f) => /\.(md|txt)$/i.test(f))
  const texts = await Promise.all(files.map((f) => tryGit(git, cwd, ["show", `${hash}:${f}`])))
  const text = texts.join("\n").trim()
  return text === "" ? undefined : text.slice(0, TODO_LIMIT)
}

const addTo = (into: Record<string, number>, costs: readonly RetroCost[]): number => {
  let sum = 0
  for (const c of costs) {
    into[c.model ?? "unknown"] = (into[c.model ?? "unknown"] ?? 0) + c.cost
    sum += c.cost
  }
  return sum
}

/** A landing's ship: its second parent, or the trailer an older gtd wrote. */
const shippedOf = async (git: Git, cwd: string, hash: string, trailer: string | undefined) => {
  const ship =
    (await tryGit(git, cwd, ["rev-parse", "--verify", "-q", `${hash}^2`])).trim() || trailer
  if (ship === undefined || ship === "") return undefined
  const subject = (await tryGit(git, cwd, ["log", "-1", "--format=%s", ship])).trim()
  return { hash: ship, subject: subject === "" ? undefined : subject }
}

// fallow-ignore-next-line complexity
const processOf = async (
  git: Git,
  cwd: string,
  commits: readonly RawCommit[],
): Promise<RetroProcess | undefined> => {
  const visited = new Set<string>()
  const steps: RetroStep[] = []
  const byModel: Record<string, number> = {}
  let total = 0
  let previous: number | undefined
  let finished = false
  for (const [index, commit] of commits.entries()) {
    const m = parseCommitMessage(commit.message)
    // The closing unpin carries `Gtd-Branch` too.
    if (m.branch !== undefined) finished = true
    if (m.parsed === undefined || m.pin) continue
    const { actor, to, from } = m.parsed
    const time = Date.parse(commit.time)
    const sentBack = visited.has(to)
    let ticked: string[] = []
    let written: string[] = []
    let notes: string[] = []
    if (actor === "human") {
      for (const file of await changedMarkdown(git, cwd, commit.hash)) {
        const before = await tryGit(git, cwd, ["show", `${commit.hash}^:${file}`])
        const after = await tryGit(git, cwd, ["show", `${commit.hash}:${file}`])
        const read = inputsOf(before, after)
        ticked = [...ticked, ...read.ticked]
        written = [...written, ...read.written]
        notes = [...notes, ...read.notes]
      }
    }
    total += addTo(byModel, m.cost)
    steps.push({
      hash: commit.hash,
      actor,
      from,
      to,
      time: commit.time,
      gap: previous === undefined ? undefined : Math.max(0, Math.round((time - previous) / 1000)),
      costs: m.cost,
      verdicts: m.judge.map((v) => ({ ...v, sentBack })),
      approvedBy: m.approvedBy,
      shipped: await shippedOf(git, cwd, commit.hash, m.shipped),
      exit: m.exit,
      ticked,
      written,
      notes,
      todo: index === 0 ? await todoOf(git, cwd, commit.hash) : undefined,
    })
    if (from !== undefined) visited.add(from)
    visited.add(to)
    previous = time
  }
  const first = commits[0]
  return first === undefined || steps.length === 0
    ? undefined
    : { entry: first.hash, finished, steps, total, byModel }
}

/**
 * The commits of the process that ends at `rev`. A finished process starts at
 * the entry hash of its ref name; the live one starts at a bare `gtd(human)`
 * opening, or right after a commit that is not a step commit or that finished
 * an earlier process (`Gtd-Branch`).
 */
// fallow-ignore-next-line complexity
const lastProcess = async (
  git: Git,
  cwd: string,
  rev: string,
  entry?: string,
): Promise<RawCommit[]> => {
  if (entry !== undefined) {
    const hasParent = (await tryGit(git, cwd, ["rev-parse", "--verify", "-q", `${entry}^`])) !== ""
    if (
      !hasParent &&
      (await tryGit(git, cwd, ["rev-parse", "--verify", "-q", `${entry}^{commit}`])) === ""
    )
      return []
    const log = await logOf(git, cwd, hasParent ? `${entry}^..${rev}` : rev)
    return log[0]?.hash === entry ? [...log] : []
  }
  const PAGE = 50
  let collected: RawCommit[] = []
  let from = rev
  for (;;) {
    const page = await logOf(git, cwd, from, ["-n", String(PAGE)])
    collected = [...page, ...collected]
    for (let i = page.length - 1; i >= 0; i--) {
      const m = parseCommitMessage(page[i]!.message)
      if (m.parsed?.from === undefined && m.parsed?.actor === "human") return collected.slice(i)
      if (m.parsed === undefined || m.branch !== undefined) return collected.slice(i + 1)
    }
    const oldest = page[0]
    if (oldest === undefined || page.length < PAGE) return collected
    if ((await tryGit(git, cwd, ["rev-parse", "--verify", "-q", `${oldest.hash}^`])) === "")
      return collected
    from = `${oldest.hash}^`
  }
}

const isAncestor = async (git: Git, cwd: string, tip: string): Promise<boolean> => {
  try {
    await git(cwd, ["merge-base", "--is-ancestor", tip, "HEAD"])
    return true
  } catch {
    return false
  }
}

// A kept process never changes, so its read is reused per entry and tip.
const finishedCache = new Map<string, RetroProcess | undefined>()
const finishedProcess = async (git: Git, cwd: string, tip: string, entry: string) => {
  const key = `${cwd}\0${entry}\0${tip}`
  if (finishedCache.has(key)) return finishedCache.get(key)
  const process = await processOf(git, cwd, await tryLast(git, cwd, tip, entry))
  finishedCache.set(key, process)
  return process
}

// fallow-ignore-next-line complexity
const retrospective = async (
  git: Git,
  cwd: string,
  branch: string | undefined,
): Promise<Retrospective> => {
  const found: RetroProcess[] = []
  const user = branch?.replace(/^gtd\//, "")
  const live = await processOf(git, cwd, await tryLast(git, cwd, "HEAD"))
  if (live !== undefined) found.push(live)
  const refs = (
    await tryGit(git, cwd, [
      "for-each-ref",
      "--format=%(refname)%09%(objectname)",
      PROCESS_HISTORY_PREFIX,
    ])
  )
    .split("\n")
    .map((l) => l.split("\t") as [string, string])
    .filter(([ref]) => ENTRY_HASH.test((ref ?? "").slice(PROCESS_HISTORY_PREFIX.length)))
  for (const [ref, tip] of refs) {
    if (branch === undefined) break
    const tipMessage = parseCommitMessage(await tryGit(git, cwd, ["log", "-1", "--format=%B", tip]))
    // A finished tip names the user's branch; a stopped one has no landing, so
    // it belongs to the worktree when it is an ancestor of its HEAD.
    if (tipMessage.branch !== user && !(await isAncestor(git, cwd, tip))) continue
    const entry = ref.slice(PROCESS_HISTORY_PREFIX.length)
    const process = await finishedProcess(git, cwd, tip, entry)
    if (process !== undefined && !found.some((p) => p.entry === process.entry)) found.push(process)
  }
  found.sort((a, b) => Date.parse(b.steps[0]!.time) - Date.parse(a.steps[0]!.time))
  const byModel: Record<string, number> = {}
  let total = 0
  for (const p of found) {
    total += p.total
    for (const [model, cost] of Object.entries(p.byModel))
      byModel[model] = (byModel[model] ?? 0) + cost
  }
  return { processes: found, total, byModel }
}

const tryLast = async (
  git: Git,
  cwd: string,
  rev: string,
  entry?: string,
): Promise<RawCommit[]> => {
  try {
    return await lastProcess(git, cwd, rev, entry)
  } catch {
    return []
  }
}

/** The dashboard's API, served under `/trpc`. */
export const workspaceRouter = t.router({
  projects: t.procedure.query(({ ctx }) => ctx.projects()),
  banners: t.procedure.query(({ ctx }) => ctx.banners()),
  /** The action picker: the actions offered in the worktree's status now, with their fields. */
  actions: t.procedure
    .input(worktreeInput)
    .query(({ ctx, input }) => refusals(() => ctx.actions.offered(input.project, input.worktree))),
  /** Every process on the worktree's branch, read from git alone. */
  // fallow-ignore-next-line complexity
  retrospective: t.procedure.input(retrospectiveInput).query(({ ctx, input }) => {
    const found = ctx
      .projects()
      .find((p) => p.id === input.project)
      ?.worktrees.find((w) => w.path === input.worktree)
    if (found === undefined)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no worktree ${input.project}/${input.worktree}`,
      })
    return retrospective(ctx.git, found.path, found.branch)
  }),
  runAction: t.procedure.input(runActionInput).mutation(({ ctx, input }) =>
    refusals(async () => {
      await ctx.actions.run(input.project, input.worktree, input.action, input.values)
      return { ok: true as const }
    }),
  ),
  proceed: t.procedure
    .input(pressInput)
    .mutation(({ ctx, input }) => pressed(ctx.press("proceed", input))),
  retry: t.procedure
    .input(pressInput)
    .mutation(({ ctx, input }) => pressed(ctx.press("retry", input))),
  /** New worktree: `failure` says why its services did not start. */
  createWorktree: t.procedure
    .input(createWorktreeInput)
    .mutation(({ ctx, input }) =>
      refusals(() =>
        ctx.worktreeChanges.create(
          input.project,
          input.branch,
          input.base,
          ctx.caller,
          input.description,
        ),
      ),
    ),
  /** Remove: `{ confirm }` lists what a person must confirm first; `{ removed: true }` once it is gone. */
  removeWorktree: t.procedure
    .input(removeWorktreeInput)
    .mutation(({ ctx, input }) =>
      refusals(() =>
        ctx.worktreeChanges.remove(input.project, input.worktree, input.confirmed, ctx.caller),
      ),
    ),
  inbox: t.procedure.query(({ ctx }) => ({
    items: ctx.feeds.items(),
    feeds: ctx.feeds.feeds(),
    drives: ctx.dispatch.drives(),
    paused: ctx.pauses.list(),
  })),
  dismiss: t.procedure.input(itemRef).mutation(({ ctx, input }) => {
    if (!ctx.feeds.dismiss(input.feed, input.key))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no proposed or failed item ${input.feed}/${input.key}`,
      })
  }),
  /** Start: dispatches a proposed item; the `inbox` query shows how far it got. */
  startItem: t.procedure.input(itemRef).mutation(async ({ ctx, input }) => {
    if (!(await ctx.dispatch.press("start", input.feed, input.key, ctx.caller)))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no proposed item ${input.feed}/${input.key}`,
      })
  }),
  /** Retry: dispatches a failed item again. */
  retryItem: t.procedure.input(itemRef).mutation(async ({ ctx, input }) => {
    if (!(await ctx.dispatch.press("retry", input.feed, input.key, ctx.caller)))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no failed item ${input.feed}/${input.key} of a feed in the config`,
      })
  }),
  /** Pauses dispatch in the workspace (`{}`), a project, or a feed of a project. */
  pause: t.procedure.input(pauseInput).mutation(({ ctx, input }) => setPause(ctx, input, true)),
  /** Takes off the pause of exactly that scope, and starts what can start now. */
  resume: t.procedure.input(pauseInput).mutation(({ ctx, input }) => {
    setPause(ctx, input, false)
    // What can start now starts after the answer.
    void ctx.dispatch.pass().catch(() => {})
  }),
})

export type WorkspaceRouter = typeof workspaceRouter
