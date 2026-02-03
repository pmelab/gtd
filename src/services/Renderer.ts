import ora, { type Ora } from "ora"
import type { AgentEvent } from "./AgentEvent.js"

// --- Types ---

export type BuildStatus = "pending" | "building" | "testing" | "done" | "failed"

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

const ANSI = {
  dim: "\x1b[2m",
  strikethrough: "\x1b[9m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
} as const

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export const formatLine = (pkg: BuildPackageState, frame: number): string => {
  switch (pkg.status) {
    case "pending":
      return `  ${ANSI.dim}□${ANSI.reset} ${pkg.title}`
    case "building": {
      const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!
      return `  ${ANSI.cyan}${spinner}${ANSI.reset} ${pkg.title} ${ANSI.cyan}building...${ANSI.reset}`
    }
    case "testing": {
      const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!
      const retryLabel = pkg.maxRetries > 1 ? ` (${pkg.retryCount}/${pkg.maxRetries})` : ""
      return `  ${ANSI.yellow}${spinner}${ANSI.reset} ${pkg.title} ${ANSI.yellow}testing${retryLabel}...${ANSI.reset}`
    }
    case "done": {
      const duration =
        pkg.startedAt != null && pkg.finishedAt != null
          ? ` ${ANSI.dim}(${formatDuration(pkg.finishedAt - pkg.startedAt)})${ANSI.reset}`
          : ""
      return `  ${ANSI.green}✓${ANSI.reset} ${ANSI.dim}${ANSI.strikethrough}${pkg.title}${ANSI.reset}${duration}`
    }
    case "failed":
      return `  ${ANSI.red}✗${ANSI.reset} ${pkg.title} ${ANSI.red}failed${ANSI.reset}`
  }
}

export const formatSummary = (state: BuildState, now?: number): string => {
  const timestamp = now ?? Date.now()
  const doneCount = state.packages.filter((p) => p.status === "done").length
  const failedCount = state.packages.filter((p) => p.status === "failed").length
  const elapsed = formatDuration(timestamp - state.startedAt)

  const parts: string[] = []
  if (doneCount > 0) parts.push(`${doneCount} done`)
  if (failedCount > 0) parts.push(`${failedCount} failed`)

  return `${parts.join(", ")} in ${elapsed}`
}

// --- TTY detection ---

export const isInteractive = (): boolean => process.stdout.isTTY === true

// --- SpinnerRenderer ---

export interface SpinnerRenderer {
  readonly onEvent: (event: AgentEvent) => void
  readonly setText: (text: string) => void
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
      succeed: (text: string) => console.log(`[gtd] ${text}`),
      fail: (text: string) => console.error(`[gtd] ${text}`),
      dispose: () => {},
    }
  }

  let spinner: Ora | undefined

  return {
    onEvent: () => {},
    setText: (text: string) => {
      if (!spinner) {
        spinner = ora({ text, spinner: "dots" }).start()
      } else {
        spinner.text = text
      }
    },
    succeed: (text: string) => {
      if (spinner) {
        spinner.succeed(text)
        spinner = undefined
      } else {
        ora().succeed(text)
      }
    },
    fail: (text: string) => {
      if (spinner) {
        spinner.fail(text)
        spinner = undefined
      } else {
        ora().fail(text)
      }
    },
    dispose: () => {
      if (spinner) {
        spinner.stop()
        spinner = undefined
      }
    },
  }
}

// --- BuildRenderer ---

export interface BuildRenderer {
  readonly onEvent: (event: AgentEvent) => void
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
        console.log(`[gtd] ${icon} ${title}: ${status}${retryLabel}${duration}`)
      },
      finish: (message: string) => {
        console.log(`[gtd] ${message}`)
        console.log(`[gtd] ${formatSummary(state)}`)
      },
      dispose: () => {},
    }
  }

  // Interactive ANSI renderer
  let frame = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let lineCount = 0

  const render = () => {
    // Move cursor up to clear previous render
    if (lineCount > 0) {
      process.stdout.write(`\x1b[${lineCount}A`)
    }
    const lines: string[] = []
    for (const pkg of state.packages) {
      lines.push(`\x1b[2K${formatLine(pkg, frame)}`)
    }
    process.stdout.write(lines.join("\n") + "\n")
    lineCount = lines.length
  }

  const startTimer = () => {
    if (!timer) {
      render()
      timer = setInterval(() => {
        frame++
        render()
      }, 80)
    }
  }

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  startTimer()

  return {
    onEvent: () => {},
    setStatus: (
      title: string,
      status: BuildStatus,
      retryInfo?: { current: number; max: number },
    ) => {
      state = updatePackageStatus(state, title, status, retryInfo)
      render()
    },
    finish: (message: string) => {
      stopTimer()
      render()
      console.log(`\n${message}`)
      console.log(formatSummary(state))
    },
    dispose: () => {
      stopTimer()
    },
  }
}
