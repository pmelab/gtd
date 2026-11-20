import { dirname } from "node:path"
import { Effect } from "effect"
import { UiError } from "../ui/index.js"
import { nowView, reasonText, statusText, worktreeName } from "../workspace/internal.js"
import type { NowEntry } from "../workspace/internal.js"
import type { TerminalAdapter } from "../workspace/index.js"
import { findWorkspaceModule, loadWorkspace } from "./Config.js"
import { SupervisorHost } from "./Ports.js"
import { send, socketFor, type SharedProject } from "./Socket.js"

export interface NowInput {
  readonly isTTY?: boolean
  readonly setRawMode?: (raw: boolean) => unknown
  readonly on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown
  readonly off: (event: "data", listener: (chunk: Buffer | string) => void) => unknown
  readonly resume: () => unknown
  readonly pause: () => unknown
}

export interface NowOutput {
  readonly isTTY?: boolean
  readonly columns?: number
  readonly rows?: number
  readonly write: (chunk: string) => unknown
}

export interface NowCommand {
  readonly config?: string
  readonly cwd: string
  readonly stateHome: string
  readonly loadModule: (path: string) => Promise<Readonly<Record<string, unknown>>>
  readonly input?: NowInput
  readonly output?: NowOutput
  /** How often the supervisor is read. */
  readonly pollMs?: number
}

type Entry = NowEntry<SharedProject>

const fit = (text: string, width: number): string =>
  text.length <= width
    ? text
    : width <= 1
      ? text.slice(0, Math.max(width, 0))
      : `${text.slice(0, width - 1)}…`

/** One row that never exceeds `columns - 1`: the reason shrinks first, then the name. */
const row = (entry: Entry, index: number, selected: boolean, columns: number): string => {
  const { project, worktree } = entry
  const room = columns - 1
  const lead = `${selected ? ">" : " "} ${index < 9 ? String(index + 1) : " "} `
  const status = statusText(worktree)
  const reason = reasonText(worktree)
  const name = worktreeName(worktree)
  const fixed = lead.length + project.name.length + 1 + 1 + status.length
  const spare = room - fixed - name.length
  if (reason === "" ? spare >= 0 : spare >= 2) {
    const tail = reason === "" ? "" : ` ${fit(reason, spare - 1)}`
    return `${lead}${project.name} ${name} ${status}${tail}`
  }
  const shortName = fit(name, Math.max(room - fixed, 1))
  return `${lead}${project.name} ${shortName} ${status}`
}

/** `height` attention rows from `top`, so the list never pushes the rest off the screen. */
const screen = (
  projects: readonly SharedProject[],
  selected: string | undefined,
  columns: number,
  top: number,
  height: number,
  notice: string | undefined,
  message: string | undefined,
): string => {
  const { attention, working } = nowView(projects)
  const lines =
    attention.length === 0
      ? ["Nothing needs you."]
      : attention.slice(top, top + height).map((entry, offset) => {
          const index = top + offset
          const text = row(entry, index, entry.worktree.path === selected, columns)
          return entry.worktree.path === selected ? `\x1b[7m${text}\x1b[0m` : text
        })
  lines.push(`${working.length} working`)
  if (notice !== undefined) lines.push(fit(notice, columns - 1))
  if (message !== undefined) lines.push(fit(message, columns - 1))
  return `\x1b[H\x1b[2J${lines.join("\r\n")}`
}

// A whole CSI sequence is one key, so Delete (`ESC [3~`) or F5 (`ESC [15~`) never reads as a digit.
const KEY = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[~A-Za-z]|[\\s\\S]`, "g")

type Reach =
  | { readonly projects: readonly SharedProject[] }
  | { readonly refused: string }
  | undefined

const reachable = async (path: string, timeoutMs: number): Promise<Reach> => {
  const reply = await send(path, { command: "projects" }, timeoutMs)
  if (reply === undefined) return undefined
  return reply.ok ? { projects: reply.projects ?? [] } : { refused: reply.message }
}

const errText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const focusMessage = async (terminal: TerminalAdapter, entry: Entry): Promise<string> => {
  const { pane, path: where } = entry.worktree
  if (pane === undefined) return `no driver pane — ${where}`
  if (terminal.focus === undefined) return `pane ${pane} — ${where}`
  try {
    await terminal.focus(pane)
    return `focused ${pane}`
  } catch (error) {
    return errText(error)
  }
}

const pollNotice = async (
  path: string,
  timeoutMs: number,
): Promise<{ readonly projects?: readonly SharedProject[]; readonly notice?: string }> => {
  try {
    const next = await reachable(path, timeoutMs)
    if (next === undefined) return { notice: "supervisor not running — trying again" }
    if ("refused" in next) return { notice: next.refused }
    return { projects: next.projects }
  } catch (error) {
    return { notice: `${errText(error)} — trying again` }
  }
}

const keepSelected = (rows: readonly Entry[], selected: string | undefined): string | undefined =>
  rows.some((e) => e.worktree.path === selected) ? selected : rows[0]?.worktree.path

const scrollTop = (
  rows: readonly Entry[],
  selected: string | undefined,
  top: number,
  height: number,
): number => {
  const at = Math.max(
    rows.findIndex((e) => e.worktree.path === selected),
    0,
  )
  return Math.min(Math.max(top, at - height + 1), at, Math.max(rows.length - height, 0))
}

const moveSelection = (
  rows: readonly Entry[],
  selected: string | undefined,
  by: number,
): string | undefined => {
  if (rows.length === 0) return selected
  const at = rows.findIndex((e) => e.worktree.path === selected)
  const next = Math.min(Math.max((at === -1 ? 0 : at) + by, 0), rows.length - 1)
  return rows[next]?.worktree.path
}

interface Session {
  readonly input: NowInput
  readonly output: NowOutput
  readonly terminal: TerminalAdapter
  readonly path: string
  readonly pollMs: number
  readonly timeoutMs: number
  readonly projects: readonly SharedProject[]
}

const runSession = (
  { input, output, terminal, path, pollMs, timeoutMs, projects }: Session,
  resume: (effect: Effect.Effect<void>) => void,
): Effect.Effect<void> => {
  const finish = (): void => resume(Effect.void)
  let current = projects
  let selected: string | undefined
  let notice: string | undefined
  let message: string | undefined
  let top = 0
  const attention = (): readonly Entry[] => nowView(current).attention
  let closed = false
  const draw = (): void => {
    if (closed) return
    const rows = attention()
    selected = keepSelected(rows, selected)
    const below = 2 + (notice === undefined ? 0 : 1) + (message === undefined ? 0 : 1)
    const height = Math.max((output.rows ?? 24) - below, 1)
    top = scrollTop(rows, selected, top, height)
    output.write(screen(current, selected, output.columns ?? 80, top, height, notice, message))
  }
  const move = (by: number): void => {
    selected = moveSelection(attention(), selected, by)
  }
  const jump = async (entry: Entry | undefined): Promise<void> => {
    if (entry === undefined) return
    message = await focusMessage(terminal, entry)
    draw()
  }
  let polling = false
  const poll = async (): Promise<void> => {
    if (polling) return
    polling = true
    const next = await pollNotice(path, timeoutMs)
    if (next.projects !== undefined) current = next.projects
    notice = next.notice
    polling = false
    draw()
  }
  const timer = setInterval(() => void poll(), pollMs)
  const done = (): void => {
    if (closed) return
    closed = true
    clearInterval(timer)
    input.off("data", onData)
    input.setRawMode?.(false)
    input.pause()
    output.write("\x1b[?25h\x1b[?1049l")
    finish()
  }
  const selectedEntry = (): Entry | undefined =>
    attention().find((e) => e.worktree.path === selected)
  const onKey = (key: string): void => {
    const actions: Record<string, () => void> = {
      "\x1b[A": () => move(-1),
      k: () => move(-1),
      "\x1b[B": () => move(1),
      j: () => move(1),
      "\r": () => void jump(selectedEntry()),
      "\n": () => void jump(selectedEntry()),
    }
    if (/^[1-9]$/.test(key)) void jump(attention()[Number(key) - 1])
    else actions[key]?.()
  }
  const onData = (chunk: Buffer | string): void => {
    message = undefined
    for (const key of String(chunk).match(KEY) ?? []) {
      if (key === "q" || key === "\x03") return done()
      onKey(key)
    }
    draw()
  }
  output.write("\x1b[?1049h\x1b[?25l")
  input.setRawMode?.(true)
  input.resume()
  input.on("data", onData)
  draw()
  return Effect.sync(done)
}

const reachProjects = (
  reach: Reach,
  file: string,
): Effect.Effect<readonly SharedProject[], UiError> => {
  if (reach === undefined) {
    return Effect.fail(
      new UiError(`gtd workspace now: supervisor not running for ${dirname(file)}`),
    )
  }
  if ("refused" in reach) return Effect.fail(new UiError(`gtd workspace now: ${reach.refused}`))
  return Effect.succeed(reach.projects)
}

/** `gtd workspace now`: the Now view in the terminal, with a jump to the pane of a gate. */
export const runNowCommand = (command: NowCommand): Effect.Effect<void, UiError, SupervisorHost> =>
  Effect.gen(function* () {
    const host = yield* SupervisorHost
    const input: NowInput = command.input ?? process.stdin
    const output: NowOutput = command.output ?? process.stdout
    if (!(input.isTTY === true && output.isTTY === true)) {
      return yield* Effect.fail(new UiError("gtd workspace now: needs a terminal"))
    }
    const file = findWorkspaceModule(command.cwd, command.config)
    const path = socketFor(command.cwd, command.config, command.stateHome)
    const pollMs = command.pollMs ?? 1000
    const timeoutMs = pollMs * 5
    const reach = yield* Effect.tryPromise({
      try: () => reachable(path, timeoutMs),
      catch: (error) => new UiError(`gtd workspace now: ${errText(error)}`),
    })
    const projects = yield* reachProjects(reach, file)
    const loaded = yield* Effect.tryPromise({
      try: () => loadWorkspace(file, command.loadModule),
      catch: (error) => new UiError(errText(error)),
    })
    const terminal: TerminalAdapter = loaded.settings.adapters?.terminal ?? host.defaultTerminal()
    yield* Effect.callback<void>((resume) =>
      runSession({ input, output, terminal, path, pollMs, timeoutMs, projects }, resume),
    )
  })
