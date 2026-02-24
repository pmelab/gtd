import chalk from "chalk"
import type { AgentEvent } from "./AgentEvent.js"

// --- Types ---

export type BuildStatus = "pending" | "building" | "fixing" | "testing" | "done" | "failed"

export interface BuildPackageState {
  readonly title: string
  readonly status: BuildStatus
  readonly startedAt: number | undefined
  readonly finishedAt: number | undefined
  readonly retryCount: number
  readonly maxRetries: number
}

export interface BuildState {
  readonly packages: ReadonlyArray<BuildPackageState>
  readonly startedAt: number
}

// --- Pure state functions ---

export const initBuildState = (
  packages: ReadonlyArray<{
    readonly title: string
    readonly items: ReadonlyArray<{ readonly checked: boolean }>
  }>,
  now?: number,
): BuildState => ({
  startedAt: now ?? Date.now(),
  packages: packages.map((pkg) => ({
    title: pkg.title,
    status: pkg.items.every((i) => i.checked) ? ("done" as const) : ("pending" as const),
    startedAt: undefined,
    finishedAt: undefined,
    retryCount: 0,
    maxRetries: 0,
  })),
})

export const updatePackageStatus = (
  state: BuildState,
  title: string,
  status: BuildStatus,
  retryInfo?: { readonly current: number; readonly max: number },
  now?: number,
): BuildState => ({
  ...state,
  packages: state.packages.map((pkg) => {
    if (pkg.title !== title) return pkg
    const timestamp = now ?? Date.now()
    return {
      ...pkg,
      status,
      startedAt: pkg.startedAt ?? (status !== "pending" ? timestamp : undefined),
      finishedAt: status === "done" || status === "failed" ? timestamp : pkg.finishedAt,
      retryCount: retryInfo?.current ?? pkg.retryCount,
      maxRetries: retryInfo?.max ?? pkg.maxRetries,
    }
  }),
})

// --- Formatting functions ---

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return "<1s"
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m${seconds > 0 ? `${seconds}s` : ""}`
}

// --- TTY detection ---

export const isInteractive = (): boolean => process.stdout.isTTY === true

// --- Shared helpers ---

const compactToolInput = (input: unknown): string => {
  if (input == null) return ""
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>
    for (const val of Object.values(obj)) {
      if (typeof val === "string" && val.length > 0) {
        const oneLine = val.split("\n")[0]!
        return oneLine.length > 80 ? oneLine.slice(0, 80) + "..." : oneLine
      }
    }
  }
  return ""
}

const CLEAR_CHAR = "\x1b[1D \x1b[1D"
const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"
const BLOCK_CURSOR = "█"
interface EventHandler {
  readonly onEvent: (event: AgentEvent) => void
  readonly ensureNewline: () => void
}

const createEventHandler = (): EventHandler => {
  let thinking = false
  let dirty = false
  let cursorVisible = false
  let spinnerTimer: ReturnType<typeof setInterval> | undefined

  const stopSpinner = () => {
    if (spinnerTimer != null) {
      clearInterval(spinnerTimer)
      spinnerTimer = undefined
      if (cursorVisible) process.stdout.write(CLEAR_CHAR)
      cursorVisible = false
      process.stdout.write(SHOW_CURSOR)
    }
  }

  const startSpinner = () => {
    stopSpinner()
    process.stdout.write(HIDE_CURSOR + BLOCK_CURSOR)
    cursorVisible = true
    dirty = true
    spinnerTimer = setInterval(() => {
      if (cursorVisible) {
        process.stdout.write(CLEAR_CHAR)
        cursorVisible = false
      } else {
        process.stdout.write(BLOCK_CURSOR)
        cursorVisible = true
      }
    }, 530)
  }

  const endThinking = () => {
    stopSpinner()
    process.stdout.write("\n\n")
    thinking = false
    dirty = false
  }

  const ensureNewline = () => {
    stopSpinner()
    if (dirty) {
      process.stdout.write("\n")
      dirty = false
    }
  }

  return {
    onEvent: (event: AgentEvent) => {
      if (event._tag === "ThinkingDelta") {
        if (!thinking) {
          process.stdout.write("\n")
          thinking = true
        }
        stopSpinner()
        process.stdout.write(chalk.dim(event.delta))
        dirty = true
        startSpinner()
      } else {
        if (thinking) endThinking()
        if (event._tag === "ToolStart") {
          const preview = compactToolInput(event.toolInput)
          process.stdout.write(
            `🔨 ${event.toolName}:` + (preview ? " " + chalk.dim(preview) : "") + "\n",
          )
          dirty = false
        }
      }
    },
    ensureNewline,
  }
}

// --- SpinnerRenderer ---

export interface SpinnerRenderer {
  readonly onEvent: (event: AgentEvent) => void
  readonly setText: (text: string) => void
  readonly setTextWithCursor: (text: string) => void
  readonly stopCursor: () => void
  readonly succeed: (text: string) => void
  readonly fail: (text: string) => void
  readonly dispose: () => void
}

export const createSpinnerRenderer = (interactive: boolean): SpinnerRenderer => {
  if (!interactive) {
    let lastText = ""
    return {
      onEvent: () => {},
      setText: (text: string) => {
        if (text !== lastText) {
          lastText = text
          console.log(`[gtd] ${text}`)
        }
      },
      setTextWithCursor: (text: string) => {
        if (text !== lastText) {
          lastText = text
          console.log(`[gtd] ${text}`)
        }
      },
      stopCursor: () => {},
      succeed: (text: string) => console.log(`[gtd] ${text}`),
      fail: (text: string) => console.error(`[gtd] ${text}`),
      dispose: () => {},
    }
  }

  const handler = createEventHandler()
  let cursorVisible = false
  let cursorTimer: ReturnType<typeof setInterval> | undefined

  const stopCursor = () => {
    if (cursorTimer != null) {
      clearInterval(cursorTimer)
      cursorTimer = undefined
      if (cursorVisible) process.stdout.write(CLEAR_CHAR)
      cursorVisible = false
      process.stdout.write(SHOW_CURSOR)
    }
  }

  return {
    onEvent: handler.onEvent,
    setText: (text: string) => {
      stopCursor()
      handler.ensureNewline()
      process.stdout.write(chalk.cyan("◆") + " " + text + "\n")
    },
    setTextWithCursor: (text: string) => {
      stopCursor()
      handler.ensureNewline()
      process.stdout.write(chalk.cyan("◆") + " " + text)
      process.stdout.write(HIDE_CURSOR + BLOCK_CURSOR)
      cursorVisible = true
      cursorTimer = setInterval(() => {
        if (cursorVisible) {
          process.stdout.write(CLEAR_CHAR)
          cursorVisible = false
        } else {
          process.stdout.write(BLOCK_CURSOR)
          cursorVisible = true
        }
      }, 530)
    },
    stopCursor,
    succeed: (msg: string) => {
      stopCursor()
      handler.ensureNewline()
      process.stdout.write(chalk.green("✓") + " " + msg + "\n")
    },
    fail: (msg: string) => {
      stopCursor()
      handler.ensureNewline()
      process.stderr.write(chalk.red("✗") + " " + msg + "\n")
    },
    dispose: () => {
      stopCursor()
    },
  }
}

// --- BuildRenderer ---

export interface BuildRenderer {
  readonly onEvent: (event: AgentEvent) => void
  readonly setTextWithCursor: (text: string) => void
  readonly stopCursor: () => void
  readonly setStatus: (
    packageTitle: string,
    status: BuildStatus,
    retryInfo?: { current: number; max: number },
  ) => void
  readonly finish: (message: string) => void
  readonly dispose: () => void
}

export const createBuildRenderer = (
  packages: ReadonlyArray<{
    readonly title: string
    readonly items: ReadonlyArray<{ readonly checked: boolean }>
  }>,
  interactive: boolean,
): BuildRenderer => {
  let state = initBuildState(packages)

  if (!interactive) {
    return {
      onEvent: () => {},
      setTextWithCursor: (text: string) => console.log(`[gtd] ${text}`),
      stopCursor: () => {},
      setStatus: (
        title: string,
        status: BuildStatus,
        retryInfo?: { current: number; max: number },
      ) => {
        state = updatePackageStatus(state, title, status, retryInfo)
        const pkg = state.packages.find((p) => p.title === title)
        const icon = status === "done" ? "✓" : status === "failed" ? "✗" : "⠋"
        const duration =
          pkg?.startedAt != null && pkg?.finishedAt != null
            ? ` (${formatDuration(pkg.finishedAt - pkg.startedAt)})`
            : ""
        const retryLabel =
          status === "testing" && retryInfo && retryInfo.max > 1
            ? ` (${retryInfo.current}/${retryInfo.max})`
            : ""
        const label =
          status === "building" ? `Building "${title}"` :
          status === "fixing" ? `Fixing "${title}"` :
          status === "testing" ? `Testing "${title}"${retryLabel}` :
          status === "done" ? `"${title}"${duration}` :
          status === "failed" ? `"${title}" failed` :
          `"${title}"`
        console.log(`[gtd] ${icon} ${label}`)
      },
      finish: (message: string) => {
        console.log(`[gtd] ${message}`)
        console.log(`[gtd] ${formatSummary(state)}`)
      },
      dispose: () => {},
    }
  }

  const printStatus = (pkg: BuildPackageState) => {
    switch (pkg.status) {
      case "pending":
        process.stdout.write(chalk.dim(`□ ${pkg.title}`) + "\n")
        break
      case "building":
        process.stdout.write(chalk.cyan(`◆ Building "${pkg.title}"…`) + "\n")
        break
      case "fixing":
        process.stdout.write(chalk.rgb(255, 165, 0)(`◆ Fixing "${pkg.title}"…`) + "\n")
        break
      case "testing": {
        const retryLabel =
          pkg.maxRetries > 1 ? ` (${pkg.retryCount}/${pkg.maxRetries})` : ""
        process.stdout.write(chalk.yellow(`◆ Testing "${pkg.title}"${retryLabel}…`) + "\n")
        break
      }
      case "done": {
        const duration =
          pkg.startedAt != null && pkg.finishedAt != null
            ? ` (${formatDuration(pkg.finishedAt - pkg.startedAt)})`
            : ""
        process.stdout.write(
          chalk.green("✓ ") + chalk.dim.strikethrough(pkg.title) + chalk.dim(duration) + "\n",
        )
        break
      }
      case "failed":
        process.stdout.write(chalk.red(`✗ "${pkg.title}" failed`) + "\n")
        break
    }
  }

  const handler = createEventHandler()
  let bCursorVisible = false
  let bCursorTimer: ReturnType<typeof setInterval> | undefined

  const stopBuildCursor = () => {
    if (bCursorTimer != null) {
      clearInterval(bCursorTimer)
      bCursorTimer = undefined
      if (bCursorVisible) process.stdout.write(CLEAR_CHAR)
      bCursorVisible = false
      process.stdout.write(SHOW_CURSOR)
    }
  }

  return {
    onEvent: handler.onEvent,
    setTextWithCursor: (text: string) => {
      stopBuildCursor()
      handler.ensureNewline()
      process.stdout.write(chalk.cyan("◆") + " " + text)
      process.stdout.write(HIDE_CURSOR + BLOCK_CURSOR)
      bCursorVisible = true
      bCursorTimer = setInterval(() => {
        if (bCursorVisible) {
          process.stdout.write(CLEAR_CHAR)
          bCursorVisible = false
        } else {
          process.stdout.write(BLOCK_CURSOR)
          bCursorVisible = true
        }
      }, 530)
    },
    stopCursor: stopBuildCursor,
    setStatus: (
      title: string,
      status: BuildStatus,
      retryInfo?: { current: number; max: number },
    ) => {
      stopBuildCursor()
      state = updatePackageStatus(state, title, status, retryInfo)
      const pkg = state.packages.find((p) => p.title === title)
      if (pkg) {
        handler.ensureNewline()
        printStatus(pkg)
      }
    },
    finish: (message: string) => {
      stopBuildCursor()
      handler.ensureNewline()
      process.stdout.write("\n" + message + "\n")
      process.stdout.write(formatSummary(state) + "\n")
    },
    dispose: () => {
      stopBuildCursor()
    },
  }
}

const formatSummary = (state: BuildState, now?: number): string => {
  const timestamp = now ?? Date.now()
  const doneCount = state.packages.filter((p) => p.status === "done").length
  const failedCount = state.packages.filter((p) => p.status === "failed").length
  const elapsed = formatDuration(timestamp - state.startedAt)

  const parts: string[] = []
  if (doneCount > 0) parts.push(`${doneCount} done`)
  if (failedCount > 0) parts.push(`${failedCount} failed`)

  return `${parts.join(", ")} in ${elapsed}`
}
