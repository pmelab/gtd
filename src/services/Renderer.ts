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

export const ANSI = {
  dim: "\x1b[2m",
  strikethrough: "\x1b[9m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  clearLine: "\x1b[2K",
  cursorUp: (n: number) => `\x1b[${n}A`,
} as const

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const MAX_ACTIVITY_LINES = 5

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

// --- Activity buffer for agent events ---

const createActivityBuffer = () => {
  const lines: string[] = []
  let textAccum = ""

  const push = (line: string) => {
    lines.push(line)
    if (lines.length > MAX_ACTIVITY_LINES) lines.shift()
  }

  return {
    get lines(): ReadonlyArray<string> {
      return lines
    },
    handleEvent: (event: AgentEvent) => {
      switch (event._tag) {
        case "ToolStart":
          push(event.toolName)
          break
        case "TextDelta":
          textAccum += event.delta
          // Show last line of accumulated text as preview
          {
            const lastNewline = textAccum.lastIndexOf("\n")
            const lastLine = lastNewline >= 0 ? textAccum.slice(lastNewline + 1) : textAccum
            if (lastLine.trim().length > 0) {
              const truncated = lastLine.length > 60 ? lastLine.slice(0, 60) + "..." : lastLine
              // Replace last text preview or add new one
              const lastIdx = lines.length - 1
              if (lastIdx >= 0 && lines[lastIdx]!.startsWith("> ")) {
                lines[lastIdx] = `> ${truncated}`
              } else {
                push(`> ${truncated}`)
              }
            }
          }
          break
        case "TurnStart":
          lines.length = 0
          textAccum = ""
          break
        default:
          break
      }
    },
    clear: () => {
      lines.length = 0
      textAccum = ""
    },
  }
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

  // Interactive: custom ANSI spinner with activity lines
  let text = ""
  let frame = 0
  let lineCount = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const activity = createActivityBuffer()

  const render = () => {
    if (lineCount > 0) {
      process.stdout.write(ANSI.cursorUp(lineCount))
    }
    const lines: string[] = []
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!
    lines.push(`${ANSI.clearLine}  ${ANSI.cyan}${spinner}${ANSI.reset} ${text}`)
    for (const actLine of activity.lines) {
      lines.push(`${ANSI.clearLine}    ${ANSI.dim}${actLine}${ANSI.reset}`)
    }
    process.stdout.write(lines.join("\n") + "\n")
    lineCount = lines.length
  }

  const clearLines = () => {
    if (lineCount > 0) {
      process.stdout.write(ANSI.cursorUp(lineCount))
      for (let i = 0; i < lineCount; i++) {
        process.stdout.write(ANSI.clearLine + "\n")
      }
      process.stdout.write(ANSI.cursorUp(lineCount))
      lineCount = 0
    }
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

  return {
    onEvent: (event: AgentEvent) => {
      activity.handleEvent(event)
    },
    setText: (newText: string) => {
      text = newText
      if (!timer) {
        startTimer()
      }
    },
    succeed: (msg: string) => {
      stopTimer()
      clearLines()
      activity.clear()
      process.stdout.write(`  ${ANSI.green}✓${ANSI.reset} ${msg}\n`)
    },
    fail: (msg: string) => {
      stopTimer()
      clearLines()
      activity.clear()
      process.stderr.write(`  ${ANSI.red}✗${ANSI.reset} ${msg}\n`)
    },
    dispose: () => {
      stopTimer()
      clearLines()
      activity.clear()
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

  // Interactive ANSI renderer with activity lines
  let frame = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let lineCount = 0
  const activity = createActivityBuffer()

  const render = () => {
    // Move cursor up to clear previous render
    if (lineCount > 0) {
      process.stdout.write(ANSI.cursorUp(lineCount))
    }
    const lines: string[] = []
    for (const pkg of state.packages) {
      lines.push(`${ANSI.clearLine}${formatLine(pkg, frame)}`)
    }
    for (const actLine of activity.lines) {
      lines.push(`${ANSI.clearLine}    ${ANSI.dim}${actLine}${ANSI.reset}`)
    }
    process.stdout.write(lines.join("\n") + "\n")
    lineCount = lines.length
  }

  const clearActivityLines = () => {
    if (lineCount > 0) {
      process.stdout.write(ANSI.cursorUp(lineCount))
      for (let i = 0; i < lineCount; i++) {
        process.stdout.write(ANSI.clearLine + "\n")
      }
      process.stdout.write(ANSI.cursorUp(lineCount))
      lineCount = 0
    }
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
    onEvent: (event: AgentEvent) => {
      activity.handleEvent(event)
    },
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
      activity.clear()
      clearActivityLines()
      // Final render without activity
      for (const pkg of state.packages) {
        process.stdout.write(`${ANSI.clearLine}${formatLine(pkg, frame)}\n`)
      }
      console.log(`\n${message}`)
      console.log(formatSummary(state))
    },
    dispose: () => {
      stopTimer()
      activity.clear()
    },
  }
}
