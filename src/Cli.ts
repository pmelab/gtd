import { NodeContext } from "@effect/platform-node"
import { createRequire } from "node:module"
import { Cause, Effect, Either, Layer } from "effect"
import { Narrator, renderFailure } from "./Commentary.js"
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
import { EXIT_OK, EXIT_RUNTIME_ERROR, EXIT_USAGE_ERROR } from "./ExitCodes.js"

export type { CommandRequirements }

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

export type Command =
  | { readonly kind: "lsp" }
  | { readonly kind: "init" }
  | { readonly kind: "visualize"; readonly port: number; readonly open: boolean }
  | {
      readonly kind: "land"
      readonly cost?: number
      readonly model?: string
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
  | { readonly kind: "next" }
  | { readonly kind: "validate" }
  | {
      readonly kind: "check"
      readonly mode: string
      readonly file: string
      readonly openQuestions?: boolean
    }
  | { readonly kind: "install" }
  | { readonly kind: "summary" }

export type CliPlan =
  | { readonly kind: "output"; readonly stdout: string }
  | {
      readonly kind: "usage"
      readonly stdout: string
      readonly message: string
      readonly json: boolean
    }
  | {
      readonly kind: "command"
      readonly command: Command
      readonly json: boolean
      /** Whether `--sh` was present — `gtd next` only; mutually exclusive with `json` (see `conflictViolation`). */
      readonly sh: boolean
      /** Whether `--verbose`/`-v` was present — gates the `Narrator` `Cli.ts` builds for this dispatch (see `runCli`). */
      readonly verbose: boolean
    }

/**
 * What a command kind needs before it may run. `pure`/`removed` never reach
 * `io.layers()` at all (they resolve to `output`/`usage` plans). `state`
 * marks the six kinds sharing the repo-root guard, the at-least-one-commit
 * guard, and the review-window bracket — a repository with no commits has no
 * HEAD to derive workflow state from. `needsOf`/`standaloneKinds` live in
 * `program.ts` (re-exported here) rather than here, since a value import the
 * other way would make the two modules circular.
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
  /** Flag names this one may never appear alongside — checked generically after parsing (see `conflictViolation`), never as a bespoke `if`. Defaults to none. */
  readonly conflicts?: readonly string[]
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
    scope: (kind) => kind === "next" || kind === "land",
    decode: () => Either.right(true),
    scopeError:
      "gtd: --json is only valid for `gtd next`/`gtd land` — every other command prints " +
      "plain text; see `gtd install` for the driver protocol briefing",
    valueHint: "",
    help: [
      "(gtd next/gtd land only) output structured JSON",
      "instead of plain text. Mutually exclusive with --sh",
    ],
    conflicts: ["--sh"],
  },
  {
    name: "--sh",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "next" || kind === "land",
    decode: () => Either.right(true),
    scopeError:
      "gtd: --sh is only valid for `gtd next`/`gtd land` — every other command prints " +
      "plain text; see `gtd install` for the driver protocol briefing",
    valueHint: "",
    help: [
      "(gtd next/gtd land only) output gtd_-prefixed POSIX",
      "shell assignments instead of plain text. Mutually",
      "exclusive with --json",
    ],
    conflicts: ["--json"],
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
    scope: (kind) => kind === "land",
    decode: ([raw]) => nonNegativeNumber(raw ?? "", "--cost"),
    scopeError: "gtd: --cost is only valid for `gtd land` — an entry is not a metered agent turn",
    valueHint: "<n>",
    help: ["(gtd land only) record the invocation's token cost"],
  },
  {
    name: "--model",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "land",
    decode: ([raw]) =>
      raw === undefined || raw.trim() === "" || /[\r\n]/.test(raw)
        ? Either.left("gtd: --model must be a non-empty, single-line value")
        : Either.right(raw),
    scopeError: "gtd: --model is only valid for `gtd land` — an entry is not a metered agent turn",
    valueHint: "<name>",
    help: ["(gtd land only, with --cost) tag that cost's model"],
  },
  {
    name: "--entry",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "entry",
    decode: ([raw]) => Either.right(raw ?? ""),
    scopeError:
      "gtd: --entry is only valid with no other command — use the bare `gtd --entry <state>` " +
      "form; landing and entering are different verbs",
    valueHint: "<state>",
    help: [
      "(with no command at all) start a brand new process at",
      "<state> — any declared state — authenticated as human",
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
    name: "--open-questions",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "check",
    decode: () => Either.right(true),
    scopeError: "gtd: --open-questions is only valid for `gtd check`",
    valueHint: "",
    help: [
      "(gtd check only) ignore <mode>'s structural findings and",
      "instead run the qa open-questions predicate over <file>,",
      "printing each unanswered question one per line and exiting",
      "non-zero when any remain",
    ],
  },
  {
    name: "--verbose",
    arity: 0,
    repeatable: false,
    scope: () => true,
    decode: () => Either.right(true),
    scopeError: "gtd: --verbose is valid for every command — this error is unreachable",
    valueHint: "",
    help: [
      "enable stderr narration for this invocation: which rest",
      "resolved, which declared pattern each pending change",
      "matched, which review-window action was emitted, and how",
      "config resolved across layers. Aliased to -v",
    ],
  },
]

/**
 * `-v` is `--verbose`'s single-dash alias (the only one today) — resolved to
 * its canonical `--` name before flag-row lookup, so the rest of the
 * tokenizer never distinguishes how a flag was spelled. A `Map`, not a plain
 * object: an object literal inherits `Object.prototype`, so a positional
 * argument that happens to spell an inherited property name (`"valueOf"`,
 * `"toString"`, …) would otherwise resolve to that inherited FUNCTION instead
 * of `undefined`.
 */
const SINGLE_DASH_ALIASES: ReadonlyMap<string, string> = new Map([["-v", "--verbose"]])

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
    token: "land",
    kind: "land",
    arity: "none",
    details: [
      "Land whatever the tree now shows at the currently resolved",
      "rest — a human capture, an agent/check turn, or an empty",
      "attempt (a fruitless prompt turn). Pass",
      "--cost=<n> (optionally --model=<name>) to record the",
      "just-finished invocation's token cost and model on the",
      "turn commit (summed into it.processCost/",
      "processCostByModel). Plain (the default) prints ONLY the",
      "script that records the landing; a driver runs it, e.g.",
      "`gtd land | sh`. --json/--sh instead emit script (that",
      "same script, byte-identical) alongside settled, idle,",
      "state (the post-land target), subject, cost and model —",
      "--json/--sh are mutually exclusive. Exits 0 on success, 1",
      "on any refusal — see the Exit codes section below",
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
      "Hard-reset HEAD back to the tip retained by the last",
      "abandon (refs/worktree/gtd/history), bringing back an",
      "abandoned process's turns. Refuses on a dirty working",
      "tree, when there is no retained history, or when HEAD has",
      "advanced past the retained tip with commits that would be",
      "lost",
    ],
  },
  {
    token: "next",
    kind: "next",
    arity: "none",
    details: [
      "Print the resolved rest's beat (no mutation, safe to",
      "poll), in one of three encodings. Plain (the default): a",
      "status summary, a blank line, then the step verbatim —",
      "except at a prompt rest, which is the bare step (plus the",
      "self-validation instruction when applicable) with no",
      "header, since those bytes are the agent's own input. --json",
      "emits the one structured surface gtd has: kind",
      "(capture|message|script|prompt|stalled) selects what a",
      "driver does, content is what it runs or shows, idle marks",
      "the workflow's initial state with a clean tree, plus the",
      "prompt session, model, validate script, log path, changes,",
      "next and the resting state's own fields. --sh emits the",
      "same fields as gtd_-prefixed POSIX shell assignments.",
      "--json/--sh are mutually exclusive. Exits 0 — see the",
      "Exit codes section below",
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
      'own exit code/output. Always exits 0; prints "nothing to',
      'validate" when the resolved rest declares nothing to run.',
      "On a non-zero validate exit the emitted script prints a",
      "ready-to-send fix prompt (instruction + findings) and",
      "exits with the validator's own code",
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
      "local web server (--port <n>, --no-open). Prints the",
      "chosen port on its own line — with --port 0, this is the",
      "only way to learn which port was picked",
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
      "workflow's emitted validation script invokes as a leaf step.",
      "--open-questions runs the qa unanswered-questions predicate",
      "instead (see --help)",
    ],
  },
  {
    token: "install",
    kind: "install",
    arity: "none",
    details: [
      "Print a complete, self-contained briefing that teaches an",
      "agent (or a human) to build a gtd driver in any shell or",
      "runtime — the self-serve version of",
      "https://github.com/pmelab/gtd/blob/main/docs/driver.md's",
      "'Writing your own driver'. Writes nothing: this installs",
      "knowledge into the calling agent's context, not files on disk.",
    ],
  },
  {
    token: "summary",
    kind: "summary",
    arity: "none",
    details: [
      "Print the prompt for an agent to write the process HEAD",
      "closes or sits inside its own closing message — the entry",
      "commit, each human-authored commit (a review round, an",
      "answered question gate), the diff range to inspect, and",
      "it.processCost/processCostByModel. Writes nothing: no git,",
      "no state transition, no file, no session identity — the",
      "driver pipes the output to a cold agent and does what it",
      "wants with the result (a squash, an amend, a PR body).",
      "Refuses (exit 1) when the workflow declares no summary:",
      "template, or when the resolved run has no commits to name",
      "— runnable any time before the next thing lands on the",
      "branch",
    ],
  },
]

const commandByToken = (token: string): CommandRow | undefined =>
  COMMAND_ROWS.find((r) => r.token === token)

/**
 * Named commands the generic `--entry` mechanism replaced. No fallback: they
 * fail with a message pointing at the replacement rather than the generic
 * "unknown command".
 */
const REMOVED: Readonly<Record<string, string>> = {
  step:
    "gtd: `gtd step <actor>` is gone — landing is actorless; run `gtd land` " +
    "instead (`gtd --entry <state>` for entries)",
  review:
    "gtd: `gtd review <commitish>` is gone — this workflow's own state names " +
    "aren't known to gtd; run `gtd --entry <review-state> " +
    "--var <name>=<value> ...` instead — run it with an unknown <review-state> " +
    "to see this workflow's own enterable states",
  fix:
    "gtd: `gtd fix` is gone — this workflow's own state names aren't known to " +
    "gtd; run `gtd --entry <fix-state>` instead — run it with an " +
    "unknown <fix-state> to see this workflow's own enterable states",
  loop:
    "gtd: `gtd loop` is gone — gtd decides and prints, a driver executes. " +
    "Run `gtd install`, or copy the reference driver from " +
    "https://github.com/pmelab/gtd/blob/main/docs/driver.md's " +
    '"A complete minimal driver" section and run that instead',
  status: "gtd: `gtd status` is gone — run `gtd next` instead; --json moved with it",
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
  "Starts a new process authenticated as human, e.g.",
  "'gtd --entry <state>'",
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
    commandBlocks[1], // land
    ENTRY_SHORT_FORM,
    ...commandBlocks.slice(2), // abandon..check
    VERSION_BLOCK,
    HELP_BLOCK,
  ].join("")

  const options = FLAGS.map((row) => renderBlock(flagHeader(row), row.help)).join("")
  const versionHelpOptions =
    renderBlock("--version, -V", ["Print version and exit"]) +
    renderBlock("--help, -h", ["Print this help and exit"])

  return (
    `Usage: gtd [command] [options]\n\n` +
    `Commands:\n${commands}\n` +
    `Options:\n${options}${versionHelpOptions}`
  )
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
    const original = tail[i]!
    const tok = SINGLE_DASH_ALIASES.get(original) ?? original
    if (!tok.startsWith("--")) {
      positionals.push(original)
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

/** A table field, not an `if`: any row present alongside a flag it names in `conflicts` is a usage error — checked generically over every row, so a new conflicting pair is one table edit. */
const conflictViolation = (present: ReadonlySet<string>): string | undefined => {
  for (const row of FLAGS) {
    if (!present.has(row.name)) continue
    for (const other of row.conflicts ?? []) {
      if (present.has(other)) return `gtd: ${row.name} and ${other} are mutually exclusive`
    }
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

/** Decode every present flag into a bag of values, or the first decode error encountered. */
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

/** Assembles a `land` `Command` from its already-scope-checked flag bag — split out of `parseArgv` so its two independent, omit-when-absent optional fields don't inflate that function's own branching. */
const buildLandCommand = (bag: {
  readonly "--cost"?: number
  readonly "--model"?: string
}): Command => ({
  kind: "land",
  ...(bag["--cost"] !== undefined ? { cost: bag["--cost"] } : {}),
  ...(bag["--model"] !== undefined ? { model: bag["--model"] } : {}),
})

// fallow-ignore-next-line complexity
export const parseArgv = (argv: readonly string[]): CliPlan => {
  if (argv.includes("--help") || argv.includes("-h"))
    return { kind: "output", stdout: renderHelp() }
  if (argv.includes("--version") || argv.includes("-V")) {
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

  // The `--entry` selector: no command at all, with `--entry` present,
  // resolves to the generic `entry` command instead — landing and entering
  // are different verbs, so `gtd land --entry <state>` is NOT a synonym (it
  // fails the scope check below instead).
  const selectsEntry = entryPresent && first === undefined
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
          "run `gtd install`, or copy one from " +
          "https://github.com/pmelab/gtd/blob/main/docs/driver.md's " +
          '"A complete minimal driver" section and run that, or see usage ' +
          "above (`gtd --help`)",
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
    // `kind === "entry"` is unreachable here: `selectsEntry` only fires when
    // `first === undefined`, which the `if` branch above already handled.
    const arityMsg = arityError(first!, restPositionals, row!.arity)
    if (arityMsg !== undefined) return usagePlan(arityMsg, jsonSeen)
  }

  const violation = scopeViolation(kind, present)
  if (violation !== undefined) return usagePlan(violation, jsonSeen)

  const conflict = conflictViolation(present)
  if (conflict !== undefined) return usagePlan(conflict, jsonSeen)

  const decoded = decodeFlags(byFlag)
  if (Either.isLeft(decoded)) return usagePlan(decoded.left, jsonSeen)
  const bag = decoded.right as {
    readonly "--json"?: boolean
    readonly "--port"?: number
    readonly "--no-open"?: boolean
    readonly "--cost"?: number
    readonly "--model"?: string
    readonly "--var"?: Readonly<Record<string, string>>
    readonly "--open-questions"?: boolean
  }

  const json = present.has("--json")
  const sh = present.has("--sh")
  const verbose = present.has("--verbose")

  if (kind === "land") {
    if (bag["--model"] !== undefined && bag["--cost"] === undefined) {
      return usagePlan(
        "gtd: --model requires --cost — it tags the recorded cost with the model that ran",
        json,
      )
    }
    return { kind: "command", command: buildLandCommand(bag), json, sh, verbose }
  }

  if (kind === "entry") {
    const label = `gtd --entry ${entryRaw}`
    return {
      kind: "command",
      command: { kind: "entry", actor: "human", state: entryRaw!, vars: bag["--var"] ?? {}, label },
      json,
      sh,
      verbose,
    }
  }

  if (kind === "visualize") {
    return {
      kind: "command",
      command: { kind: "visualize", port: bag["--port"] ?? 0, open: !(bag["--no-open"] ?? false) },
      json,
      sh,
      verbose,
    }
  }

  if (kind === "check") {
    return {
      kind: "command",
      command: {
        kind: "check",
        mode: restPositionals[0]!,
        file: restPositionals[1]!,
        ...(bag["--open-questions"] !== undefined
          ? { openQuestions: bag["--open-questions"] }
          : {}),
      },
      json,
      sh,
      verbose,
    }
  }

  // Every other kind carries no extra fields.
  const command: Command = {
    kind: kind as
      | "lsp"
      | "init"
      | "abandon"
      | "restore"
      | "next"
      | "validate"
      | "install"
      | "summary",
  }
  return { kind: "command", command, json, sh, verbose }
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

export interface CliIo {
  readonly stdout: (chunk: string) => void
  readonly stderr: (chunk: string) => void
  readonly exit: (code: number) => void
  /**
   * Deferred thunk — a layer is built only for a resolved `Command`, never
   * for `--version`/`--help`/a usage error. `verbose` (`--verbose`/`-v`,
   * decoded by `parseArgv`) gates the `Narrator` this builds — a no-op
   * writer when `false`.
   */
  readonly layers: (verbose: boolean) => Layer.Layer<CommandRequirements>
}

// The one write-to-stderr primitive nodeCliIo uses for both `stderr` (errors)
// and `layers`'s `Narrator` (narration) — same sink, so a real invocation's
// narration and its remediation interleave on the same fd exactly as
// written.
const writeStderr = (chunk: string): void => {
  process.stderr.write(chunk)
}

export const nodeCliIo: CliIo = {
  // `process.stdout.write` is asynchronous whenever stdout is a pipe or
  // socket — passing a completion callback (and never force-closing, see
  // `exit` below) keeps a queued remainder from being discarded, so a large
  // artifact still reaches a slow reader even after a non-zero exit.
  stdout: (chunk) => {
    process.stdout.write(chunk, () => {})
  },
  stderr: writeStderr,
  exit: (code) => {
    // Never `process.exit(code)`: that tears the process down out from under
    // an undrained `stdout.write` above and truncates the artifact mid-pipe.
    // Setting `exitCode` lets the event loop run to completion — draining
    // any queued write — before Node exits gracefully with this code.
    process.exitCode = code
  },
  // A Layer is a lazy description, not a running service — building this
  // object touches no filesystem/git; only `Effect.provide` running the
  // result does. `runCli` calls this thunk exactly when `plan.kind ===
  // "command"`, so --version/--help/a usage error never provoke it.
  layers: (verbose) =>
    // Dependency order matters: RepoFiles.Live needs GitService, both need Cwd,
    // and GitService/CommandRunner need NodeContext's CommandExecutor. Each
    // `provideMerge` satisfies the layers above it AND stays in the output.
    Layer.mergeAll(
      ConfigService.Live,
      RepoFiles.Live,
      CommandRunner.Live,
      EnvVars.Live,
      Narrator.layer(writeStderr, verbose),
    ).pipe(
      Layer.provideMerge(GitService.Live),
      Layer.provideMerge(Cwd.Live),
      Layer.provideMerge(NodeContext.layer),
    ),
}

/**
 * The all-or-nothing stdout buffer every `run*Command` handler writes
 * through instead of `io.stdout` directly. `flush()` is called exactly once,
 * by `runCli`, after the command's Effect succeeds; on any failure `flush()`
 * is never reached, so the buffer is simply discarded and nothing reaches
 * `io.stdout`. `visualize` is the one handler that calls `flush()` itself,
 * ahead of blocking on `Effect.never` — since it blocks forever, `runCli`'s
 * own flush-on-success would otherwise never fire and its output would never
 * reach stdout.
 */
export interface ArtifactOut {
  readonly write: (chunk: string) => void
  readonly flush: () => void
}

/**
 * Normalizes an artifact's trailing newlines to exactly one — an emitted
 * script ends with none, plain text already ends with one, so this is the
 * single place both become uniform. A byte-empty artifact stays byte-empty
 * (never becomes a lone `\n`); several trailing newlines collapse to one.
 */
export const normalizeTrailingNewline = (artifact: string): string =>
  artifact.length === 0 ? artifact : `${artifact.replace(/\n+$/, "")}\n`

const bufferedArtifactOut = (io: CliIo): ArtifactOut => {
  let buffer = ""
  return {
    write: (chunk) => {
      buffer += chunk
    },
    flush: () => {
      if (buffer.length > 0) io.stdout(normalizeTrailingNewline(buffer))
      buffer = ""
    },
  }
}

/**
 * The single envelope writer: `{state:"error",prompt}` on **stderr** under
 * `--json`, `renderFailure` on stderr always, exit `EXIT_RUNTIME_ERROR`.
 * stdout is never touched here — the command's `ArtifactOut` buffer was never
 * flushed, so a `--json` driver piping stdout into `jq` on a failed run must
 * read stderr or the exit code instead. `Effect.sandbox` means this also
 * fires for a DEFECT, not just a typed error. Never reached for a USAGE
 * error — those never build a layer at all.
 */
const report =
  (io: CliIo, json: boolean) =>
  (cause: Cause.Cause<Error>): Effect.Effect<void> =>
    Effect.sync(() => {
      const error = Cause.squash(cause)
      if (json) {
        const message = error instanceof Error ? error.message : String(error)
        io.stderr(`${JSON.stringify({ state: "error", prompt: message })}\n`)
      }
      io.stderr(`${renderFailure(error)}\n`)
      io.exit(EXIT_RUNTIME_ERROR)
    })

export const runCli = (argv: readonly string[], io: CliIo): Effect.Effect<void, Error> => {
  const plan = parseArgv(argv)

  if (plan.kind === "output") {
    return Effect.sync(() => io.stdout(plan.stdout))
  }

  if (plan.kind === "usage") {
    return Effect.sync(() => {
      // The rendered help text (missing-command only) and the `--json`
      // envelope both move to stderr — stdout stays byte-empty on a usage
      // error exactly like every other failure surface.
      if (plan.stdout.length > 0) io.stderr(plan.stdout)
      if (plan.json) {
        io.stderr(`${JSON.stringify({ state: "error", prompt: plan.message })}\n`)
      }
      io.stderr(`${renderFailure(plan.message)}\n`)
      io.exit(EXIT_USAGE_ERROR)
    })
  }

  const out = bufferedArtifactOut(io)
  return runCommand(plan.command, plan.json, plan.sh, out).pipe(
    // `flush()` fires here, on success, BEFORE `io.exit` — the one point
    // where the whole buffered artifact is known-complete and safe to hand
    // to stdout (a failure discards the buffer instead — see
    // `bufferedArtifactOut`).
    Effect.map(() => {
      out.flush()
      io.exit(EXIT_OK)
    }),
    Effect.provide(io.layers(plan.verbose)),
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
