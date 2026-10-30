import { Cause, Effect, Layer, Result } from "effect"
import {
  GtdError,
  GtdUsageError,
  Narrator,
  renderFailure,
  GitService,
  Host,
  Workspace,
  CommandRunner,
  NodeServices,
  nodeStdio,
  type Stdio,
} from "../platform/index.js"
import {
  flagSettings,
  flagSettingValue,
  resolveFlags,
  type FlagDeclaration,
} from "../flags/index.js"
import { GTD_VERSION } from "../install/index.js"
import {
  ConfigDiscovery,
  ConfigService,
  EngineCore,
  isSettingName,
  SETTING_NAME_RULE,
  StartFlags,
} from "../workflow/index.js"
// The shared command types live in `Program.ts`, which imports nothing from
// here, so this dependency stays one-directional.
import {
  runCommand,
  SelectorUsageError,
  type ArtifactOut,
  type Command,
  type CommandRequirements,
  type JsonMode,
} from "./Program.js"
import type { ToolCommands } from "./ToolCommands.js"
import { THRESHOLDS } from "./Judges.js"
import { closest, definition, wrap } from "./Help.js"
import { EXIT_RUNTIME_ERROR, EXIT_USAGE_ERROR } from "../wire/index.js"

export type { Command, CommandRequirements } from "./Program.js"
export { needsOf, standaloneKinds } from "./Program.js"

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
      readonly json: JsonMode
      /** Whether `--verbose`/`-v` was present — gates the `Narrator` `Cli.ts` builds for this dispatch (see `runCli`). */
      readonly verbose: boolean
    }

// ---------------------------------------------------------------------------
// Flag table
// ---------------------------------------------------------------------------

type FlagScope = (kind: Command["kind"] | undefined) => boolean

interface FlagRow {
  readonly name: string
  /**
   * `"optional"` is a third generic mode: a value only from the `=` form
   * (`--json=<path>`), never consuming a following token — bare `--json`
   * records presence with no value. See `tokenize`'s single generic branch.
   */
  readonly arity: 0 | 1 | "optional"
  readonly repeatable: boolean
  readonly scope: FlagScope
  /** All raw occurrences (already de-`=`-ed) → the decoded value, or an error message. */
  readonly decode: (raws: readonly string[]) => Result.Result<unknown, string>
  readonly scopeError: string
  readonly valueHint: string
  /** One sentence for a command's help, wrapped when rendered; `helpFor` overrides it for a command the flag means something else on. */
  readonly help: string
  readonly helpFor?: Partial<Record<Command["kind"], string>>
  /** Flag names this one may never appear alongside — checked generically after parsing (see `conflictViolation`), never as a bespoke `if`. Defaults to none. */
  readonly conflicts?: readonly string[]
}

/** `<name>=<value>` occurrences of `flag` → one record, each name a setting name given at most once. */
const decodeAssignments = (
  flag: string,
  raws: readonly string[],
): Result.Result<Readonly<Record<string, string>>, string> => {
  const vars: Record<string, string> = {}
  for (const raw of raws) {
    const eq = raw.indexOf("=")
    if (eq <= 0) {
      return Result.fail(`gtd: ${flag} must be <name>=<value> with a non-empty name — got "${raw}"`)
    }
    const name = raw.slice(0, eq)
    const value = raw.slice(eq + 1)
    if (!isSettingName(name)) {
      return Result.fail(
        `gtd: ${flag} ${JSON.stringify(name)} is not a valid setting name — ${SETTING_NAME_RULE}`,
      )
    }
    if (/[\r\n]/.test(value)) return Result.fail(`gtd: ${flag} ${name} must be a single-line value`)
    if (Object.hasOwn(vars, name))
      return Result.fail(`gtd: ${flag} ${name} specified more than once`)
    if (!name.startsWith("flag_")) {
      vars[name] = value
      continue
    }
    const pinned = flagSettingValue(value)
    if (pinned === undefined) return Result.fail(`gtd: ${flag} ${name} must be 1, 0, true or false`)
    vars[name] = pinned
  }
  return Result.succeed(vars)
}

const nonNegativeNumber = (raw: string, flag: string): Result.Result<number, string> => {
  const n = Number(raw)
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
    return Result.fail(`gtd: ${flag} must be a non-negative number — got "${raw}"`)
  }
  return Result.succeed(n)
}

/** The commands whose only output is a script: `--json` prints `{ schema, script }`. */
const SCRIPT_KINDS: ReadonlySet<Command["kind"]> = new Set<Command["kind"]>([
  "start",
  "abandon",
  "restore",
  "repin",
  "validate",
  "historyFetch",
])

const SCRIPT_JSON_HELP = "Print { schema, script }, or with --json=script the script alone"

const JSON_KINDS: ReadonlySet<Command["kind"] | undefined> = new Set<Command["kind"]>([
  ...SCRIPT_KINDS,
  "next",
  "land",
  "judge",
  "judgeAnswer",
  "historyList",
  "historyShow",
  "historyMetrics",
  "historyJudges",
  "strays",
])

const FLAGS: readonly FlagRow[] = [
  {
    name: "--json",
    arity: "optional",
    repeatable: false,
    scope: (kind) => JSON_KINDS.has(kind),
    decode: ([raw]) => Result.succeed(raw ?? ""),
    scopeError:
      "gtd: --json is only valid for `gtd next`/`gtd land`, the commands that print a script, and the listings whose help names it (e.g. `gtd strays`) — " +
      "every other command prints plain text; see `gtd guide` for the driver protocol briefing",
    valueHint: "<path>",
    help: "Print the JSON document, or with --json=<path> one field of it (e.g. --json=kind): a scalar bare, a list one entry per line, nothing for an absent field",
    helpFor: {
      strays: "Print one entry of the array (--json=0), nothing past its end",
      ...Object.fromEntries([...SCRIPT_KINDS].map((kind) => [kind, SCRIPT_JSON_HELP])),
      start: `${SCRIPT_JSON_HELP}. Bare, print the list as a JSON array of { kind, name } (a door adds workflow and args)`,
    },
  },
  {
    name: "--port",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "ui",
    decode: ([raw]) => {
      const n = Number(raw)
      return raw !== undefined && Number.isInteger(n) && n >= 0 && n <= 65535
        ? Result.succeed(n)
        : Result.fail(`gtd: --port must be an integer 0–65535 (got '${raw ?? ""}')`)
    },
    scopeError: "gtd: --port is only valid for `gtd ui`",
    valueHint: "<n>",
    help: "The tailscale serve port (default: the first free of 8443, 10000, 443), or with --host the port to bind (default: any free one)",
  },
  {
    name: "--host",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "ui",
    decode: ([raw]) =>
      raw === undefined || raw.trim() === "" || /[\r\n]/.test(raw)
        ? Result.fail("gtd: --host must be a non-empty, single-line value")
        : Result.succeed(raw),
    scopeError: "gtd: --host is only valid for `gtd ui`",
    valueHint: "<addr>",
    help: "Bind this address directly instead of publishing through tailscale serve",
  },
  {
    name: "--self-signed",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "ui",
    decode: () => Result.succeed(true),
    scopeError: "gtd: --self-signed is only valid for `gtd ui`",
    valueHint: "",
    help: "Bind directly with a throwaway self-signed certificate instead of the configured ui.cert/ui.key",
  },
  {
    name: "--dev",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "ui",
    decode: () => Result.succeed(true),
    scopeError: "gtd: --dev is only valid for `gtd ui`",
    valueHint: "",
    help: "Serve local development sources instead of the packaged build",
  },
  {
    name: "--provider",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "judgeRun",
    decode: ([raw]) =>
      raw === "fixed" || raw === "jev" || raw === "llm"
        ? Result.succeed(raw)
        : Result.fail(`gtd: --provider must be one of fixed, jev, llm — got "${raw ?? ""}"`),
    scopeError: "gtd: --provider is only valid for `gtd judge run`",
    valueHint: "<name>",
    help: "The answerer: fixed, jev or llm (default: $GTD_JUDGE_PROVIDER, then ~/.config/gtd/judge.json, then jev when $TYPESAFE_API_KEY is set, else llm)",
  },
  {
    name: "--answers",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "judgeRun",
    decode: ([raw]) =>
      raw === undefined || raw === ""
        ? Result.fail("gtd: --answers must be a non-empty path")
        : Result.succeed(raw),
    scopeError: "gtd: --answers is only valid for `gtd judge run`",
    valueHint: "<path>",
    help: "With --provider fixed: a JSON verdict file [{ id, answer, p }] (default: $GTD_JUDGE_ANSWERS, inline JSON)",
  },
  {
    name: "--cost",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "land",
    decode: ([raw]) => nonNegativeNumber(raw ?? "", "--cost"),
    scopeError: "gtd: --cost is only valid for `gtd land` — a start is not a metered agent turn",
    valueHint: "<n>",
    help: "Record the token cost of the invocation that just finished on the commit",
  },
  {
    name: "--model",
    arity: 1,
    repeatable: false,
    scope: (kind) => kind === "land" || kind === "judgeRun",
    decode: ([raw]) =>
      raw === undefined || raw.trim() === "" || /[\r\n]/.test(raw)
        ? Result.fail("gtd: --model must be a non-empty, single-line value")
        : Result.succeed(raw),
    scopeError:
      "gtd: --model is only valid for `gtd land` (with --cost: the model to record the cost against) or `gtd judge run` (the model that answers)",
    valueHint: "<name>",
    help: "",
    helpFor: {
      land: "With --cost: the model that cost was spent on — recorded on the commit, nothing runs on it",
      judgeRun:
        "The claude model the llm answerer uses (default: $GTD_JUDGE_MODEL, then judge.json, then sonnet)",
    },
  },
  {
    name: "--threshold",
    arity: 1,
    repeatable: true,
    scope: (kind) => kind === "historyJudges",
    decode: (raws) => decodeAssignments("--threshold", raws),
    scopeError: "gtd: --threshold is only valid for `gtd history judges`",
    valueHint: "<name>=<value>",
    help: "Re-decide every past verdict under this threshold: judgeIdenticalMinP or qualityTriageMinP (repeatable)",
  },
  {
    name: "--var",
    arity: 1,
    repeatable: true,
    scope: (kind) => kind === "start",
    decode: (raws) => decodeAssignments("--var", raws),
    scopeError: "gtd: --var is only valid for `gtd start <name>`",
    valueHint: "<name>=<value>",
    help: "Pin one of the workflow's declared settings for the new process (repeatable); through a door, on top of the settings its args set",
  },
  {
    name: "--jsonl",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "historyJudges",
    decode: () => Result.succeed(true),
    scopeError: "gtd: --jsonl is only valid for `gtd history judges`",
    valueHint: "",
    help: "Print one JSON line per verdict instead of the report",
    conflicts: ["--json", "--threshold"],
  },
  {
    name: "--open-questions",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "check",
    decode: () => Result.succeed(true),
    scopeError: "gtd: --open-questions is only valid for `gtd check`",
    valueHint: "",
    help: "Instead of <mode>'s findings, list the unanswered questions in <file>; exits 1 when any remain",
  },
  {
    name: "--open-threads",
    arity: 0,
    repeatable: false,
    scope: (kind) => kind === "check",
    decode: () => Result.succeed(true),
    scopeError: "gtd: --open-threads is only valid for `gtd check`",
    valueHint: "",
    help: "Instead of <mode>'s findings, list the open threads in <file>; exits 1 when any are open. Alone, lists the open code-comment threads in the files the current process changed",
  },
  {
    name: "--verbose",
    arity: 0,
    repeatable: false,
    scope: () => true,
    decode: () => Result.succeed(true),
    scopeError: "gtd: --verbose is valid for every command — this error is unreachable",
    valueHint: "",
    help: "Narrate on stderr what gtd resolved and where its config came from",
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

type Arity =
  | "none"
  | { readonly name: string }
  | { readonly names: readonly [string, string] }
  // One required leading positional, then any number the command itself judges.
  | { readonly name: string; readonly variadic: string }
  // The same, the leading one optional too.
  | { readonly name: string; readonly variadic: string; readonly bare: true }
  // At most one trailing positional.
  | { readonly name: string; readonly optional: true }
  // Any number of positionals, none included.
  | { readonly name: string; readonly many: true }

type Group = "Core loop" | "Start and stop" | "Inspect" | "Driver plumbing"

interface CommandRow {
  readonly token: string
  readonly kind: Command["kind"]
  readonly arity: Arity
  readonly group: Group
  /** The top-level help's one line — short enough for its column. */
  readonly summary: string
  /** The command's own help: prose paragraphs, wrapped when rendered (see `wrap`). */
  readonly details: string
}

const COMMAND_ROWS: readonly CommandRow[] = [
  {
    token: "next",
    kind: "next",
    arity: "none",
    group: "Core loop",
    summary: "Print what should happen next",
    details: `Print what should happen next in the process, changing nothing — safe to poll.

Plain output is for a person: a status header (the step, who acts, the pending changes, where landing them would go), then the step's content. At a prompt the header goes to stderr, so stdout is exactly the agent's input.

--json prints one JSON document for a driver: its kind (capture, message, script, prompt or stalled) says what to do, its content what to run or show. --json=<path> prints one field of it; an unknown path is a usage error (exit 2).`,
  },
  {
    token: "land",
    kind: "land",
    arity: "none",
    group: "Core loop",
    summary: "Record what the tree now shows",
    details: `Record what the working tree now shows at the current step: a person's edit, an agent's or a check's turn, or an empty attempt when an agent changed nothing.

gtd writes nothing itself. Plain output names the commit it would make; --json=script prints the script that makes it:

  s=$(gtd land --json=script) && sh -c "$s"

--json prints the whole document: the script, the step the process lands at, the commit subject, and the recorded cost and model. A refusal exits 1.`,
  },
  {
    token: "validate",
    kind: "validate",
    arity: "none",
    group: "Core loop",
    summary: "Print the script that checks the steering file",
    details: `Print the script that formats, then validates, the current step's steering file with its mode's commands. gtd runs nothing: the script's exit code is the verdict, and on a failure it prints a ready-to-send fix prompt. Prints "nothing to validate" when the step declares no file to check; --json=script then prints an empty script.`,
  },
  {
    token: "start",
    kind: "start",
    arity: { name: "name", variadic: "args", bare: true },
    group: "Start and stop",
    summary: "Start a workflow or door; bare, list them",
    details: `Start a new process: print the script that makes its first commit, which also commits whatever the working tree holds.

<name> is a door — a named shortcut whose positional args set the workflow's settings — or else a workflow the config exports, which takes no args. A door shadows a workflow of the same name. --var pins a setting either way.

  s=$(gtd start <name> --json=script) && sh -c "$s"

With no <name>, list every workflow and door it can start. An unknown <name>, the wrong number of args, or a --var the workflow does not declare is a usage error (exit 2); a process already underway is a refusal (exit 1).`,
  },
  {
    token: "abandon",
    kind: "abandon",
    arity: "none",
    group: "Start and stop",
    summary: "Stop the process, keeping its changes",
    details: `Stop the process underway without finishing it. The printed script moves HEAD back to the commit the process started from and keeps everything it produced as uncommitted changes; \`gtd restore\` undoes it. With no process underway the script does nothing.

  s=$(gtd abandon --json=script) && sh -c "$s"`,
  },
  {
    token: "restore",
    kind: "restore",
    arity: "none",
    group: "Start and stop",
    summary: "Bring back the last abandoned process",
    details: `Bring back the process the last \`gtd abandon\` stopped: the printed script resets HEAD to that process's last commit. Refuses on a dirty working tree, when nothing was abandoned, or when commits made since would be lost.`,
  },
  {
    token: "repin",
    kind: "repin",
    arity: "none",
    group: "Start and stop",
    summary: "Pin the process to the live gtd and workflow",
    details: `Switch the process underway to the live engine and workflow, the way out when the workflow needs a fix mid-process: the printed script runs the pin beat again, writing \`gtd bundle\`'s output to .gtd/process.gtdpin and committing that file alone. Always runs on the gtd on PATH, never on the pin. When the live workflow no longer replays the process, the commit continues from the divergence: a Gtd-Anchor trailer names the last commit it replays, the later commits stay as files only, and the process rests at the step the live workflow reached there. Refuses when no process is underway, when the next beat is a pin or unpin beat already, when an unpinned process diverges, or when the live workflow would continue at the default workflow's first step.

  s=$(gtd repin --json=script) && sh -c "$s"`,
  },
  {
    token: "summary",
    kind: "summary",
    arity: "none",
    group: "Inspect",
    summary: "Print the prompt for the closing message",
    details: `Print the prompt for an agent to write the closing message of the process HEAD closes or sits inside: its first commit, each commit a person made, the diff range to read, and its cost. Writes nothing — what to do with the answer (a squash message, a PR body) is the driver's call.

Refuses when the workflow declares no summary template, or when the process has no commits.`,
  },
  {
    token: "base",
    kind: "base",
    arity: "none",
    group: "Inspect",
    summary: "Print the commit a review diff starts from",
    details: `Print the commit a review diff should start from, bare: the process's diff base before the first review round, the latest round's boundary after it. Writes nothing; refuses when no process is underway.`,
  },
  {
    token: "strays",
    kind: "strays",
    arity: { name: "range", variadic: "glob" },
    group: "Inspect",
    summary: "List changed files outside the globs",
    details: `List the files changed in <range> (<base>..<tip>, an empty side is HEAD) that match none of the globs. Globs are anchored at the repository root: * stays within one path segment, ** crosses them, everything else is literal — quote them in the shell.

Prints a sorted JSON array ([] when clean) and a summary on stderr; --verbose adds one stray: line per path. Runs in any git repository, no process needed. Exits 10 when strays were found, 1 on an unknown revision, 2 on a bad range.`,
  },
  {
    token: "history list",
    kind: "historyList",
    arity: "none",
    group: "Inspect",
    summary: "List finished processes",
    details: `List the finished processes this clone keeps, newest first: entry, branch, tip, date and subject. --json prints an array of { ref, entry, branch, tip, date, subject }. Writes nothing; with none kept it suggests \`gtd history fetch\`.`,
  },
  {
    token: "history show",
    kind: "historyShow",
    arity: { name: "ref" },
    group: "Inspect",
    summary: "Replay one finished process",
    details: `Replay one finished process under today's config and print its steps, judge verdicts and approvals. <ref> is a full ref, an entry hash or a unique prefix of one, or a branch name. Refuses when a config file changed since; a different gtd version only warns. --json prints the trail as one document. Writes nothing.`,
  },
  {
    token: "history metrics",
    kind: "historyMetrics",
    arity: { name: "ref", many: true },
    group: "Inspect",
    summary: "Report cost and rework of finished processes",
    details: `Report how finished processes went: builds that landed first time or were rebuilt, cost by model and phase, review findings per lens, and red checks that passed when re-run — per process and in total. <ref> is read as by \`gtd history show\`, but a branch name means every process kept from it; no <ref> means all of them. Never replays, so a changed config is no reason to refuse. --json prints { processes, total }. Writes nothing.`,
  },
  {
    token: "history judges",
    kind: "historyJudges",
    arity: { name: "ref", many: true },
    group: "Inspect",
    summary: "Calibrate the judges of finished processes",
    details: `Calibrate the judges of finished processes from their recorded verdicts: per judge and confidence bucket, how many verdicts later events overturned. <ref> is read as by \`gtd history metrics\`. Never replays and asks no model. --json prints { processes, total, whatIf }. Writes nothing.`,
  },
  {
    token: "history fetch",
    kind: "historyFetch",
    arity: { name: "remote", optional: true },
    group: "Inspect",
    summary: "Print a script that fetches finished processes",
    details: `Print a script that fetches every finished process kept on <remote> (default: origin) and reports how many arrived. gtd runs no git itself:

  s=$(gtd history fetch --json=script) && sh -c "$s"`,
  },
  {
    token: "ui",
    kind: "ui",
    arity: "none",
    group: "Inspect",
    summary: "Serve the web and phone client",
    details: `Serve gtd's web and phone client for this worktree. By default it publishes through \`tailscale serve\`, reachable from anywhere on the tailnet, on the first of ports 8443, 10000 and 443 that works; when none does it serves HTTPS locally instead of refusing.`,
  },
  {
    token: "guide",
    kind: "guide",
    arity: "none",
    group: "Driver plumbing",
    summary: "Print a briefing for writing a driver",
    details: `Print a self-contained briefing that teaches an agent or a person to build a gtd driver in any shell or runtime, and where to get a workflow — gtd ships none. Writes nothing.`,
  },
  {
    token: "bundle",
    kind: "bundle",
    arity: "none",
    group: "Driver plumbing",
    summary: "Print the pin of the current workflow",
    details: `Print a pin to stdout: gtd's engine and the current workflow — gtd.config.ts, every module it imports and every npm package they use — as one gzipped ES module, after a plain-text header line \`gtdpin <format> gtd <version>\`. Git diffs it as binary. Refuses a workflow gtd would refuse, and a package that loads a native addon (.node), naming it. Writes nothing.`,
  },
  {
    token: "judge",
    kind: "judge",
    arity: "none",
    group: "Driver plumbing",
    summary: "Print the pending judgment",
    details: `Print the current step's pending judgment: the prepared state, its questions and their criteria — the judge field \`gtd next --json\` carries. Writes nothing; refuses when the step declares no judge.`,
  },
  {
    token: "judge answer",
    kind: "judgeAnswer",
    arity: "none",
    group: "Driver plumbing",
    summary: "Land a verdict read from stdin",
    details: `Read a verdict from stdin — one { id, answer, p } entry per pending question — and land it the way \`gtd land\` does: plain output names the commit, --json=script prints the script. Refuses when the step declares no judge; a verdict that is not JSON, or names a question that was not asked, is a usage error (exit 2).`,
  },
  {
    token: "judge run",
    kind: "judgeRun",
    arity: "none",
    group: "Driver plumbing",
    summary: "Answer a judgment with a model",
    details: `Answer a judgment: read the \`gtd judge --json\` document from stdin and print the verdict [{ id, answer, p }] \`gtd judge answer\` reads. Needs no repository.

The fixed answerer reads --answers and leaves out the questions it does not cover; jev asks TypeSafe ($TYPESAFE_API_KEY); llm asks the \`claude\` CLI on PATH. jev and llm exit 1, printing nothing, when they cannot answer every question. A stdin that is not a judgment document is a usage error (exit 2).`,
  },
  {
    token: "check",
    kind: "check",
    arity: { names: ["mode", "file"] },
    group: "Driver plumbing",
    summary: "Check a steering file's format",
    details: `Run the steering format <mode> (qa, review or findings) over <file> and print each finding on a line of its own; exits 1 when there are any, or when <file> does not exist. An unknown <mode> is a usage error (exit 2). Reads no workflow and runs from any directory — emitted validation scripts call it.`,
  },
  {
    token: "uncheck",
    kind: "uncheck",
    arity: { name: "file" },
    group: "Driver plumbing",
    summary: "Untick a review file's boxes",
    details: `Reset every ticked review box (- [x]) in <file> to - [ ], writing the file only when it changes; a missing file writes nothing. Reads no workflow and runs from any directory — the landing script at a review gate calls it, so no tick is ever committed.`,
  },
  {
    token: "lsp",
    kind: "lsp",
    arity: "none",
    group: "Driver plumbing",
    summary: "Start the steering-file language server",
    details: `Start the language server for .gtd/ steering files on stdio.`,
  },
]

const commandByToken = (token: string): CommandRow | undefined =>
  COMMAND_ROWS.find((r) => r.token === token)

/** Every word that may follow `gtd`, for "did you mean". */
const COMMAND_WORDS: readonly string[] = [
  ...new Set([...COMMAND_ROWS.map((r) => r.token.split(" ")[0]!), "help", "version"]),
]

// ---------------------------------------------------------------------------
// Help rendering
// ---------------------------------------------------------------------------

const TOP_COLUMN = 28
const OPTION_COLUMN = 22

const synopsis = (row: CommandRow): string => {
  const { token, arity } = row
  if (arity === "none") return token
  if ("names" in arity) return `${token} <${arity.names[0]}> <${arity.names[1]}>`
  if ("bare" in arity) return `${token} [${arity.name}] [${arity.variadic}...]`
  if ("variadic" in arity) return `${token} <${arity.name}> [${arity.variadic}...]`
  if ("optional" in arity) return `${token} [${arity.name}]`
  if ("many" in arity) return `${token} [${arity.name}...]`
  return `${token} <${arity.name}>`
}

const SPACE_FORM_FLAGS = new Set(["--var", "--threshold"])

const flagHeader = (row: FlagRow): string => {
  if (row.valueHint === "") return row.name
  if (row.arity === "optional") return `${row.name}[=${row.valueHint}]`
  return SPACE_FORM_FLAGS.has(row.name)
    ? `${row.name} ${row.valueHint}`
    : `${row.name}=${row.valueHint}`
}

const GLOBAL_OPTIONS: readonly (readonly [string, string])[] = [
  ["-v, --verbose", "Narrate on stderr what gtd resolved"],
  ["--live", "Run this gtd, not the process's pin; it may misread the process"],
  ["-h, --help", "Print help; gtd <command> --help for one command"],
  ["-V, --version", "Print the version"],
  ["--", "End the options: every word after it is an argument"],
]

const EXTRA_TOPICS: readonly (readonly [string, string, string])[] = [
  [
    "help [command]",
    "Print help for gtd or one command",
    "Print gtd's overview, or with <command> that command's own help.",
  ],
  [
    "version",
    "Print the version",
    "Print gtd's version, and the version of a pinned process's gtd.",
  ],
]

const EXAMPLES = `  $ gtd start                                   list what can start
  $ gtd start <name>                            start a process
  $ gtd next                                    see what happens next
  $ s=$(gtd land --json=script) && sh -c "$s"   land the turn
  $ gtd help land                               one command's details`

const lines = (block: readonly string[]): string => block.map((l) => `${l}\n`).join("")

const GROUPS: readonly Group[] = ["Core loop", "Start and stop", "Inspect", "Driver plumbing"]

export const renderHelp = (): string => {
  const groups = GROUPS.map((group) => {
    const rows = COMMAND_ROWS.filter((r) => r.group === group).flatMap((r) =>
      definition(synopsis(r), r.summary, TOP_COLUMN),
    )
    const extra =
      group === "Driver plumbing"
        ? EXTRA_TOPICS.flatMap(([term, summary]) => definition(term, summary, TOP_COLUMN))
        : []
    return `${group}:\n${lines([...rows, ...extra])}`
  })
  return (
    "Usage: gtd <command> [options]\n\n" +
    lines(
      wrap(
        "gtd reads a repository's git state and prints what should happen next in its workflow. It never acts on it: a driver, or you, runs what it prints.",
      ),
    ) +
    "\n" +
    groups.join("\n") +
    "\nOptions:\n" +
    lines(GLOBAL_OPTIONS.flatMap(([term, text]) => definition(term, text, TOP_COLUMN))) +
    `\nExamples:\n${EXAMPLES}\n\n` +
    lines(
      wrap(
        "Run `gtd help <command>` for a command's details and options, and `gtd guide` to learn how to drive gtd.",
      ),
    )
  )
}

/** Shown on stderr above a bare `gtd`'s usage error — the overview stays one `gtd help` away. */
const SHORT_USAGE = `Usage: gtd <command> [options]

  gtd start <name>        start a process
  gtd next                print what should happen next
  gtd land                record what the tree now shows

`

const renderCommandHelp = (row: CommandRow): string => {
  const options = FLAGS.filter((f) => f.name !== "--verbose" && f.scope(row.kind)).flatMap((f) =>
    definition(flagHeader(f), f.helpFor?.[row.kind] ?? f.help, OPTION_COLUMN),
  )
  const global = definition("-v, --verbose", "Narrate on stderr what gtd resolved", OPTION_COLUMN)
  return (
    `Usage: gtd ${synopsis(row)}${options.length > 0 ? " [options]" : ""}\n\n` +
    lines(wrap(row.details)) +
    `\nOptions:\n${lines([...options, ...global])}`
  )
}

/** `gtd help <topic…>`'s text: one command's help, every `history` subcommand's for `history`, or undefined for an unknown topic. */
const renderTopicHelp = (topic: readonly string[]): string | undefined => {
  const two = commandByToken(topic.slice(0, 2).join(" "))
  if (two !== undefined && topic.length >= 2) return renderCommandHelp(two)
  const [first = ""] = topic
  const one = commandByToken(first)
  if (one !== undefined) return renderCommandHelp(one)
  const extra = EXTRA_TOPICS.find(([term]) => term.split(" ")[0] === first)
  if (extra !== undefined) return `Usage: gtd ${extra[0]}\n\n${lines(wrap(extra[2]))}`
  const family = COMMAND_ROWS.filter((r) => r.token.startsWith(`${first} `))
  if (first !== "" && family.length > 0) return family.map(renderCommandHelp).join("\n")
  return undefined
}

/** A usage error's tail: the nearest candidate when `word` looks like a typo of one, and where the full list is. */
const didYouMean = (
  word: string,
  candidates: readonly string[],
  prefix = "",
  pointer = "`gtd help` for every command",
): string => {
  const guess = closest(word, candidates)
  return guess === undefined
    ? ` — run ${pointer}`
    : ` — did you mean \`${prefix}${guess}\`? Run ${pointer}`
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
  /** The positional right after a bare `--json` — most likely a path meant as `--json=<path>`. */
  readonly afterBareJson?: string
}

const unknownOption = (tok: string, jsonSeen: boolean): TokenizeError => {
  const candidates = tok.startsWith("--") ? FLAGS.map((f) => f.name) : []
  return {
    kind: "error",
    message: `gtd: unknown option '${tok}'${didYouMean(tok.split("=")[0]!, candidates, "", "`gtd help <command>` for its options")}`,
    jsonSeen,
  }
}

// fallow-ignore-next-line complexity
const tokenize = (tail: readonly string[]): TokenizeError | TokenizeOk => {
  const positionals: string[] = []
  const byFlag = new Map<string, string[]>()
  const present = new Set<string>()
  let jsonSeen = false
  let afterBareJson: string | undefined
  const end = tail.indexOf("--")

  for (let i = 0; i < tail.length; i++) {
    const original = tail[i]!
    if (i === end) continue
    const tok = SINGLE_DASH_ALIASES.get(original) ?? original
    if ((end !== -1 && i > end) || !tok.startsWith("-") || tok === "-") {
      if (tail[i - 1] === "--json") afterBareJson ??= original
      positionals.push(original)
      continue
    }
    const row = tok.startsWith("--") ? flagByToken(tok) : undefined
    if (row === undefined) return unknownOption(tok, jsonSeen)
    const eq = tok.indexOf("=")
    const alreadyPresent = present.has(row.name)
    present.add(row.name)
    if (row.name === "--json") jsonSeen = true

    if (row.arity === 0) {
      if (eq !== -1) return unknownOption(tok, jsonSeen)
      if (!byFlag.has(row.name)) byFlag.set(row.name, [])
      continue
    }

    if (row.arity === "optional") {
      if (!row.repeatable && alreadyPresent) {
        return { kind: "error", message: `gtd: ${row.name} may be given at most once`, jsonSeen }
      }
      if (eq !== -1) {
        const value = tok.slice(eq + 1)
        if (value === "") {
          // Unlike arity-1, an "optional" flag's bare/space form is a
          // deliberate, DIFFERENT meaning (presence with no value) — never a
          // rejected value-missing form — so this message names only the
          // one legal way to supply a value, `=`, not the arity-1 template's
          // "or <name> <value>" (which would recommend the very space form
          // the settled decisions make a usage error on purpose).
          return {
            kind: "error",
            message: `gtd: ${row.name} requires a value — use ${row.name}=${row.valueHint}`,
            jsonSeen,
          }
        }
        byFlag.set(row.name, [value])
        continue
      }
      // Bare presence — never consumes the following token, unlike arity 1.
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

  return {
    kind: "ok",
    positionals,
    byFlag,
    present,
    jsonSeen,
    ...(afterBareJson !== undefined ? { afterBareJson } : {}),
  }
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

const tooMany = (
  cmd: string,
  rest: readonly string[],
  expected: string,
  max: number,
): string | undefined =>
  rest.length > max
    ? `gtd ${cmd}: too many arguments — expected ${expected}, got: ${rest.join(", ")}`
    : undefined

const arityError = (cmd: string, rest: readonly string[], arity: Arity): string | undefined => {
  if (arity === "none") return tooMany(cmd, rest, "none", 0)
  if ("names" in arity) return pairArityError(cmd, rest, arity.names)
  if ("many" in arity || "bare" in arity) return undefined
  if ("optional" in arity) return tooMany(cmd, rest, `at most one ${arity.name}`, 1)
  if (rest.length === 0) return `gtd ${cmd}: missing ${arity.name} argument`
  return "variadic" in arity ? undefined : tooMany(cmd, rest, `one ${arity.name}`, 1)
}

const pairArityError = (
  cmd: string,
  rest: readonly string[],
  [first, second]: readonly [string, string],
): string | undefined => {
  if (rest.length === 0) return `gtd ${cmd}: missing ${first} and ${second} arguments`
  if (rest.length === 1) return `gtd ${cmd}: missing ${second} argument`
  if (rest.length > 2) {
    return `gtd ${cmd}: too many arguments — expected ${first} and ${second}, got: ${rest.join(", ")}`
  }
  return undefined
}

/** Decode every present flag into a bag of values, or the first decode error encountered. */
const decodeFlags = (
  byFlag: ReadonlyMap<string, readonly string[]>,
): Result.Result<Readonly<Record<string, unknown>>, string> => {
  const bag: Record<string, unknown> = {}
  for (const row of FLAGS) {
    const raws = byFlag.get(row.name)
    if (raws === undefined) continue
    // A bare `"optional"`-arity flag (e.g. `--json` with no `=`) has nothing
    // to decode — presence alone is tracked via `present`, not the bag.
    if (row.arity === "optional" && raws.length === 0) continue
    const decoded = row.decode(raws)
    if (Result.isFailure(decoded)) return Result.fail(decoded.failure)
    bag[row.name] = decoded.success
  }
  return Result.succeed(bag)
}

/** `gtd history judges`' thresholds: each a known judge threshold with a numeric value. */
const judgeThresholds = (
  thresholds: Readonly<Record<string, string>>,
): Result.Result<Readonly<Record<string, string>>, string> => {
  const unknown = Object.keys(thresholds).find((name) => !Object.hasOwn(THRESHOLDS, name))
  if (unknown !== undefined) {
    return Result.fail(
      `gtd history judges: --threshold ${unknown} is no judge threshold — use ${Object.keys(THRESHOLDS).join(" or ")}`,
    )
  }
  const nan = Object.entries(thresholds).find(
    ([, value]) => value.trim() === "" || !Number.isFinite(Number(value)),
  )
  if (nan !== undefined) {
    return Result.fail(
      `gtd history judges: --threshold ${nan[0]} must be a number — got "${nan[1]}"`,
    )
  }
  return Result.succeed(thresholds)
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

const HELP_FLAGS = new Set(["--help", "-h"])

/** The options part of argv: everything before a `--`, which ends the options. */
const optionsOf = (argv: readonly string[]): readonly string[] => {
  const end = argv.indexOf("--", 2)
  return end === -1 ? argv : argv.slice(0, end)
}

/** `--help`/`-h` anywhere before `--`: the named command's own help, else the overview — never a usage error, so a typo'd command still gets help. */
const helpPlan = (argv: readonly string[]): CliPlan => {
  const tokenized = tokenize(
    optionsOf(argv)
      .slice(2)
      .filter((tok) => !HELP_FLAGS.has(tok)),
  )
  const topic = tokenized.kind === "ok" ? tokenized.positionals : []
  return { kind: "output", stdout: renderTopicHelp(topic) ?? renderHelp() }
}

/** `gtd help [topic…]`: an unknown topic is a usage error naming the nearest command. */
const helpCommandPlan = (topic: readonly string[], json: boolean): CliPlan => {
  if (topic.length === 0) return { kind: "output", stdout: renderHelp() }
  const text = renderTopicHelp(topic)
  if (text !== undefined) return { kind: "output", stdout: text }
  return usagePlan(
    `gtd: help: no command '${topic.join(" ")}'${didYouMean(topic[0]!, COMMAND_WORDS, "gtd help ")}`,
    json,
  )
}

// fallow-ignore-next-line complexity
export const parseArgv = (argv: readonly string[]): CliPlan => {
  const options = optionsOf(argv)
  if (options.some((tok) => HELP_FLAGS.has(tok))) return helpPlan(argv)
  if (options.includes("--version") || options.includes("-V")) {
    return { kind: "output", stdout: `${GTD_VERSION}\n` }
  }

  const tokenized = tokenize(argv.slice(2))
  if (tokenized.kind === "error") return usagePlan(tokenized.message, tokenized.jsonSeen)
  const { positionals, byFlag, present, jsonSeen, afterBareJson } = tokenized

  const first = positionals[0]

  if (first === "version") return { kind: "output", stdout: `${GTD_VERSION}\n` }
  if (first === "help") return helpCommandPlan(positionals.slice(1), jsonSeen)

  const isHistory = first === "history"
  const row =
    first === undefined
      ? undefined
      : commandByToken(isHistory ? `history ${positionals[1] ?? ""}` : first)

  if (isHistory && row === undefined) {
    const subcommands = COMMAND_ROWS.filter((r) => r.token.startsWith("history ")).map(
      (r) => r.token.split(" ")[1]!,
    )
    const typo = closest(positionals[1] ?? "", subcommands)
    return usagePlan(
      typo !== undefined
        ? `gtd history: unknown subcommand '${positionals[1]}' — did you mean \`gtd history ${typo}\`?`
        : "gtd history: expected a subcommand — list, show <ref>, metrics [ref...], judges [ref...] or fetch [remote]",
      jsonSeen,
    )
  }

  // `gtd judge answer` — the CLI's one two-level verb. The NORMAL path is
  // "answer" arriving as `positionals[1]`, a second token after "judge" —
  // detected below via `judgeAnswer`, not through a second dispatchable
  // `COMMAND_ROWS` row: the `"judge answer"`-tokened row above exists for
  // its help. It CAN also be matched by
  // `commandByToken` directly, but only if a caller passes the single
  // (space-containing) argv token `"judge answer"` — an unusual shell quoting
  // choice, not the normal two-argv-token invocation `gtd judge answer` — and
  // `row.kind` is `"judgeAnswer"` either way, so nothing downstream branches
  // differently between the two paths. `row`'s own arity (still "none",
  // judge's own) applies to whatever follows "answer" below, so no bespoke
  // `Arity` variant is needed for this one verb.
  const judgeAnswer = row?.kind === "judge" && positionals[1] === "answer"

  const judgeRun = row?.kind === "judge" && positionals[1] === "run"

  if (row === undefined || first === undefined) {
    // No dispatchable row resolved (missing/unknown command) — a scoped flag
    // used here (e.g. a bare `gtd --var x=1`) is a more specific error than
    // "missing command"/"unknown command", so it takes priority.
    const violation = scopeViolation(undefined, present)
    if (violation !== undefined) return usagePlan(violation, jsonSeen)
    if (first === undefined) {
      return usagePlan(
        "gtd: missing command — run `gtd help` for every command, or `gtd guide` to learn how to drive gtd",
        jsonSeen,
        SHORT_USAGE,
      )
    }
    return usagePlan(
      `gtd: unknown command '${first}'${didYouMean(first, COMMAND_WORDS, "gtd ")}`,
      jsonSeen,
    )
  }

  const kind: Command["kind"] = judgeAnswer ? "judgeAnswer" : judgeRun ? "judgeRun" : row.kind

  // `judgeAnswer` consumes TWO leading positionals ("judge" and "answer"), everything else one.
  const restPositionals = positionals.slice(judgeAnswer || judgeRun || isHistory ? 2 : 1)

  const bare = kind === "check" && restPositionals.length === 0 && present.has("--open-threads")
  const arityMsg = bare
    ? undefined
    : arityError(isHistory ? row.token : first, restPositionals, row.arity)
  if (arityMsg !== undefined) {
    const hint =
      afterBareJson !== undefined && restPositionals.includes(afterBareJson)
        ? ` — to print one field, write --json=${afterBareJson}`
        : ""
    return usagePlan(arityMsg + hint, jsonSeen)
  }

  const violation = scopeViolation(kind, present)
  if (violation !== undefined) return usagePlan(violation, jsonSeen)

  const conflict = conflictViolation(present)
  if (conflict !== undefined) return usagePlan(conflict, jsonSeen)

  const decoded = decodeFlags(byFlag)
  if (Result.isFailure(decoded)) return usagePlan(decoded.failure, jsonSeen)
  const bag = decoded.success as {
    readonly "--json"?: string
    readonly "--port"?: number
    readonly "--cost"?: number
    readonly "--model"?: string
    readonly "--var"?: Readonly<Record<string, string>>
    readonly "--threshold"?: Readonly<Record<string, string>>
    readonly "--open-questions"?: boolean
    readonly "--open-threads"?: boolean
    readonly "--host"?: string
    readonly "--self-signed"?: boolean
    readonly "--dev"?: boolean
    readonly "--provider"?: "fixed" | "jev" | "llm"
    readonly "--answers"?: string
    readonly "--jsonl"?: boolean
  }

  // `present.has("--json")` alone can't distinguish bare `--json` (no value
  // decoded) from `--json=<path>` (a value in the bag) — see `decodeFlags`'s
  // optional-arity skip above.
  const json: JsonMode = !present.has("--json")
    ? { kind: "off" }
    : bag["--json"] !== undefined
      ? { kind: "select", path: bag["--json"] }
      : { kind: "document" }
  const verbose = present.has("--verbose")

  if (kind === "land") {
    if (bag["--model"] !== undefined && bag["--cost"] === undefined) {
      return usagePlan(
        "gtd: --model requires --cost — it tags the recorded cost with the model that ran",
        jsonSeen,
      )
    }
    return { kind: "command", command: buildLandCommand(bag), json, verbose }
  }

  if (kind === "start") {
    const [name, ...args] = restPositionals
    if (name === undefined && bag["--var"] !== undefined) {
      return usagePlan(
        "gtd start: --var needs a <name> — run `gtd start` to list the workflows and doors",
        jsonSeen,
      )
    }
    return {
      kind: "command",
      command: {
        kind: "start",
        ...(name !== undefined ? { name } : {}),
        args,
        vars: bag["--var"] ?? {},
      },
      json,
      verbose,
    }
  }

  if (kind === "ui") {
    return {
      kind: "command",
      command: {
        kind: "ui",
        ...(bag["--host"] !== undefined ? { host: bag["--host"] } : {}),
        ...(bag["--port"] !== undefined ? { port: bag["--port"] } : {}),
        selfSigned: bag["--self-signed"] ?? false,
        dev: bag["--dev"] ?? false,
      },
      json,
      verbose,
    }
  }

  if (kind === "check") {
    return {
      kind: "command",
      command: {
        kind: "check",
        ...(restPositionals[0] !== undefined ? { mode: restPositionals[0] } : {}),
        ...(restPositionals[1] !== undefined ? { file: restPositionals[1] } : {}),
        ...(bag["--open-questions"] !== undefined
          ? { openQuestions: bag["--open-questions"] }
          : {}),
        ...(bag["--open-threads"] !== undefined ? { openThreads: bag["--open-threads"] } : {}),
      },
      json,
      verbose,
    }
  }

  if (kind === "judgeRun") {
    const provider = bag["--provider"]
    if (provider !== "fixed" && bag["--answers"] !== undefined) {
      return usagePlan("gtd judge run: --answers is only valid with --provider fixed", jsonSeen)
    }
    if ((provider === "fixed" || provider === "jev") && bag["--model"] !== undefined) {
      return usagePlan(
        "gtd judge run: --model is only valid with --provider llm (or when it is auto-selected)",
        jsonSeen,
      )
    }
    return {
      kind: "command",
      command: {
        kind: "judgeRun",
        ...(provider !== undefined ? { provider } : {}),
        ...(bag["--answers"] !== undefined ? { answers: bag["--answers"] } : {}),
        ...(bag["--model"] !== undefined ? { model: bag["--model"] } : {}),
      },
      json,
      verbose,
    }
  }

  if (kind === "summary") {
    return {
      kind: "command",
      command: { kind: "summary" },
      json,
      verbose,
    }
  }

  if (kind === "historyShow") {
    return {
      kind: "command",
      command: { kind: "historyShow", ref: restPositionals[0]! },
      json,
      verbose,
    }
  }

  if (kind === "historyMetrics") {
    return {
      kind: "command",
      command: { kind: "historyMetrics", refs: restPositionals },
      json,
      verbose,
    }
  }

  if (kind === "historyJudges") {
    const thresholds = judgeThresholds(bag["--threshold"] ?? {})
    if (Result.isFailure(thresholds)) return usagePlan(thresholds.failure, jsonSeen)
    const vars = thresholds.success
    return {
      kind: "command",
      command: {
        kind: "historyJudges",
        refs: restPositionals,
        vars,
        jsonl: bag["--jsonl"] ?? false,
      },
      json,
      verbose,
    }
  }

  if (kind === "historyFetch") {
    return {
      kind: "command",
      command: { kind: "historyFetch", remote: restPositionals[0] ?? "origin" },
      json,
      verbose,
    }
  }

  if (kind === "strays") {
    const [range, ...globs] = restPositionals as [string, ...string[]]
    const at = range.indexOf("..")
    if (at < 0 || range.includes("...") || range.indexOf("..", at + 1) >= 0) {
      return usagePlan(
        `gtd strays: <range> must be <base>..<tip> (an empty side is HEAD) — got '${range}'`,
        jsonSeen,
      )
    }
    return {
      kind: "command",
      command: {
        kind: "strays",
        base: range.slice(0, at) || "HEAD",
        tip: range.slice(at + 2) || "HEAD",
        globs,
      },
      json,
      verbose,
    }
  }

  if (kind === "uncheck") {
    return {
      kind: "command",
      command: { kind: "uncheck", file: restPositionals[0]! },
      json,
      verbose,
    }
  }

  // Every other kind carries no extra fields.
  const command: Command = {
    kind: kind as
      | "lsp"
      | "abandon"
      | "restore"
      | "repin"
      | "next"
      | "validate"
      | "guide"
      | "bundle"
      | "base"
      | "judge"
      | "judgeAnswer"
      | "historyList",
  }
  return { kind: "command", command, json, verbose }
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

export interface CliIo extends Stdio {
  /**
   * Deferred thunk — a layer is built only for a resolved `Command`, never
   * for `--version`/`--help`/a usage error. `verbose` (`--verbose`/`-v`,
   * decoded by `parseArgv`) gates the `Narrator` this builds — a no-op
   * writer when `false`.
   */
  readonly layers: (verbose: boolean) => Layer.Layer<CommandRequirements>
  /** Test seam: the shipped registry is empty, so a garbled-value test cannot reach the failure path without injecting one. Drop it when the first real flag ships. */
  readonly flags?: readonly FlagDeclaration[]
}

// `nodeCliIo` hands this one sink to both `stderr` (errors) and `layers`'s
// `Narrator` (narration), so a real invocation's narration and its
// remediation interleave on the same fd exactly as written.
const stdio = nodeStdio()

export type LiveToolCommands = Layer.Layer<
  ToolCommands,
  never,
  Exclude<CommandRequirements, ToolCommands> | NodeServices.NodeServices
>

export const nodeCliIo = (tools: LiveToolCommands): CliIo => ({
  ...stdio,
  // A Layer is a lazy description, not a running service — building this
  // object touches no filesystem/git; only `Effect.provide` running the
  // result does. `runCli` calls this thunk exactly when `plan.kind ===
  // "command"`, so --version/--help/a usage error never provoke it.
  layers: (verbose) =>
    // Dependency order matters: Workspace.Live needs GitService, both need
    // Host, and GitService needs NodeServices' ChildProcessSpawner. Each
    // `provideMerge` satisfies the layers above it AND stays in the output.
    tools.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ConfigService.Live,
          ConfigDiscovery.Live,
          EngineCore.Live,
          Workspace.Live,
          Narrator.layer(stdio.stderr, verbose),
          CommandRunner.Live,
        ).pipe(
          Layer.provideMerge(GitService.Live),
          Layer.provideMerge(Host.Live),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
})

/**
 * Normalizes an artifact's trailing newlines to exactly one — an emitted
 * script ends with none, plain text already ends with one, so this is the
 * single place both become uniform. A byte-empty artifact stays byte-empty
 * (never becomes a lone `\n`); several trailing newlines collapse to one.
 */
export const normalizeTrailingNewline = (artifact: string): string =>
  artifact.length === 0 ? artifact : `${artifact.replace(/\n+$/, "")}\n`

// Bytes are a binary artifact, written as they are.
const bufferedArtifactOut = (io: CliIo): ArtifactOut => {
  let buffer: string | Uint8Array = ""
  return {
    write: (chunk) => {
      buffer =
        typeof buffer === "string" && typeof chunk === "string"
          ? buffer + chunk
          : Buffer.concat([Buffer.from(buffer), Buffer.from(chunk)])
    },
    flush: () => {
      if (buffer.length > 0) {
        io.stdout(typeof buffer === "string" ? normalizeTrailingNewline(buffer) : buffer)
      }
      buffer = ""
    },
  }
}

/**
 * The single envelope writer: `{state:"error",prompt}` on **stderr** under
 * `--json`, `renderFailure` on stderr always, exit `EXIT_RUNTIME_ERROR`.
 * stdout is never touched here — the command's `ArtifactOut` buffer was never
 * flushed, so a `--json` driver reading stdout on a failed run reads nothing
 * — it must read stderr or the exit code instead. `Effect.sandbox` means this also
 * fires for a DEFECT, not just a typed error. Unreached by an ordinary usage
 * error (an unknown flag, bad arity, a scope violation) — those never build a
 * layer at all. Two exceptions map to `EXIT_USAGE_ERROR` instead, below:
 * `SelectorUsageError` (an unknown `--json=<path>` selector can only be
 * judged after the layer is built and the fields object it's reduced
 * against is fully resolved, so it fails HERE rather than in `parseArgv`)
 * and `GtdUsageError` (`gtd ui` refusing to start on a step it cannot
 * render — see `Commentary.ts`).
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
      io.exit(
        error instanceof SelectorUsageError || error instanceof GtdUsageError
          ? EXIT_USAGE_ERROR
          : EXIT_RUNTIME_ERROR,
      )
    })

export const runCli = (argv: readonly string[], io: CliIo): Effect.Effect<void, Error> => {
  const plan = parseArgv(argv)

  if (plan.kind === "output") {
    return Effect.sync(() => io.stdout(plan.stdout))
  }

  if (plan.kind === "usage") {
    return Effect.sync(() => {
      // The short usage (missing-command only) and the `--json`
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
  return Effect.flatMap(Host, ({ env }) =>
    Effect.try({
      try: () => resolveFlags(env, io.flags),
      catch: (e) => new GtdError((e as Error).message),
    }),
  ).pipe(
    Effect.flatMap((flags) =>
      runCommand(plan.command, plan.json, out).pipe(
        Effect.provideService(StartFlags, flagSettings(flags)),
      ),
    ),
    // `flush()` fires here, on success, BEFORE `io.exit` — the one point
    // where the whole buffered artifact is known-complete and safe to hand
    // to stdout (a failure discards the buffer instead — see
    // `bufferedArtifactOut`).
    Effect.map((code) => {
      out.flush()
      io.exit(code)
    }),
    Effect.provide(io.layers(plan.verbose)),
    Effect.sandbox,
    // `sandbox` moves EVERY failure mode — a typed error, a defect, an
    // interruption — into this handler's `cause`. An interrupt-only cause
    // (Ctrl-C on `ui`/`lsp`'s blocking `Effect.never`) is passed
    // through untouched via `failCause` so `NodeRuntime.runMain` still sees a
    // real interruption; everything else gets the envelope.
    Effect.catch((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : report(io, plan.json.kind !== "off")(cause),
    ),
  )
}
