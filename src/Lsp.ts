import { basename, dirname, resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect, Layer, ManagedRuntime } from "effect"
import { NodeContext } from "@effect/platform-node"
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  CodeActionKind,
  DiagnosticSeverity,
  SymbolKind,
  type CodeAction,
  type Connection,
  type Diagnostic,
  type DocumentSymbol,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type Position,
  type Range,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { Narrator } from "./Commentary.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
import { RepoFiles } from "./RepoFiles.js"
import { currentRest, type RestRequirements } from "./Edge.js"
import type { StateMode, WorkflowDefinition } from "./PatternMachine.js"
import { renderStateTemplate, varsOnlyContext } from "./PatternTemplates.js"
import {
  resolveBuiltInMode,
  resolveSteeringMode,
  steeringCapabilities,
  type ResolvedMode,
} from "./SteeringMode.js"
import type {
  SteeringAction,
  SteeringFinding,
  SteeringOutlineNode,
  SteeringPointer,
} from "./SteeringFormat.js"

// ── Domain → protocol translation (pure) ────────────────────────────────────

const spanRange = (lines: readonly string[], startLine: number, endLine: number) => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: (lines[endLine] ?? "").length },
})

/** A `SteeringOutlineNode` tree → `DocumentSymbol` tree: `leaf: true` maps to `SymbolKind.Boolean`, a container to `SymbolKind.Package` — an outline icon distinction only, no protocol contract. */
export const toDocumentSymbol = (node: SteeringOutlineNode): DocumentSymbol => ({
  name: node.name,
  ...(node.detail !== undefined ? { detail: node.detail } : {}),
  kind: node.leaf === true ? SymbolKind.Boolean : SymbolKind.Package,
  range: node.range,
  selectionRange: node.selectionRange,
  ...(node.children !== undefined ? { children: node.children.map(toDocumentSymbol) } : {}),
})

export const toCodeAction =
  (uri: string) =>
  (action: SteeringAction): CodeAction => ({
    title: action.title,
    kind: CodeActionKind.QuickFix,
    edit: { changes: { [uri]: [...action.edits] } },
  })

/**
 * A `SteeringPointer` → a `Location` — a collapsed range (a cursor, not a
 * selection). An absent `pointer.path` means "this same document": the
 * `Location` uses `documentUri` untouched, and `root` (needed only to
 * resolve a foreign `path` against the git working tree) goes unused. An
 * absent `pointer.character` lands at column 0.
 */
export const toLocation =
  (root: string, documentUri: string) =>
  (pointer: SteeringPointer): Location => ({
    uri:
      pointer.path === undefined
        ? documentUri
        : pathToFileURL(resolvePath(root, pointer.path)).toString(),
    range: {
      start: { line: pointer.line, character: pointer.character ?? 0 },
      end: { line: pointer.line, character: pointer.character ?? 0 },
    },
  })

/** One `SteeringFinding` → a `Diagnostic`: a positioned finding underlines exactly its own line, a positionless one spans the whole document. Not exported on its own — `diagnosticsFor`'s tests cover it in context. */
const toDiagnostic =
  (lines: readonly string[]) =>
  (finding: SteeringFinding): Diagnostic => ({
    range:
      finding.line !== undefined
        ? spanRange(lines, finding.line, finding.line)
        : spanRange(lines, 0, Math.max(0, lines.length - 1)),
    message: finding.message,
    severity: DiagnosticSeverity.Warning,
    source: "gtd",
  })

/** The one `Information` diagnostic a shell-`validate:`d mode gets instead of live findings. */
export const externalValidatorNotice = (mode: StateMode, command: string): Diagnostic => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  message: `mode "${mode}" is validated by a shell command (\`${command}\`) — run \`gtd validate\`; no live diagnostics`,
  severity: DiagnosticSeverity.Information,
  source: "gtd",
})

/** Diagnostics for one document, given its resolved mode (or `undefined` — an unmapped path): a live built-in `validate` when one applies, the external-validator notice when a command displaced it, or none. */
export const diagnosticsFor = (
  resolved: ResolvedMode | undefined,
  content: string,
): Diagnostic[] => {
  const caps = steeringCapabilities(resolved)
  if (caps.liveValidate !== undefined) {
    const lines = content.split(/\r?\n/)
    return caps.liveValidate(content).map(toDiagnostic(lines))
  }
  if (caps.externalValidate === true && resolved?.validate?.kind === "command") {
    return [externalValidatorNotice(resolved.mode, resolved.validate.command)]
  }
  return []
}

// ── Config-driven path→mode dispatch (pure) ─────────────────────────────────

/** Fallback for any path the workflow's `file:` map doesn't cover. `TODO.md` is intentionally not mapped — the bundled `idle` state declares no `mode:` for it. */
export const basenameFallbackMode = (name: string): ResolvedMode | undefined =>
  name === "REVIEW.md" ? resolveBuiltInMode("review") : undefined

/** One `buildSteeringMap` finding: a state whose `file:` failed to render, a `mode:` that didn't resolve, or a path two states both declare (first wins). */
export type FileModeWarning = string

/**
 * Render every state's declared `file:`/`mode:` pair into an absolute-path →
 * `ResolvedMode` map. A state whose `file:` fails to render or whose `mode:`
 * doesn't resolve is skipped with a warning, not fatal; a path two states
 * both declare keeps the first declaring state's mode, also warning.
 */
export const buildSteeringMap = (
  def: WorkflowDefinition,
  vars: Record<string, string>,
  root: string,
): {
  readonly map: ReadonlyMap<string, ResolvedMode>
  readonly warnings: readonly FileModeWarning[]
} => {
  const map = new Map<string, ResolvedMode>()
  const warnings: FileModeWarning[] = []
  for (const [name, stateDef] of Object.entries(def.states)) {
    if (stateDef.file === undefined || stateDef.mode === undefined) continue
    let rendered: string
    try {
      rendered = renderStateTemplate(stateDef.file, varsOnlyContext(vars, name))
    } catch (e) {
      warnings.push(
        `state "${name}": "file:" failed to render, skipped — ${e instanceof Error ? e.message : String(e)}`,
      )
      continue
    }
    const absolute = resolvePath(root, rendered)
    const existing = map.get(absolute)
    if (existing !== undefined) {
      warnings.push(
        `"${absolute}" is already mapped to mode "${existing.mode}" by an earlier state; state "${name}"'s mode ("${stateDef.mode}") is ignored`,
      )
      continue
    }
    const resolved = resolveSteeringMode(def, stateDef.mode)
    if (resolved === undefined) {
      warnings.push(`state "${name}": mode "${stateDef.mode}" does not resolve, skipped`)
      continue
    }
    map.set(absolute, resolved)
  }
  return { map, warnings }
}

export const resolvedModeForDocument = (
  uri: string,
  steeringMap: ReadonlyMap<string, ResolvedMode>,
): ResolvedMode | undefined =>
  steeringMap.get(fileURLToPath(uri)) ?? basenameFallbackMode(basename(fileURLToPath(uri)))

export const capabilitiesForDocument = (
  uri: string,
  steeringMap: ReadonlyMap<string, ResolvedMode>,
) => steeringCapabilities(resolvedModeForDocument(uri, steeringMap))

export const resolveWorkspaceRoot = (params: {
  readonly workspaceFolders?: ReadonlyArray<{ readonly uri: string }> | null
  readonly rootUri?: string | null
}): string | undefined => {
  const uri = params.workspaceFolders?.[0]?.uri ?? params.rootUri ?? undefined
  return uri === undefined || uri === null ? undefined : fileURLToPath(uri)
}

// ── `gtd.openSteeringFile` (pure resolution outcome) ────────────────────────

const OPEN_STEERING_FILE_COMMAND = "gtd.openSteeringFile"

/** What `gtd.openSteeringFile` does once the current state/file is resolved — pure, so the decision (show vs. inform) is unit-testable without a protocol connection. */
export type SteeringFileOutcome =
  | { readonly kind: "show"; readonly uri: string }
  | { readonly kind: "inform"; readonly state: string }

/** `file`, when present, is REPO-ROOT-RELATIVE (a rendered `file:` template) — resolved against `root` into an absolute `file://` URI to show. */
export const steeringFileOutcome = (
  state: string,
  file: string | undefined,
  root: string,
): SteeringFileOutcome =>
  file === undefined
    ? { kind: "inform", state }
    : { kind: "show", uri: pathToFileURL(resolvePath(root, file)).toString() }

// ── The `startLspServer` seam ────────────────────────────────────────────────

/**
 * Everything protocol-independent `SteeringLanguageService` needs from its
 * environment, so the service is testable against a fake. Its methods may
 * reject (bad config, no git repo, unresolvable process state); the service
 * catches every rejection and degrades gracefully, so an `LspEnv`
 * implementation needn't defend against its own failures.
 */
export interface LspEnv {
  /** The active workflow's `file:`/`mode:` map for `root` — reloaded fresh, no cache. */
  readonly steeringMapFor: (root: string) => Promise<ReadonlyMap<string, ResolvedMode>>
  /** The git working-tree root of `dir`, or `undefined` outside any repository. */
  readonly gitTopLevel: (dir: string) => Promise<string | undefined>
  /** The current process state/actor and its rendered `file:`, scoped to `root`. */
  readonly currentSteeringFile: (
    root: string,
  ) => Promise<{ readonly state: string; readonly file: string | undefined }>
  /** The process's own cwd — the `gtd.openSteeringFile` root when no workspace folder was ever given. */
  readonly cwd: string
}

/** What `gtd.openSteeringFile` (or any future command) does, in a form `bindSteeringServer` can act on without the service itself ever touching `connection.window`. */
export type ExecuteCommandOutcome =
  | { readonly kind: "show"; readonly uri: string }
  | { readonly kind: "inform"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unknown" }

/** The whole LSP surface, protocol-independent: every method takes plain values (a URI, text, a position) and returns plain data — no `vscode-languageserver` type in sight beyond the return shapes it happens to reuse structurally. */
export interface SteeringLanguageService {
  readonly initialize: (params: InitializeParams) => InitializeResult
  readonly documentSymbol: (uri: string, text: string) => Promise<DocumentSymbol[]>
  readonly codeAction: (uri: string, text: string, range: Range) => Promise<CodeAction[]>
  readonly definition: (uri: string, text: string, position: Position) => Promise<Location[]>
  readonly diagnostics: (uri: string, text: string) => Promise<Diagnostic[]>
  readonly executeCommand: (
    command: string,
    args: ReadonlyArray<unknown> | undefined,
  ) => Promise<ExecuteCommandOutcome>
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Builds the whole `SteeringLanguageService` over `env`. Every `env` call is
 * wrapped in a try/catch that warns and degrades gracefully — an unmapped or
 * failed lookup behaves like "no config resolved" (empty results), never a
 * rejected request.
 */
export const makeSteeringLanguageService = (
  env: LspEnv,
  warn: (message: string) => void,
): SteeringLanguageService => {
  let workspaceRoot: string | undefined

  const rootFor = (uri: string): string => workspaceRoot ?? dirname(fileURLToPath(uri))

  const safeSteeringMap = async (root: string): Promise<ReadonlyMap<string, ResolvedMode>> => {
    try {
      return await env.steeringMapFor(root)
    } catch (e) {
      warn(
        `failed to load gtd config at "${root}" — falling back to basename dispatch: ${errorText(e)}`,
      )
      return new Map()
    }
  }

  const safeGitTopLevel = async (dir: string): Promise<string | undefined> => {
    try {
      return await env.gitTopLevel(dir)
    } catch {
      return undefined
    }
  }

  const capabilitiesFor = async (uri: string) =>
    capabilitiesForDocument(uri, await safeSteeringMap(rootFor(uri)))

  return {
    initialize: (params) => {
      workspaceRoot = resolveWorkspaceRoot(params)
      return {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Incremental,
          documentSymbolProvider: true,
          codeActionProvider: true,
          definitionProvider: true,
          executeCommandProvider: { commands: [OPEN_STEERING_FILE_COMMAND] },
        },
      }
    },

    documentSymbol: async (uri, text) => {
      const caps = await capabilitiesFor(uri)
      return caps.format?.outline(text).map(toDocumentSymbol) ?? []
    },

    codeAction: async (uri, text, range) => {
      const caps = await capabilitiesFor(uri)
      return (caps.format?.actions(text, range) ?? []).map(toCodeAction(uri))
    },

    definition: async (uri, text, position) => {
      const caps = await capabilitiesFor(uri)
      const pointer = caps.format?.pointerAt?.(text, position)
      if (pointer === undefined) return []
      if (pointer.path === undefined) return [toLocation("", uri)(pointer)]
      const root = (await safeGitTopLevel(dirname(fileURLToPath(uri)))) ?? workspaceRoot
      return root === undefined ? [] : [toLocation(root, uri)(pointer)]
    },

    diagnostics: async (uri, text) => {
      const map = await safeSteeringMap(rootFor(uri))
      return diagnosticsFor(resolvedModeForDocument(uri, map), text)
    },

    executeCommand: async (command) => {
      if (command !== OPEN_STEERING_FILE_COMMAND) return { kind: "unknown" }
      const root = workspaceRoot ?? env.cwd
      try {
        const { state, file } = await env.currentSteeringFile(root)
        const outcome = steeringFileOutcome(state, file, root)
        return outcome.kind === "inform"
          ? {
              kind: "inform",
              message: `gtd: state "${outcome.state}" has no associated steering file.`,
            }
          : { kind: "show", uri: outcome.uri }
      } catch (e) {
        return { kind: "error", message: `gtd.openSteeringFile: ${errorText(e)}` }
      }
    },
  }
}

/** The subset of `vscode-languageserver`'s `Connection` `bindSteeringServer` needs — typed against the real interface (not hand-rolled) so a dependency bump breaks the build rather than drifting silently. */
export type SteeringConnection = Pick<
  Connection,
  | "onInitialize"
  | "onDocumentSymbol"
  | "onCodeAction"
  | "onDefinition"
  | "onExecuteCommand"
  | "sendDiagnostics"
  | "console"
  | "window"
  | "listen"
  | "onExit"
  // `TextDocuments.listen(connection)` requires these raw notification
  // registrations too (see `vscode-languageserver`'s `TextDocumentConnection`).
  | "onDidOpenTextDocument"
  | "onDidChangeTextDocument"
  | "onDidCloseTextDocument"
  | "onWillSaveTextDocument"
  | "onWillSaveTextDocumentWaitUntil"
  | "onDidSaveTextDocument"
>

export type SteeringDocuments = Pick<
  TextDocuments<TextDocument>,
  "get" | "onDidOpen" | "onDidChangeContent" | "listen"
>

/** Wires a `SteeringLanguageService` onto a `Connection`/`TextDocuments` pair: every `connection.window.*` call implied by the pure `ExecuteCommandOutcome` lives here, never in the service itself. */
export const bindSteeringServer = (
  connection: SteeringConnection,
  documents: SteeringDocuments,
  service: SteeringLanguageService,
): void => {
  connection.onInitialize((params) => service.initialize(params))

  connection.onDocumentSymbol(async (params) => {
    const document = documents.get(params.textDocument.uri)
    return document ? service.documentSymbol(document.uri, document.getText()) : []
  })

  connection.onCodeAction(async (params) => {
    const document = documents.get(params.textDocument.uri)
    return document ? service.codeAction(document.uri, document.getText(), params.range) : []
  })

  connection.onDefinition(async (params) => {
    const document = documents.get(params.textDocument.uri)
    return document ? service.definition(document.uri, document.getText(), params.position) : []
  })

  connection.onExecuteCommand(async (params) => {
    const outcome = await service.executeCommand(params.command, params.arguments)
    if (outcome.kind === "show") {
      await connection.window.showDocument({ uri: outcome.uri })
    } else if (outcome.kind === "inform") {
      connection.window.showInformationMessage(outcome.message)
    } else if (outcome.kind === "error") {
      connection.window.showErrorMessage(outcome.message)
    }
    return null
  })

  const publishDiagnostics = async (uri: string, content: string): Promise<void> => {
    connection.sendDiagnostics({ uri, diagnostics: await service.diagnostics(uri, content) })
  }

  documents.onDidOpen((change) => {
    void publishDiagnostics(change.document.uri, change.document.getText())
  })
  documents.onDidChangeContent((change) => {
    void publishDiagnostics(change.document.uri, change.document.getText())
  })

  documents.listen(connection)
  connection.listen()
}

// ── The Node adapter: the only place layers are built ───────────────────────

/** `ConfigService.Live` scoped to `root` — the same config-loading code path the CLI uses (`src/Config.ts`), never a second one. */
const configLayerForRoot = (root: string) => ConfigService.Live.pipe(Layer.provide(Cwd.layer(root)))

/** `GitService.Live` scoped to `root`, with the Node command executor it needs to shell out to `git`. */
const gitLayerForRoot = (root: string) =>
  GitService.Live.pipe(Layer.provide(Layer.merge(Cwd.layer(root), NodeContext.layer)))

const repoFilesLayerForRoot = (root: string) =>
  RepoFiles.Live.pipe(Layer.provide(Layer.merge(Cwd.layer(root), gitLayerForRoot(root))))

// Mirrors the `GTD_<NAME>` env-override half of `Edge.ts`'s `resolveVars` —
// this call site has no resolved process, so there's no `entryVars` layer to merge.
const GTD_ENV_PREFIX = "GTD_"
export const mergeStaticVars = (
  workflowVars: Record<string, string>,
  rcVars: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const merged = { ...workflowVars, ...rcVars }
  for (const name of Object.keys(merged)) {
    const value = env[GTD_ENV_PREFIX + name.toUpperCase()]
    if (value !== undefined) merged[name] = value
  }
  return merged
}

/** The layers `LspEnv`'s Effects run against. `Narrator` is a permanent no-op — the LSP talks stdio JSON-RPC, with nothing to narrate onto — provided only so the shared `Narrator` requirement typechecks. */
const layersForRoot = (root: string) =>
  Layer.mergeAll(
    gitLayerForRoot(root),
    configLayerForRoot(root),
    repoFilesLayerForRoot(root),
    EnvVars.Live,
    Narrator.layer(() => {}, false),
  )

type RootRuntime = ManagedRuntime.ManagedRuntime<
  GitService | ConfigService | RepoFiles | EnvVars | Narrator,
  never
>

/**
 * One `ManagedRuntime` per root, memoised — caches the runtime (the
 * constructed service layer), not the config: each `LspEnv` method still
 * calls `ConfigService.load` itself, so an edited `.gtdrc` takes effect on
 * the next request; only the expensive layer construction is avoided.
 */
const runtimeCache = new Map<string, RootRuntime>()

const runtimeFor = (root: string): RootRuntime => {
  const cached = runtimeCache.get(root)
  if (cached !== undefined) return cached
  const runtime = ManagedRuntime.make(layersForRoot(root))
  runtimeCache.set(root, runtime)
  return runtime
}

/** The current state/actor and its rendered `file:` (`undefined` when the state declares none), exactly like the CLI's `currentRest`. Carries its requirements rather than providing them — the caller runs it through the memoised `runtimeFor(root)`. */
export const resolveSteeringFile: Effect.Effect<
  { readonly state: string; readonly file: string | undefined },
  Error,
  RestRequirements
> = currentRest.pipe(Effect.map((rest) => ({ state: rest.state, file: rest.hints.file })))

/** The Node adapter: the only place `LspEnv`'s Effects/layers get built and run. `startLspServer` is its production caller; most `Lsp.test.ts` coverage exercises a fake `LspEnv` instead, but this is exported so the real wiring (real git/config/repo-files layers) gets exercised against a real temp repo too. */
export const makeNodeLspEnv = (warn: (message: string) => void): LspEnv => ({
  cwd: process.cwd(),

  steeringMapFor: async (root) => {
    const config = await runtimeFor(root).runPromise(Effect.flatMap(ConfigService, (c) => c.load))
    const vars = mergeStaticVars(config.workflowVars, config.rcVars, process.env)
    const { map, warnings } = buildSteeringMap(config.workflow, vars, root)
    for (const warning of warnings) warn(warning)
    return map
  },

  gitTopLevel: (dir) =>
    runtimeFor(dir).runPromise(Effect.flatMap(GitService, (git) => git.topLevel())),

  currentSteeringFile: (root) => runtimeFor(root).runPromise(resolveSteeringFile),
})

/**
 * Starts the `gtd lsp` server over stdio. The returned Effect resolves when
 * the client disconnects (`exit` notification), so the process exits cleanly
 * rather than blocking forever.
 */
export const startLspServer = (): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
    const documents = new TextDocuments(TextDocument)
    const warn = (message: string): void => connection.console.warn(`gtd lsp: ${message}`)
    const service = makeSteeringLanguageService(makeNodeLspEnv(warn), warn)

    bindSteeringServer(connection, documents, service)

    yield* Effect.async<void>((resume) => {
      connection.onExit(() => resume(Effect.void))
    })
  })
