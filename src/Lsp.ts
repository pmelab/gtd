/**
 * LSP server for `.gtd/` steering files — document symbols, code actions, and
 * go-to-definition over each mapped file's steering FORMAT (see
 * `src/SteeringFormat.ts` / `src/SteeringFormats.ts`), and diagnostics
 * publishing a built-in format's own `validate` findings live — the same
 * findings the `gtd validate` CLI command reports (see `src/OpenQuestions.ts`
 * / `src/ReviewDoc.ts`'s module docs — those formats are each their own
 * single source of truth, shared by this server and the command).
 *
 * GO-TO-DEFINITION (`textDocument/definition`): a format's `pointerAt` (only
 * `review` declares one) resolves the cursor's line to a `{path, line}`
 * pointer, and this module resolves that `./`-relative path against the git
 * toplevel of the file's own directory (`tryGitTopLevel`), falling back to the
 * workspace root — never the document's own `.gtd/` directory — so a
 * repo-root-relative diff path lands correctly even with no workspace folder
 * open; no target is returned when neither anchor resolves. The target file is
 * not stat-ed, so a stale pointer still jumps and the editor reports the miss.
 *
 * CONFIG-DRIVEN: the server
 * locates the active gtd config the SAME way the CLI does (`ConfigService`'s
 * cosmiconfig search — no second config code path), from the `initialize`
 * request's `workspaceFolders`/`rootUri`, falling back to the open document's
 * own directory (`ConfigService`'s own cwd→home walk-up takes it from there).
 * It renders every state's declared `file:` (the vars/env layers of
 * `it.vars` — see `resolveVars`) into an absolute-path → `ResolvedMode` map
 * (`buildSteeringMap`, resolving each state's `mode:` through
 * `src/SteeringMode.ts`'s `resolveSteeringMode`), and dispatches document
 * symbols/code actions/diagnostics on THAT map — first declaring state wins a
 * path conflict, logged as a warning. Config is (re)loaded lazily, fresh per
 * request (no watcher, no cache — v1). A path this map doesn't cover (or no
 * config at all) falls back to today's basename dispatch (`REVIEW.md` →
 * `review`, via `resolveBuiltInMode`), so the server still works standalone
 * with no `.gtdrc` in sight. (`.gtd/TODO.md` is NOT dispatched by basename —
 * the bundled template's simple flow iterates on a free-form plan there, not a
 * `qa`-format file; a custom workflow that wants qa validation on TODO.md
 * declares it with `file:`+`mode: qa`, which the config-driven map covers.)
 *
 * A mode's `validate:` command displacing a built-in format's own parser (a
 * `modes: { qa: { validate: "…" } }` override) still gets outline + actions —
 * `steeringCapabilities(resolved).format` is set from the registry alone,
 * independent of `validate.kind` — but its built-in findings are suppressed:
 * this server never runs a shell command per keystroke over an unsaved
 * buffer. Instead it publishes ONE `Information` diagnostic at line 0 naming
 * the command and pointing at `gtd validate` (`externalValidatorNotice`). A
 * mode with no built-in format at all (a workflow-only name, or a declared
 * `{}` entry) dispatches to no symbols, no actions, and no diagnostics. Either
 * way the file is still formatted and validated by `gtd validate` and the
 * `gtd step` capture gate — just not live in the editor.
 *
 * `gtd.openSteeringFile` (an `executeCommand`) resolves the CURRENT state
 * exactly like the CLI (`resolveRest`/`computeProcessRun`/
 * `buildTemplateContext` — the same `src/Edge.ts` helpers `gtd status`/`gtd
 * next` use, re-adding the git/config wiring the v2 server had), renders its
 * `file:`, and asks the client to show it (`window/showDocument`); a state
 * with no `file:` gets an informational message naming the state instead.
 *
 * Split like the rest of the codebase: pure helpers below (the path→
 * `ResolvedMode` map, the domain→protocol translation, the command's
 * resolution outcome — unit-testable, no protocol/IO), the
 * `vscode-languageserver` wiring at the bottom (the IO edge, including the
 * git/config Effect layers `loadSteeringMap`/`resolveSteeringFile` run
 * against).
 */

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
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
import { RepoFiles } from "./RepoFiles.js"
import { currentRest } from "./Edge.js"
import type { StateMode, WorkflowDefinition } from "./PatternMachine.js"
import { renderStateTemplate, varsOnlyContext } from "./PatternTemplates.js"
import {
  resolveBuiltInMode,
  resolveSteeringMode,
  steeringCapabilities,
  type ResolvedMode,
} from "./SteeringMode.js"
import type { SteeringAction, SteeringOutlineNode, SteeringPointer } from "./SteeringFormat.js"

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

/** A `SteeringAction` → a `CodeAction` scoped to `uri`, one `QuickFix` per action. */
export const toCodeAction =
  (uri: string) =>
  (action: SteeringAction): CodeAction => ({
    title: action.title,
    kind: CodeActionKind.QuickFix,
    edit: { changes: { [uri]: [...action.edits] } },
  })

/** A `SteeringPointer` → a `Location` resolved against `root` — a collapsed range (a cursor, not a selection), the target file never stat-ed. */
export const toLocation =
  (root: string) =>
  (pointer: SteeringPointer): Location => ({
    uri: pathToFileURL(resolvePath(root, pointer.path)).toString(),
    range: {
      start: { line: pointer.line, character: 0 },
      end: { line: pointer.line, character: 0 },
    },
  })

/** One bare finding string → a whole-document `Diagnostic` (a built-in format's `validate` errors carry no per-line position). Not exported on its own — `diagnosticsFor`'s tests cover it in context. */
const toDiagnostic =
  (lines: readonly string[]) =>
  (message: string): Diagnostic => ({
    range: spanRange(lines, 0, Math.max(0, lines.length - 1)),
    message,
    severity: DiagnosticSeverity.Warning,
    source: "gtd",
  })

/** The one `Information` diagnostic a shell-`validate:`d mode gets instead of live findings — see the module docstring. */
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

/** The basename dispatch this server has always had — the fallback for any path the active workflow's `file:` map doesn't cover (or when no config resolves at all). `TODO.md` is intentionally NOT mapped: the bundled template's simple flow now iterates on a free-form plan there, not a `qa`-format file. */
export const basenameFallbackMode = (name: string): ResolvedMode | undefined =>
  name === "REVIEW.md" ? resolveBuiltInMode("review") : undefined

/** One `buildSteeringMap` finding: a state whose `file:` failed to render, a `mode:` that didn't resolve, or a path two states both declare (first wins). */
export type FileModeWarning = string

/**
 * Render every state's declared `file:`/`mode:` pair into an absolute-path →
 * `ResolvedMode` map, for a workflow already compiled against `root` (the
 * workspace root, or the open document's directory when no workspace root is
 * known — see `resolveWorkspaceRoot`). `vars` is the already-merged
 * three-layer `it.vars` (`resolveVars`) — the map-building context otherwise
 * carries empty-string commit-ish fields and a `read` that throws (no working
 * tree to read from at map-build time; the JUMP command —
 * `resolveSteeringFile` below — uses the FULL edge context instead). A state
 * whose `file:` fails to render, or whose `mode:` doesn't resolve
 * (`resolveSteeringMode`), is skipped with a warning, not fatal; a path two
 * states both declare keeps the FIRST declaring state's mode, also warning
 * (`Object.entries` preserves the workflow's own declaration order). Pure —
 * no git, no protocol, unit-testable directly.
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

/** The resolved mode a document's URI dispatches to: the config-driven map first, the basename fallback otherwise. */
export const resolvedModeForDocument = (
  uri: string,
  steeringMap: ReadonlyMap<string, ResolvedMode>,
): ResolvedMode | undefined =>
  steeringMap.get(fileURLToPath(uri)) ?? basenameFallbackMode(basename(fileURLToPath(uri)))

/** The capabilities (`format`/`liveValidate`/`externalValidate`) a document's URI dispatches to — `resolvedModeForDocument` fed through `steeringCapabilities`. */
export const capabilitiesForDocument = (
  uri: string,
  steeringMap: ReadonlyMap<string, ResolvedMode>,
) => steeringCapabilities(resolvedModeForDocument(uri, steeringMap))

/**
 * The workspace root to discover config from: the `initialize` request's
 * first `workspaceFolders` entry, falling back to the deprecated `rootUri`,
 * or `undefined` when neither is present (the caller then falls back to the
 * open document's own directory — `ConfigService`'s cwd→home walk-up takes
 * it from there, so no special-casing is needed beyond picking the starting
 * directory).
 */
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
 * environment, so the service is testable against a fake — no real IO, no
 * `vscode-languageserver` connection. `steeringMapFor`/`gitTopLevel`/
 * `currentSteeringFile` may REJECT (a bad `.gtdrc`, no git repo, an unresolvable
 * process state); the service catches every rejection itself and degrades
 * gracefully (see `makeSteeringLanguageService`), so an `LspEnv` implementation
 * needn't defend against its own failures.
 */
export interface LspEnv {
  /** The active workflow's `file:`/`mode:` map for `root` (see `buildSteeringMap`) — config (re)loaded fresh, no cache (v1 freshness). */
  readonly steeringMapFor: (root: string) => Promise<ReadonlyMap<string, ResolvedMode>>
  /** The git working-tree root of `dir`, or `undefined` when `dir` is outside any repository — the anchor a `review`-mode hunk's `./`-relative path resolves against. */
  readonly gitTopLevel: (dir: string) => Promise<string | undefined>
  /** The CURRENT process state/actor and its rendered `file:`, exactly like the CLI (`gtd status`/`gtd next`), scoped to `root`. */
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
 * Builds the whole `SteeringLanguageService` over `env` — CONFIG-DRIVEN (see
 * the module docstring): the workspace root is captured at `initialize` time
 * (`resolveWorkspaceRoot`); every document-scoped request falls back to that
 * document's own directory when no workspace root was ever given
 * (`rootFor`). Every `env` call is wrapped in a try/catch that warns
 * (`warn`) and degrades gracefully — an unmapped/failed lookup behaves
 * exactly like "no config resolved" (empty results), never a rejected
 * request.
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
      const pointer = caps.format?.pointerAt?.(text, position.line)
      if (pointer === undefined) return []
      const root = (await safeGitTopLevel(dirname(fileURLToPath(uri)))) ?? workspaceRoot
      return root === undefined ? [] : [toLocation(root)(pointer)]
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

/** The subset of `TextDocuments<TextDocument>` `bindSteeringServer` needs. */
export type SteeringDocuments = Pick<
  TextDocuments<TextDocument>,
  "get" | "onDidOpen" | "onDidChangeContent" | "listen"
>

/**
 * Wires a `SteeringLanguageService` onto a real (or fake) `Connection` +
 * `TextDocuments` pair: every `connection.window.*` call the service's PURE
 * `ExecuteCommandOutcome` implies lives HERE, never inside the service
 * itself. Both `didOpen` and `didChangeContent` publish diagnostics, exactly
 * like a real editor's open-then-edit lifecycle.
 */
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

// The `GTD_<UPPERCASE-name>` env-override half of `Edge.ts`'s (private)
// `resolveVars` — this call site has no resolved process (it builds a STATIC
// path→mode map, not a specific rest's `it.vars`), so there is no `entryVars`
// layer to merge in; the two-layer workflow/rc merge below plus this override
// is the whole of what a map-building context needs.
const GTD_ENV_PREFIX = "GTD_"
const mergeStaticVars = (
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

/** The layers `LspEnv`'s Effects run against, scoped to one root. */
const layersForRoot = (root: string) =>
  Layer.mergeAll(
    gitLayerForRoot(root),
    configLayerForRoot(root),
    repoFilesLayerForRoot(root),
    EnvVars.Live,
  )

type RootRuntime = ManagedRuntime.ManagedRuntime<
  GitService | ConfigService | RepoFiles | EnvVars,
  never
>

/**
 * One `ManagedRuntime` per root, memoised — decision: cache the RUNTIME (the
 * constructed service layer: git executor, cwd, worktree reader), not the
 * CONFIG. Each `LspEnv` method still calls `ConfigService.load` itself, so an
 * edited `.gtdrc` takes effect on the very next request (today's deliberate
 * v1 freshness) — only the expensive layer CONSTRUCTION stops happening on
 * every keystroke.
 */
const runtimeCache = new Map<string, RootRuntime>()

const runtimeFor = (root: string): RootRuntime => {
  const cached = runtimeCache.get(root)
  if (cached !== undefined) return cached
  const runtime = ManagedRuntime.make(layersForRoot(root))
  runtimeCache.set(root, runtime)
  return runtime
}

/**
 * Resolve the CURRENT state/actor and its `file:` (rendered), exactly like
 * the CLI (`currentRest` — the same `src/Edge.ts` entry point `gtd status`/
 * `gtd next` use), scoped to `root`. `file` is `undefined` when the resolved
 * state declares none — see `steeringFileOutcome` for what that means to the
 * command.
 */
const resolveSteeringFile = (
  root: string,
): Effect.Effect<{ readonly state: string; readonly file: string | undefined }, Error> =>
  currentRest.pipe(
    Effect.map((rest) => ({ state: rest.state, file: rest.hints.file })),
    Effect.provide(
      Layer.mergeAll(
        gitLayerForRoot(root),
        configLayerForRoot(root),
        repoFilesLayerForRoot(root),
        EnvVars.Live,
      ),
    ),
  )

/**
 * The Node adapter: the only place `LspEnv`'s Effects/layers get built and
 * run. `warn` reports `buildSteeringMap`'s own per-state findings (a `file:`
 * that failed to render, a path two states both declare) — data the map-build
 * step already carries, not a rejection `makeSteeringLanguageService` would
 * otherwise have to translate. Not exported — `startLspServer` is its only
 * caller; a fake `LspEnv` is what commit tests exercise instead.
 */
const makeNodeLspEnv = (warn: (message: string) => void): LspEnv => ({
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

  currentSteeringFile: (root) => Effect.runPromise(resolveSteeringFile(root)),
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
