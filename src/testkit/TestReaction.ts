import type {
  ActionValues,
  ExecResult,
  NotificationPriority,
  Reaction,
  ReactionContext,
  ReactionOutcome,
  WorktreeChange,
} from "../workspace/index.js"
import { runReaction } from "../workspace/internal.js"

/** What a reaction asked gtd to do through its ctx, in order. */
export type ReactionCall =
  | { readonly call: "action"; readonly id: string; readonly values: ActionValues }
  | { readonly call: "proceed" | "retry"; readonly commit: string }
  | {
      readonly call: "notify"
      readonly title: string
      readonly body: string
      readonly priority: NotificationPriority
    }

export interface TestReactionOptions {
  /** Answers `ctx.exec`; without it, any exec fails the run. `cwd` is the worktree unless the reaction gives one. */
  readonly exec?: (
    argv: readonly string[],
    options?: { readonly cwd?: string },
  ) => ExecResult | Promise<ExecResult>
  /** Answers `ctx.fetch`; without it, any fetch fails the run. */
  readonly fetch?: typeof globalThis.fetch
  /** Answers `ctx.action`, `ctx.proceed` and `ctx.retry`. Default: `{ ok: true }`. */
  readonly answer?: (
    call: Exclude<ReactionCall, { readonly call: "notify" }>,
  ) => ReactionOutcome | Promise<ReactionOutcome>
}

export interface ReactionRunResult {
  /** The change matched the reaction's `on`, so `run` ran. */
  readonly ran: boolean
  /** Why `run` threw. */
  readonly failure?: string
  readonly logs: readonly string[]
  readonly calls: readonly ReactionCall[]
}

/** A change as a test gives it: `atStartup` is `false` unless set. */
export type TestChange = Omit<WorktreeChange, "atStartup"> & { readonly atStartup?: boolean }

const urlOf = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url

/** Delivers one change to a reaction, as the supervisor does, against a scripted ctx. */
export const testReaction = async (
  reaction: Reaction,
  change: TestChange,
  options: TestReactionOptions = {},
): Promise<ReactionRunResult> => {
  const logs: string[] = []
  const calls: ReactionCall[] = []
  const act = async (
    call: Exclude<ReactionCall, { readonly call: "notify" }>,
  ): Promise<ReactionOutcome> => {
    calls.push(call)
    return options.answer === undefined ? { ok: true } : options.answer(call)
  }
  const ctx: ReactionContext = {
    action: (id, values = {}) => act({ call: "action", id, values }),
    proceed: (commit) => act({ call: "proceed", commit }),
    retry: (commit) => act({ call: "retry", commit }),
    notify: async ({ title, body = "", priority = "default" }) =>
      void calls.push({ call: "notify", title, body, priority }),
    exec: async (argv, execOptions) => {
      if (options.exec === undefined)
        throw new Error(`testReaction: no exec given for ${argv.join(" ")}`)
      return options.exec(argv, { cwd: execOptions?.cwd ?? change.worktree })
    },
    fetch: async (input, init) => {
      if (options.fetch === undefined)
        throw new Error(`testReaction: no fetch given for ${urlOf(input)}`)
      return options.fetch(input, init)
    },
    log: (message) => void logs.push(message),
  }
  const { ran, failure } = await runReaction(
    reaction,
    { ...change, atStartup: change.atStartup ?? false },
    ctx,
  )
  return { ran, ...(failure !== undefined ? { failure } : {}), logs, calls }
}
