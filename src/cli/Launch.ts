import type { PinFile } from "../platform/index.js"
import { GTD_VERSION, PIN_KEY } from "../install/index.js"
import { PIN_FORMAT, pinHeader, readPin } from "../workflow/index.js"
import { EXIT_RUNTIME_ERROR } from "../wire/index.js"
import { parseArgv } from "./Cli.js"
import type { Command } from "./Program.js"

/** What the core a pin carries lacks, or what must read the live state: these never hand over. */
const LIVE_KINDS: ReadonlySet<Command["kind"]> = new Set<Command["kind"]>([
  "ui",
  "lsp",
  "guide",
  "bundle",
  "historyList",
  "historyShow",
  "historyMetrics",
  "historyJudges",
  "historyFetch",
])

export type Launch =
  | { readonly kind: "live"; readonly argv: readonly string[] }
  | {
      readonly kind: "pin"
      readonly argv: readonly string[]
      readonly path: string
      readonly version: string
      /** Unpacked only when run: its failure is the hand-over's. */
      readonly source: () => string
    }
  | { readonly kind: "output"; readonly stdout: string }
  | { readonly kind: "refuse"; readonly message: string }

const LIVE_FLAG = "--live"

// Only before `--`: after it, `--live` is an argument.
const optionWords = (argv: readonly string[]): readonly string[] => {
  const end = argv.indexOf("--", 2)
  return argv.slice(2, end < 0 ? undefined : end)
}

const withoutLiveFlag = (argv: readonly string[]): readonly string[] => {
  const end = argv.indexOf("--", 2)
  return argv.filter((word, i) => word !== LIVE_FLAG || i < 2 || (end >= 0 && i > end))
}

/**
 * Whether this gtd runs the command or hands it to the process's pin. A pin
 * this gtd cannot run is refused, never guessed at; a usage error the live
 * parser finds is still the pin's to judge, since its engine may read
 * another CLI.
 */
export const launchFor = (argv: readonly string[], pinFile: PinFile): Launch => {
  // The engine a pin carries is this same code: once inside one, never hand over again.
  if ((globalThis as { [PIN_KEY]?: unknown })[PIN_KEY] !== undefined) return { kind: "live", argv }
  const live = optionWords(argv).includes(LIVE_FLAG)
  const rest = withoutLiveFlag(argv)
  if (live) return { kind: "live", argv: rest }
  const plan = parseArgv(rest)
  const version = plan.kind === "output" && plan.stdout === `${GTD_VERSION}\n`
  if (plan.kind === "output" && !version) return { kind: "live", argv: rest }
  if (plan.kind === "command" && LIVE_KINDS.has(plan.command.kind))
    return { kind: "live", argv: rest }
  const found = pinFile()
  if (found === undefined) return { kind: "live", argv: rest }
  const header = pinHeader(found.bytes)
  if (version)
    return {
      kind: "output",
      stdout:
        header === undefined
          ? plan.stdout
          : `${GTD_VERSION} (this process is pinned to gtd ${header.version})\n`,
    }
  if (header === undefined || header.format !== PIN_FORMAT) {
    const what =
      header === undefined
        ? "is no pin this gtd can read"
        : `is pin format ${header.format}, made by gtd ${header.version}`
    return {
      kind: "refuse",
      message: `gtd: ${found.path} ${what}; gtd ${GTD_VERSION} runs pin format ${PIN_FORMAT} — upgrade gtd (\`gtd --live\` runs this gtd instead, and may misread the process)`,
    }
  }
  return {
    kind: "pin",
    argv: rest,
    path: found.path,
    version: header.version,
    source: () => readPin(found.bytes).source,
  }
}

export interface Launcher {
  readonly stdout: (chunk: string) => void
  readonly stderr: (chunk: string) => void
  readonly exit: (code: number) => void
  readonly live: (argv: readonly string[]) => void | Promise<void>
  readonly pin: (launch: Extract<Launch, { kind: "pin" }>) => Promise<void>
}

const isJsonFlag = (word: string): boolean => word === "--json" || word.startsWith("--json=")

// The CLI's own error envelope too, which a `--json` driver reads.
const refusalText = (argv: readonly string[], message: string): string =>
  (optionWords(argv).some(isJsonFlag)
    ? `${JSON.stringify({ state: "error", prompt: message })}\n`
    : "") + `${message}\n`

const runPin = async (
  launch: Extract<Launch, { kind: "pin" }>,
  launcher: Launcher,
): Promise<void> => {
  const words = optionWords(launch.argv)
  if (words.includes("--verbose") || words.includes("-v"))
    launcher.stderr(`launcher: running the pin ${launch.path} (gtd ${launch.version})\n`)
  try {
    await launcher.pin(launch)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    launcher.stderr(`gtd: could not run the pin ${launch.path}: ${reason}\n`)
    launcher.exit(EXIT_RUNTIME_ERROR)
  }
}

export const runLauncher = async (
  argv: readonly string[],
  pinFile: PinFile,
  launcher: Launcher,
): Promise<void> => {
  const launch = launchFor(argv, pinFile)
  switch (launch.kind) {
    case "live":
      return launcher.live(launch.argv)
    case "output":
      return launcher.stdout(launch.stdout)
    case "refuse":
      launcher.stderr(refusalText(argv, launch.message))
      return launcher.exit(EXIT_RUNTIME_ERROR)
    case "pin":
      return runPin(launch, launcher)
  }
}
