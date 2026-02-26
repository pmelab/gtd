import chalk from "chalk"
import type { AgentEvent } from "./AgentEvent.js"

// --- Types ---

export type BuildStatus = "pending" | "building" | "fixing" | "testing" | "done" | "failed" | "skipped"

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
      finishedAt: status === "done" || status === "failed" || status === "skipped" ? timestamp : pkg.finishedAt,
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

// --- Cursor symbol stripping ---

export const stripCursorSymbols = (text: string): string =>
  text.replace(/\u2588|\x1b\[\?25[lh]|\x1b\[1D/g, "")

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

interface EventHandler {
  readonly onEvent: (event: AgentEvent) => void
  readonly ensureNewline: () => void
  readonly markDirty: () => void
}

export const createEventHandler = (verbose: boolean): EventHandler => {
  let thinking = false
  let dirty = false

  const endThinking = () => {
    if (verbose) {
      process.stdout.write("\n\n")
      dirty = false
    }
    thinking = false
  }

  const ensureNewline = () => {
    if (dirty) {
      process.stdout.write("\n")
      dirty = false
    }
  }

  return {
    markDirty: () => {
      dirty = true
    },
    onEvent: (event: AgentEvent) => {
      if (event._tag === "ThinkingDelta") {
        if (verbose) {
          if (!thinking) {
            process.stdout.write("\n")
            thinking = true
          }
          process.stdout.write(chalk.dim(event.delta))
          dirty = true
        } else {
          thinking = true
        }
      } else {
        if (thinking) endThinking()
        if (event._tag === "ToolStart" && verbose) {
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

export const createSpinnerRenderer = (interactive: boolean, verbose: boolean): SpinnerRenderer => {
  if (!interactive) {
    let lastText = ""
    return {
      onEvent: () => {},
      setText: (text: string) => {
        const clean = stripCursorSymbols(text)
        if (clean !== lastText) {
          lastText = clean
          console.log(`[gtd] ${clean}`)
        }
      },
      setTextWithCursor: (text: string) => {
        const clean = stripCursorSymbols(text)
        if (clean !== lastText) {
          lastText = clean
          console.log(`[gtd] ${clean}`)
        }
      },
      stopCursor: () => {},
      succeed: (text: string) => console.log(`[gtd] ${stripCursorSymbols(text)}`),
      fail: (text: string) => console.error(`[gtd] ${stripCursorSymbols(text)}`),
      dispose: () => {},
    }
  }

  const handler = createEventHandler(verbose)

  const stopCursor = () => {}

  return {
    onEvent: handler.onEvent,
    setText: (text: string) => {
      handler.ensureNewline()
      process.stdout.write(chalk.cyan("◆") + " " + text + "\n")
    },
    setTextWithCursor: (text: string) => {
      handler.ensureNewline()
      process.stdout.write(chalk.cyan("◆") + " " + text + "\n")
    },
    stopCursor,
    succeed: (msg: string) => {
      handler.ensureNewline()
      process.stdout.write(chalk.green("✓") + " " + msg + "\n")
    },
    fail: (msg: string) => {
      handler.ensureNewline()
      process.stderr.write(chalk.red("✗") + " " + msg + "\n")
    },
    dispose: () => {},
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
  verbose: boolean,
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
        const icon = status === "done" ? "✓" : status === "failed" ? "✗" : status === "skipped" ? "⊘" : "⠋"
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
          status === "skipped" ? `"${title}" skipped (no changes needed)` :
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
      case "skipped": {
        const skipDuration =
          pkg.startedAt != null && pkg.finishedAt != null
            ? ` (${formatDuration(pkg.finishedAt - pkg.startedAt)})`
            : ""
        process.stdout.write(
          chalk.dim("⊘ ") + chalk.dim.strikethrough(pkg.title) + chalk.dim(skipDuration) + "\n",
        )
        break
      }
      case "failed":
        process.stdout.write(chalk.red(`✗ "${pkg.title}" failed`) + "\n")
        break
    }
  }

  const handler = createEventHandler(verbose)

  const stopBuildCursor = () => {}

  return {
    onEvent: handler.onEvent,
    setTextWithCursor: (text: string) => {
      handler.ensureNewline()
      process.stdout.write(chalk.cyan("◆") + " " + text + "\n")
    },
    stopCursor: stopBuildCursor,
    setStatus: (
      title: string,
      status: BuildStatus,
      retryInfo?: { current: number; max: number },
    ) => {
      state = updatePackageStatus(state, title, status, retryInfo)
      const pkg = state.packages.find((p) => p.title === title)
      if (pkg) {
        handler.ensureNewline()
        printStatus(pkg)
      }
    },
    finish: (message: string) => {
      handler.ensureNewline()
      process.stdout.write("\n" + message + "\n")
      process.stdout.write(formatSummary(state) + "\n")
    },
    dispose: () => {},
  }
}

const formatSummary = (state: BuildState, now?: number): string => {
  const timestamp = now ?? Date.now()
  const doneCount = state.packages.filter((p) => p.status === "done").length
  const skippedCount = state.packages.filter((p) => p.status === "skipped").length
  const failedCount = state.packages.filter((p) => p.status === "failed").length
  const elapsed = formatDuration(timestamp - state.startedAt)

  const parts: string[] = []
  if (doneCount > 0) parts.push(`${doneCount} done`)
  if (skippedCount > 0) parts.push(`${skippedCount} skipped`)
  if (failedCount > 0) parts.push(`${failedCount} failed`)

  return `${parts.join(", ")} in ${elapsed}`
}
