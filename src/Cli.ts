/**
 * The whole CLI shell: argv in, an exit code out. Owns every usage rule (the
 * flag table, the command table, the `=`/space tokenizer duality, command
 * resolution, the state-command bracket decision) and the single envelope
 * shape (`{state:"error",prompt}` on stdout under `--json`, a `gtd: `-prefixed
 * line on stderr always). `parseArgv` is pure and total — every input maps to
 * exactly one `CliPlan`, and no layer is ever built to answer `--version`,
 * `--help`, or a usage error (there is no `Command` value that means "help").
 * `runCli` is the one place that decides WHEN a layer may be built at all.
 */
import { NodeContext } from "@effect/platform-node"
import { createRequire } from "node:module"
import { Cause, Effect, Either, Layer } from "effect"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
// `program.ts` imports only `import type { Command }` from THIS module — a
// type-only edge, erased at compile time — so this module's own (real, value)
// dependency on `program.ts` for `runCommand`/`needsOf`/`standaloneKinds`
// stays one-directional, not circular.
import { runCommand, type CommandRequirements } from "./program.js"
import { RepoFiles } from "./RepoFiles.js"
import { CommandRunner } from "./CommandRunner.js"
import { DriverState } from "./DriverState.js"

export type { CommandRequirements }

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

export type Command =
  | { readonly kind: "lsp" }
  | { readonly kind: "init" }
  | { readonly kind: "visualize"; readonly port: number; readonly open: boolean }
  | {
      readonly kind: "step"
      readonly actor: string
      readonly cost?: number
      readonly model?: string
      readonly ifResting?: boolean
    }
  | {
      readonly kind: "entry"
      readonly actor: string
      readonly state: string
      readonly vars: Readonly<Record<string, string>>
      readonly label: string
    }
  | { readonly kind: "abandon" }
  | { readonly kind: "restore" }
  | { readonly kind: "next"; readonly dispatch: boolean }
  | { readonly kind: "status" }
  | { readonly kind: "validate" }
  | { readonly kind: "check"; readonly mode: string; readonly file: string }
  | { readonly kind: "install" }

export type CliPlan =
  | { readonly kind: "output"; readonly stdout: string }
  | {
      readonly kind: "usage"
      readonly stdout: string
      readonly message: string
      readonly json: boolean
    }
  | { readonly kind: "command"; readonly command: Command; readonly json: boolean }

/**
 * What a command kind needs before it may run. `pure`/`removed` never reach
 * `io.layers()` at all (they resolve to `output`/`usage` plans, never a
 * `Command`). `state` marks the six kinds that share the repo-root guard and
 * the review-window bracket (`needsOf(kind) === "state"`); `none`/`fs`/
 * `config` merely document each standalone handler's own annotated `R` — see
 * `standaloneKinds()`.
 *
 * `needsOf`/`standaloneKinds` themselves live in `program.ts` (re-exported
 * here) — `program.ts`'s `runCommand` is their one runtime caller, and this
 * module already has a real (value) dependency on `program.ts` for
 * `runCommand` itself; a value import running the other way, back into this
 * module, would make the two modules circular.
 */
export type Needs = "pure" | "removed" | "none" | "fs" | "config" | "state"
export { needsOf, standaloneKinds } from "./program.js"

// ---------------------------------------------------------------------------
// Flag table
// ---------------------------------------------------------------------------

type FlagScope = (kind: Command["kind"] | undefined) => boolean

interface FlagRow {
  readonly name: string
  readonly arity: 0 | 1
  readonly repeatable: boolean
  readonly scope: FlagScope
  /** All raw occurrences (already de-`=`-ed) → the decoded value, or an error message. */
  readonly decode: (raws: readonly string[]) => Either.Either<unknown, string>
  readonly scopeError: string
  readonly valueHint: string
  /** Pre-wrapped help lines (data, not generated prose) — see `renderHelp`. */
  readonly help: readonly string[]
}

const nonNegativeNumber = (raw: string, flag: string): Either.Either<number, string> => {
  const n = Number(raw)
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
    return Either.left(`gtd: ${flag} must be a non-negative number — got "${raw}"`)
  }
  return Either.right(n)
}

const FLAGS: readonly FlagRow[] = [
  {
    name: "--json",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind !== "lsp",
    decode: () => Either.right(true),
    scopeError: "gtd lsp does not accept --json",
    valueHint: "",
    help: ["Output structured JSON instead of plain text"],
  },
  {
    name: "--port",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "visualize",
    decode: ([raw]) => {
      const n = Number(raw)
      return raw !== undefined && Number.isInteger(n) && n >= 0 && n <= 65535
        ? Either.right(n)
        : Either.left(`gtd visualize: --port must be an integer 0–65535 (got '${raw ?? ""}')`)
    },
    scopeError: "gtd: --port is only valid for `gtd visualize`",
    valueHint: "<n>",
    help: ["(gtd visualize only) port to serve on (default: a free port)"],
  },
  {
    name: "--no-open",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "visualize",
    decode: () => Either.right(true),
    scopeError: "gtd: --port is only valid for `gtd visualize`",
    valueHint: "",
    help: ["(gtd visualize only) do not open the browser"],
  },
  {
    name: "--cost",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "step",
    decode: ([raw]) => nonNegativeNumber(raw ?? "", "--cost"),
    scopeError:
      "gtd: --cost is only valid for `gtd step` without --entry — an entry is not a metered agent turn",
    valueHint: "<n>",
    help: ["(gtd step only) record the invocation's token cost"],
  },
  {
    name: "--model",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "step",
    decode: ([raw]) =>
      raw === undefined || raw.trim() === "" || /[\r\n]/.test(raw)
        ? Either.left("gtd: --model must be a non-empty, single-line value")
        : Either.right(raw),
    scopeError:
      "gtd: --model is only valid for `gtd step` without --entry — an entry is not a metered agent turn",
    valueHint: "<name>",
    help: ["(gtd step only, with --cost) tag that cost's model"],
  },
  {
    name: "--if-resting",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "step",
    decode: () => Either.right(true),
    scopeError:
      "gtd: --if-resting is only valid for `gtd step` without --entry — an entry is unconditional",
    valueHint: "",
    help: [
      "(gtd step only) exit 0 doing nothing when the resolved",
      "rest awaits a different actor, instead of refusing",
      "out of turn; a genuine gate refusal still fails",
    ],
  },
  {
    name: "--entry",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "entry",
    decode: ([raw]) => Either.right(raw ?? ""),
    scopeError: "gtd: --entry is only valid for `gtd step` or the bare `gtd --entry <state>` form",
    valueHint: "<state>",
    help: [
      "(gtd step, or with no command at all) start a brand new",
      "process at <state> — any declared, non-commit state —",
      "instead of stepping the one currently resting. Not",
      "combinable with --cost/--model (an entry is not a metered",
      "agent turn)",
    ],
  },
  {
    name: "--var",
    arity: 1,
    repeatable: true,
    scope: (kind) => kind === "entry",
    decode: (raws) => {
      const vars: Record<string, string> = {}
      const seen = new Set<string>()
      for (const raw of raws) {
        const eq = raw.indexOf("=")
        if (eq <= 0) {
          return Either.left(
            `gtd: --var must be <name>=<value> with a non-empty name — got "${raw}"`,
          )
        }
        const name = raw.slice(0, eq)
        const value = raw.slice(eq + 1)
        if (/[\r\n]/.test(value)) {
          return Either.left(`gtd: --var ${name} must be a single-line value`)
        }
        if (seen.has(name)) {
          return Either.left(`gtd: --var ${name} specified more than once`)
        }
        seen.add(name)
        vars[name] = value
      }
      return Either.right(vars)
    },
    scopeError: "gtd: --var requires --entry",
    valueHint: "<name>=<value>",
    help: [
      "(with --entry; repeatable) supply a fixed it.vars",
      "override for the new process; the name must already be",
      "declared by the workflow's own vars: or the .gtdrc vars:",
    ],
  },
  {
    name: "--dispatch",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "next",
    decode: () => Either.right(true),
    scopeError: "gtd: --dispatch is only valid for `gtd next`",
    valueHint: "",
    help: [
      "(gtd next only, requires --json) claim this beat as",
      "handed to an executor — resolves the prompt session",
      '(sessionId/resume). "stalled": true is reported by',
      "every --json call regardless of --dispatch — see gtd",
      "next's own help",
    ],
  },
]

const flagByToken = (token: string): FlagRow | undefined => {
  const eq = token.indexOf("=")
  const bareName = eq === -1 ? token : token.slice(0, eq)
  return FLAGS.find((f) => f.name === bareName)
}

// ---------------------------------------------------------------------------
// Command table
// ---------------------------------------------------------------------------

type Arity = "none" | { readonly name: string } | { readonly names: readonly [string, string] }

interface CommandRow {
  readonly token: string
  readonly kind: Command["kind"]
  readonly arity: Arity
  readonly details: readonly string[]
}

const COMMAND_ROWS: readonly CommandRow[] = [
  {
    token: "init",
    kind: "init",
    arity: "none",
    details: [
      "Scaffold a minimal .gtdrc.json for this repo, seeding the",
      "default variables you are most likely to change (the test",
      "command) and a Prettier formatting suggestion. gtd runs its",
      "built-in workflow by default, so no workflow is written —",
      "add a workflow: key only to customize the machine itself.",
      "Takes no argument. Run once per repo; refuses if a gtd",
      "config already exists. Leaves the file uncommitted for you",
      "to review and commit",
    ],
  },
  {
    token: "step",
    kind: "step",
    arity: { name: "actor" },
    details: [
      "Authenticate as <actor>, match the resolved rest's",
      "declared patterns against the pending changes, and commit",
      "(or squash) the one resulting transition. Pass",
      "--cost=<n> (optionally --model=<name>) to record the",
      "just-finished invocation's token cost and model on the",
      "turn commit (summed into it.processCost/processCostByModel).",
      "Pass --entry <state> to start a brand NEW process at",
      "<state> instead — any declared, non-commit state — with",
      "repeatable --var <name>=<value> supplying that new",
      "process's fixed it.vars overrides. Pass --if-resting to",
      "exit 0 doing nothing instead of refusing when the",
      "resolved rest awaits a different actor",
    ],
  },
  {
    token: "abandon",
    kind: "abandon",
    arity: "none",
    details: [
      "End the process currently underway without completing it:",
      "close any open review checkout window, then rewind HEAD to",
      "the commit the process started from, keeping everything it",
      "produced as uncommitted changes. A no-op when no process is",
      "underway",
    ],
  },
  {
    token: "restore",
    kind: "restore",
    arity: "none",
    details: [
      "Hard-reset HEAD back to the pre-squash tip retained by the",
      "last squash/abandon (refs/worktree/gtd/history), undoing a",
      "squash or bringing back an abandoned process's turns.",
      "Refuses on a dirty working tree, when there is no retained",
      "history, or when HEAD has advanced past the squash with",
      "commits that would be lost",
    ],
  },
  {
    token: "next",
    kind: "next",
    arity: "none",
    details: [
      "Print the resolved rest's rendered script/prompt/message",
      '(no mutation). --json emits "stalled": true when HEAD is',
      "an empty gtd(<actor>): <state> attempt at the resting",
      "state and the tree is clean — a fruitless prompt dispatch,",
      "sticky until a C row or retry: escalation clears it.",
      "--dispatch (requires --json) additionally resolves the",
      "prompt session (sessionId/resume)",
    ],
  },
  {
    token: "status",
    kind: "status",
    arity: "none",
    details: [
      "Print the resolved rest's state/actor and which declared",
      "pattern (if any) each pending change matches (no mutation)",
    ],
  },
  {
    token: "validate",
    kind: "validate",
    arity: "none",
    details: [
      "Print the script that formats (when declared) then",
      "validates the resolved rest's steering file, using its",
      "mode's commands (its file:/mode:), instead of running it —",
      "a driver runs the script and reads the findings from its",
      "own exit code/output. Always exits 0; --json emits",
      '{state, file?, mode?, script} (script is "" when there is',
      'nothing to validate; plain text prints "nothing to',
      'validate" in that case). On a non-zero validate exit',
      "the emitted script prints a ready-to-send fix prompt",
      "(instruction + findings) and exits with the",
      "validator's own code",
    ],
  },
  {
    token: "lsp",
    kind: "lsp",
    arity: "none",
    details: ["Start the LSP server for .gtd/ steering files (stdio)"],
  },
  {
    token: "visualize",
    kind: "visualize",
    arity: "none",
    details: [
      "Serve an interactive diagram of the active workflow on a",
      "local web server (--port <n>, --no-open; --json prints the",
      "model and exits)",
    ],
  },
  {
    token: "check",
    kind: "check",
    arity: { names: ["mode", "file"] },
    details: [
      "Read <file> and run the built-in steering format named",
      "<mode> (see `gtd validate`'s modes: qa, review) over its",
      "contents, printing each finding one per line and exiting",
      "non-zero when there are any. Resolves no workflow state and",
      "reads no config — standalone, runnable from any directory",
      "with <mode>/<file> given explicitly. This is what a",
      "workflow's emitted validation script invokes as a leaf step",
    ],
  },
  {
    token: "install",
    kind: "install",
    arity: "none",
    details: [
      "Print a complete, self-contained briefing that teaches an",
      "agent (or a human) to build a gtd loop driver in any shell",
      "or runtime — the self-serve version of README's 'Writing",
      "your own driver'. Writes nothing: this installs knowledge",
      "into the calling agent's context, not files on disk. Runs",
      "from any directory, in or out of a repository",
    ],
  },
]

const commandByToken = (token: string): CommandRow | undefined =>
  COMMAND_ROWS.find((r) => r.token === token)

/**
 * The two named commands the generic `--entry` mechanism replaced. No
 * fallback: `gtd review`/`gtd fix` fail with a message pointing at the
 * replacement rather than the generic "unknown command". Names no bundled
 * workflow's own state names — gtd has no opinion on any workflow's state
 * names; run `--entry` with an unknown state to see the active workflow's own
 * enterable states.
 */
const REMOVED: Readonly<Record<string, string>> = {
  review:
    "gtd: `gtd review <commitish>` is gone — this workflow's own state names " +
    "aren't known to gtd; run `gtd step <actor> --entry <review-state> " +
    "--var <name>=<value> ...` instead — run it with an unknown <review-state> " +
    "to see this workflow's own enterable states",
  fix:
    "gtd: `gtd fix` is gone — this workflow's own state names aren't known to " +
    "gtd; run `gtd step <actor> --entry <fix-state>` instead — run it with an " +
    "unknown <fix-state> to see this workflow's own enterable states",
  loop:
    "gtd: `gtd loop` is gone — gtd decides and prints, a driver executes. " +
    'Copy the driver from the README\'s "A complete minimal driver" section ' +
    "and run that instead",
}

// ---------------------------------------------------------------------------
// Help rendering
// ---------------------------------------------------------------------------

const COLUMN = 19

const renderBlock = (header: string, lines: readonly string[]): string => {
  const [first, ...rest] = lines
  const headerCell = `  ${header}`
  const headerLine =
    headerCell.length < COLUMN
      ? `${headerCell.padEnd(COLUMN)}${first ?? ""}\n`
      : `${headerCell}\n${" ".repeat(COLUMN)}${first ?? ""}\n`
  return headerLine + rest.map((l) => `${" ".repeat(COLUMN)}${l}\n`).join("")
}

const ENTRY_SHORT_FORM = renderBlock("(no command) --entry <state>", [
  "Short form of 'step human --entry <state>' — starts a new",
  "process authenticated as human, e.g. 'gtd --entry <state>'",
])

const VERSION_BLOCK = renderBlock("version", ["Print version and exit"])
const HELP_BLOCK = renderBlock("help", ["Print this help and exit"])

const SPACE_FORM_FLAGS = new Set(["--entry", "--var"])

const flagHeader = (row: FlagRow): string => {
  if (row.valueHint === "") return row.name
  return SPACE_FORM_FLAGS.has(row.name)
    ? `${row.name} ${row.valueHint}`
    : `${row.name}=${row.valueHint}`
}

export const renderHelp = (): string => {
  const commandBlocks = COMMAND_ROWS.map((row) => {
    const header =
      row.arity === "none"
        ? row.token
        : "names" in row.arity
          ? `${row.token} <${row.arity.names[0]}> <${row.arity.names[1]}>`
          : `${row.token} <${row.arity.name}>`
    return renderBlock(header, row.details)
  })
  const commands = [
    commandBlocks[0], // init
    commandBlocks[1], // step
    ENTRY_SHORT_FORM,
    ...commandBlocks.slice(2), // abandon..check
    VERSION_BLOCK,
    HELP_BLOCK,
  ].join("")

  const options = FLAGS.map((row) => renderBlock(flagHeader(row), row.help)).join("")
  const versionHelpOptions =
    renderBlock("--version, -v", ["Print version and exit"]) +
    renderBlock("--help, -h", ["Print this help and exit"])

  return (
    `Usage: gtd [command] [options]\n\n` +
    `Commands:\n${commands}\n` +
    `Options:\n${options}${versionHelpOptions}`
  )
}

// ---------------------------------------------------------------------------
// cliErrorLine
// ---------------------------------------------------------------------------

/**
 * The stderr line for a CLI error: a `gtd: ` prefix UNLESS the message
 * already carries one. Most gtd errors are authored with a `gtd:`/`gtd
 * <cmd>:` prefix of their own (e.g. `gtd init: …`, `gtd: unknown option …`),
 * so a blind prepend would produce a doubled `gtd: gtd: …`.
 */
export const cliErrorLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return /^gtd[: ]/.test(message) ? message : `gtd: ${message}`
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface TokenizeError {
  readonly kind: "error"
  readonly message: string
  readonly jsonSeen: boolean
}

interface TokenizeOk {
  readonly kind: "ok"
  readonly positionals: readonly string[]
  readonly byFlag: ReadonlyMap<string, readonly string[]>
  readonly present: ReadonlySet<string>
  readonly jsonSeen: boolean
}

// fallow-ignore-next-line complexity
const tokenize = (tail: readonly string[]): TokenizeError | TokenizeOk => {
  const positionals: string[] = []
  const byFlag = new Map<string, string[]>()
  const present = new Set<string>()
  let jsonSeen = false

  for (let i = 0; i < tail.length; i++) {
    const tok = tail[i]!
    if (!tok.startsWith("--")) {
      positionals.push(tok)
      continue
    }
    const row = flagByToken(tok)
    if (row === undefined) {
      return {
        kind: "error",
        message: `gtd: unknown option '${tok}' — see \`gtd --help\``,
        jsonSeen,
      }
    }
    const eq = tok.indexOf("=")
    present.add(row.name)
    if (row.name === "--json") jsonSeen = true

    if (row.arity === 0) {
      if (eq !== -1) {
        return {
          kind: "error",
          message: `gtd: unknown option '${tok}' — see \`gtd --help\``,
          jsonSeen,
        }
      }
      if (!byFlag.has(row.name)) byFlag.set(row.name, [])
      continue
    }

    let raw: string
    if (eq !== -1) {
      raw = tok.slice(eq + 1)
    } else {
      const next = tail[i + 1]
      if (next === undefined || next.startsWith("--")) {
        raw = ""
      } else {
        raw = next
        i++
      }
    }
    if (raw === "") {
      return {
        kind: "error",
        message: `gtd: ${row.name} requires a value — use ${row.name}=${row.valueHint} or ${row.name} ${row.valueHint}`,
        jsonSeen,
      }
    }
    const existing = byFlag.get(row.name) ?? []
    if (!row.repeatable && existing.length >= 1) {
      return { kind: "error", message: `gtd: ${row.name} may be given at most once`, jsonSeen }
    }
    byFlag.set(row.name, [...existing, raw])
  }

  return { kind: "ok", positionals, byFlag, present, jsonSeen }
}

// ---------------------------------------------------------------------------
// parseArgv
// ---------------------------------------------------------------------------

const usagePlan = (message: string, json: boolean, stdout = ""): CliPlan => ({
  kind: "usage",
  stdout,
  message,
  json,
})

const scopeViolation = (
  kind: Command["kind"] | undefined,
  present: ReadonlySet<string>,
): string | undefined => {
  for (const row of FLAGS) {
    if (present.has(row.name) && !row.scope(kind)) return row.scopeError
  }
  return undefined
}

const arityError = (cmd: string, rest: readonly string[], arity: Arity): string | undefined => {
  if (arity === "none") {
    return rest.length > 0
      ? `gtd ${cmd}: too many arguments — expected none, got: ${rest.join(", ")}`
      : undefined
  }
  if ("names" in arity) {
    const [first, second] = arity.names
    if (rest.length < 2) {
      return rest.length === 0
        ? `gtd ${cmd}: missing ${first} and ${second} arguments`
        : `gtd ${cmd}: missing ${second} argument`
    }
    if (rest.length > 2) {
      return `gtd ${cmd}: too many arguments — expected ${first} and ${second}, got: ${rest.join(", ")}`
    }
    return undefined
  }
  if (rest.length === 0) return `gtd ${cmd}: missing ${arity.name} argument`
  if (rest.length > 1) {
    return `gtd ${cmd}: too many arguments — expected one ${arity.name}, got: ${rest.join(", ")}`
  }
  return undefined
}

/**
 * Decode every present flag (in table order) into a bag of values, or the
 * first decode error encountered.
 */
const decodeFlags = (
  byFlag: ReadonlyMap<string, readonly string[]>,
): Either.Either<Readonly<Record<string, unknown>>, string> => {
  const bag: Record<string, unknown> = {}
  for (const row of FLAGS) {
    const raws = byFlag.get(row.name)
    if (raws === undefined) continue
    const decoded = row.decode(raws)
    if (Either.isLeft(decoded)) return Either.left(decoded.left)
    bag[row.name] = decoded.right
  }
  return Either.right(bag)
}

/** Assembles a `step` `Command` from its already-scope-checked flag bag — split out of `parseArgv` so its three independent, omit-when-absent optional fields don't inflate that function's own branching. */
const buildStepCommand = (
  actor: string,
  bag: {
    readonly "--cost"?: number
    readonly "--model"?: string
    readonly "--if-resting"?: boolean
  },
): Command => ({
  kind: "step",
  actor,
  ...(bag["--cost"] !== undefined ? { cost: bag["--cost"] } : {}),
  ...(bag["--model"] !== undefined ? { model: bag["--model"] } : {}),
  ...(bag["--if-resting"] !== undefined ? { ifResting: true } : {}),
})

// fallow-ignore-next-line complexity
export const parseArgv = (argv: readonly string[]): CliPlan => {
  if (argv.includes("--help") || argv.includes("-h"))
    return { kind: "output", stdout: renderHelp() }
  if (argv.includes("--version") || argv.includes("-v")) {
    return { kind: "output", stdout: `${GTD_VERSION}\n` }
  }

  const tokenized = tokenize(argv.slice(2))
  if (tokenized.kind === "error") return usagePlan(tokenized.message, tokenized.jsonSeen)
  const { positionals, byFlag, present, jsonSeen } = tokenized

  const first = positionals[0]
  const entryRaw = byFlag.get("--entry")?.[0]
  const entryPresent = entryRaw !== undefined

  if (first === "version") return { kind: "output", stdout: `${GTD_VERSION}\n` }
  if (first === "help") return { kind: "output", stdout: renderHelp() }

  const row = first === undefined ? undefined : commandByToken(first)
  const removedMessage = first === undefined ? undefined : REMOVED[first]

  // The `--entry` selector: a `step` row (or no row at all) with `--entry`
  // present resolves to the generic `entry` command instead.
  const selectsEntry = entryPresent && (first === undefined || row?.kind === "step")
  const kind: Command["kind"] | undefined = selectsEntry ? "entry" : row?.kind

  if (row === undefined && removedMessage === undefined && !selectsEntry) {
    // No dispatchable row resolved (missing/unknown command) — a scoped flag
    // used here (e.g. `--var` with no `--entry`) is a more specific error
    // than "missing command"/"unknown command", so it takes priority (mirrors
    // the old parser, which validated --entry/--var/--cost/--model ahead of
    // subcommand resolution).
    const violation = scopeViolation(undefined, present)
    if (violation !== undefined) return usagePlan(violation, jsonSeen)
    if (first === undefined) {
      return usagePlan(
        "gtd: missing command — gtd decides and prints, a driver executes; " +
          'copy one from the README\'s "A complete minimal driver" section ' +
          "and run that, or see usage above (`gtd --help`)",
        jsonSeen,
        renderHelp(),
      )
    }
    return usagePlan(`unknown command '${first}'`, jsonSeen)
  }

  if (removedMessage !== undefined && !selectsEntry) {
    const violation = scopeViolation(undefined, present)
    return usagePlan(violation ?? removedMessage, jsonSeen)
  }

  // From here, `kind` is a genuine `Command["kind"]`.
  const restPositionals = first === undefined ? positionals : positionals.slice(1)

  if (kind === "entry" && first === undefined) {
    if (restPositionals.length > 0) {
      return usagePlan(
        `gtd: too many arguments — expected none, got: ${restPositionals.join(", ")}`,
        jsonSeen,
      )
    }
  } else {
    // Both `step` and its `--entry`-selected sibling share `step`'s arity
    // (the actor is always required — it names who authors the commit).
    const arityRow = kind === "entry" ? commandByToken("step")! : row!
    const arityMsg = arityError(first!, restPositionals, arityRow.arity)
    if (arityMsg !== undefined) return usagePlan(arityMsg, jsonSeen)
  }

  const violation = scopeViolation(kind, present)
  if (violation !== undefined) return usagePlan(violation, jsonSeen)

  const decoded = decodeFlags(byFlag)
  if (Either.isLeft(decoded)) return usagePlan(decoded.left, jsonSeen)
  const bag = decoded.right as {
    readonly "--json"?: boolean
    readonly "--port"?: number
    readonly "--no-open"?: boolean
    readonly "--cost"?: number
    readonly "--model"?: string
    readonly "--if-resting"?: boolean
    readonly "--var"?: Readonly<Record<string, string>>
    readonly "--dispatch"?: boolean
  }

  const json = present.has("--json")

  if (kind === "step") {
    if (bag["--model"] !== undefined && bag["--cost"] === undefined) {
      return usagePlan(
        "gtd: --model requires --cost — it tags the recorded cost with the model that ran",
        json,
      )
    }
    return { kind: "command", command: buildStepCommand(restPositionals[0]!, bag), json }
  }

  if (kind === "entry") {
    const actor = first === undefined ? "human" : restPositionals[0]!
    const label =
      first === undefined ? `gtd --entry ${entryRaw}` : `gtd step ${actor} --entry ${entryRaw}`
    return {
      kind: "command",
      command: { kind: "entry", actor, state: entryRaw!, vars: bag["--var"] ?? {}, label },
      json,
    }
  }

  if (kind === "visualize") {
    return {
      kind: "command",
      command: { kind: "visualize", port: bag["--port"] ?? 0, open: !(bag["--no-open"] ?? false) },
      json,
    }
  }

  if (kind === "check") {
    return {
      kind: "command",
      command: { kind: "check", mode: restPositionals[0]!, file: restPositionals[1]! },
      json,
    }
  }

  if (kind === "next") {
    const dispatch = bag["--dispatch"] ?? false
    if (dispatch && !json) {
      return usagePlan("gtd: next --dispatch requires --json", json)
    }
    return { kind: "command", command: { kind: "next", dispatch }, json }
  }

  // Every other kind carries no extra fields.
  const command: Command = {
    kind: kind as "lsp" | "init" | "abandon" | "restore" | "status" | "validate" | "install",
  }
  return { kind: "command", command, json }
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

export interface CliIo {
  readonly stdout: (chunk: string) => void
  readonly stderr: (chunk: string) => void
  readonly exit: (code: number) => void
  /** Deferred thunk — a layer is built only for a resolved `Command`, never for `--version`/`--help`/a usage error. */
  readonly layers: () => Layer.Layer<CommandRequirements>
}

export const nodeCliIo: CliIo = {
  stdout: (chunk) => {
    process.stdout.write(chunk)
  },
  stderr: (chunk) => {
    process.stderr.write(chunk)
  },
  exit: (code) => {
    process.exit(code)
  },
  // A Layer is a lazy description, not a running service — building this
  // object touches no filesystem/git; only `Effect.provide` running the
  // result does. `runCli` calls this thunk exactly when `plan.kind ===
  // "command"`, so --version/--help/a usage error never provoke it.
  layers: () =>
    // Dependency order matters: RepoFiles.Live needs GitService, both need Cwd,
    // and GitService/CommandRunner need NodeContext's CommandExecutor.
    // DriverState.Live needs only Cwd (see its own module doc comment). Each
    // `provideMerge` satisfies the layers above it AND stays in the output.
    Layer.mergeAll(
      ConfigService.Live,
      RepoFiles.Live,
      CommandRunner.Live,
      EnvVars.Live,
      DriverState.Live,
    ).pipe(
      Layer.provideMerge(GitService.Live),
      Layer.provideMerge(Cwd.Live),
      Layer.provideMerge(NodeContext.layer),
    ),
}

/**
 * The single envelope writer: `{state:"error",prompt}` on stdout under
 * `--json`, `cliErrorLine` on stderr always, exit 1. `Effect.sandbox` (see
 * below) means this also fires for a DEFECT (e.g. a layer's own `readFileSync`
 * throwing) — main.ts's previous `catchAll` never covered that case.
 */
const report =
  (io: CliIo, json: boolean) =>
  (cause: Cause.Cause<Error>): Effect.Effect<void> =>
    Effect.sync(() => {
      const error = Cause.squash(cause)
      if (json) {
        const message = error instanceof Error ? error.message : String(error)
        io.stdout(`${JSON.stringify({ state: "error", prompt: message })}\n`)
      }
      io.stderr(`${cliErrorLine(error)}\n`)
      io.exit(1)
    })

export const runCli = (argv: readonly string[], io: CliIo): Effect.Effect<void, Error> => {
  const plan = parseArgv(argv)

  if (plan.kind === "output") {
    return Effect.sync(() => io.stdout(plan.stdout))
  }

  if (plan.kind === "usage") {
    return Effect.sync(() => {
      if (plan.stdout.length > 0) io.stdout(plan.stdout)
      if (plan.json) {
        io.stdout(`${JSON.stringify({ state: "error", prompt: plan.message })}\n`)
      }
      io.stderr(`${cliErrorLine(plan.message)}\n`)
      io.exit(1)
    })
  }

  return runCommand(plan.command, plan.json, io.stdout).pipe(
    Effect.provide(io.layers()),
    Effect.sandbox,
    // `sandbox` moves EVERY failure mode — a typed error, a defect, an
    // interruption — into this handler's `cause`. An interrupt-only cause
    // (Ctrl-C on `visualize`/`lsp`'s blocking `Effect.never`) is passed
    // through untouched via `failCause` so `NodeRuntime.runMain` still sees a
    // real interruption; everything else gets the envelope.
    Effect.catchAll((cause) =>
      Cause.isInterruptedOnly(cause) ? Effect.failCause(cause) : report(io, plan.json)(cause),
    ),
  )
}
