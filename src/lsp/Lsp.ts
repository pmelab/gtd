import { statSync } from "node:fs"
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
  type DocumentLink,
  type DocumentSymbol,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type Position,
  type Range,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { Narrator, GitService, Host, Workspace } from "../platform/index.js"
import {
  ConfigDiscovery,
  ConfigService,
  SEARCH_PLACES,
  WORKFLOW_MODULE,
  walkUp,
  type StateMode,
  type WorkflowDefinition,
} from "../workflow/index.js"
import { currentRest, type RestRequirements } from "../edge/index.js"
import { resolveMode, type ResolvedMode } from "../emit/index.js"
import {
  FOOTNOTE_ACTION_TITLE,
  THREAD_REPLY_ACTION_TITLE,
  openThreadFindings,
  viewOf,
  type SteeringAction,
  type SteeringFinding,
  type SteeringLink,
  type SteeringOutlineNode,
  type SteeringPointer,
} from "../steering/index.js"

// ── Domain → protocol translation (pure) ────────────────────────────────────

/** A `SteeringOutlineNode` tree → `DocumentSymbol` tree: `leaf: true` maps to `SymbolKind.Boolean`, a container to `SymbolKind.Package` — an outline icon distinction only, no protocol contract. */
export const toDocumentSymbol = (node: SteeringOutlineNode): DocumentSymbol => ({
  name: node.name,
  ...(node.detail !== undefined ? { detail: node.detail } : {}),
  kind: node.leaf === true ? SymbolKind.Boolean : SymbolKind.Package,
  range: node.range,
  selectionRange: node.selectionRange,
  ...(node.children !== undefined ? { children: node.children.map(toDocumentSymbol) } : {}),
})

/**
 * Matches the footnote action's own definition edit's `newText`: a leading
 * newline then the `[^name]:` label — the shape `footnoteAdditionEdits`
 * always writes. Group 1 is the label alone, whose length is the reveal
 * column (see `revealPositionFor`).
 */
const FOOTNOTE_DEFINITION_RE = /^\r?\n(\[\^[^\s\]]+\]:)/

/** The reply edit's `newText`: an EOL then the `- H: ` line; group 1 is that line, whose length is the reveal column. */
const THREAD_REPLY_RE = /^\r?\n( *- H: )$/

/**
 * Where `gtd.revealPosition` should land the cursor for `action`, or
 * `undefined` for anything but the footnote action (or a footnote action
 * whose edits carry no matching definition — never thrown, just no jump).
 * The line CLAMPS the definition edit's own start line to the document's
 * last line index before adding one: the edit's `newText` opens with one
 * `\n`, so the definition sits one line below wherever that start position
 * actually resolves, and at EOF that position is clamped by the protocol
 * itself. A flat `+2` is wrong there — see the package's own risk note.
 */
const revealPositionFor = (text: string, action: SteeringAction): Position | undefined => {
  if (action.title === THREAD_REPLY_ACTION_TITLE) {
    const edit = action.edits[0]
    const match = edit && THREAD_REPLY_RE.exec(edit.newText)
    return edit && match
      ? { line: edit.range.start.line + 1, character: match[1]!.length }
      : undefined
  }
  if (action.title !== FOOTNOTE_ACTION_TITLE) return undefined
  const lines = text.split(/\r?\n/)
  for (const edit of action.edits) {
    const match = FOOTNOTE_DEFINITION_RE.exec(edit.newText)
    if (!match) continue
    return {
      line: Math.min(edit.range.start.line, lines.length - 1) + 1,
      character: match[1]!.length,
    }
  }
  return undefined
}

export const toCodeAction =
  (uri: string, text: string) =>
  (action: SteeringAction): CodeAction => {
    const position = revealPositionFor(text, action)
    return {
      title: action.title,
      kind: CodeActionKind.QuickFix,
      edit: { changes: { [uri]: [...action.edits] } },
      ...(position !== undefined
        ? {
            command: {
              title: action.title,
              command: REVEAL_POSITION_COMMAND,
              arguments: [uri, position],
            },
          }
        : {}),
    }
  }

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

/** A whole-line (or whole-document) span, for a finding with no `range` of its own — the one place left computing a fallback range; every other range (outline, document links) already arrives pre-resolved off `viewOf`. */
const lineSpan = (
  lines: readonly string[],
  startLine: number,
  endLine: number,
): {
  readonly start: { line: number; character: number }
  readonly end: { line: number; character: number }
} => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: (lines[endLine] ?? "").length },
})

/** One `SteeringFinding` → a `Diagnostic`: a finding's own `range` hands straight through (it already spans the node the finding is about), a `line` with no `range` falls back to that whole line, and a positionless finding spans the whole document. Not exported on its own — `diagnosticsFor`'s tests cover it in context. */
const toDiagnostic =
  (lines: readonly string[]) =>
  (finding: SteeringFinding): Diagnostic => ({
    range:
      finding.range ??
      (finding.line !== undefined
        ? lineSpan(lines, finding.line, finding.line)
        : lineSpan(lines, 0, Math.max(0, lines.length - 1))),
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
  const caps = resolved?.capabilities ?? {}
  const lines = content.split(/\r?\n/)
  // Built-in parse is free, so open threads show even when a shell validator displaced live findings.
  const open = (): Diagnostic[] =>
    openThreadFindings(content).map((f) => ({
      ...toDiagnostic(lines)(f),
      severity: DiagnosticSeverity.Information,
    }))
  if (caps.liveValidate !== undefined) {
    return [...caps.liveValidate(content).map(toDiagnostic(lines)), ...open()]
  }
  if (caps.externalValidate === true && resolved?.validate?.kind === "command") {
    return [externalValidatorNotice(resolved.mode, resolved.validate.command), ...open()]
  }
  return []
}

/** A `SteeringLink` → a `DocumentLink`, resolving its target file against `root` — same resolution `toLocation` already does for a foreign `pointerAt` jump. `line` is 0-based; the target URI's `#L<line+1>` fragment names the 1-based line, mirroring a familiar (GitHub-style) file-link convention. */
export const toDocumentLink =
  (root: string) =>
  (link: SteeringLink): DocumentLink => ({
    range: link.range,
    target: `${pathToFileURL(resolvePath(root, link.path)).toString()}#L${link.line + 1}`,
  })

/** Document links for one document, given its resolved mode and `root` (needed to resolve each link's target path). `undefined` mode, or a format declaring no `documentLinks` (`qa`), yields none. */
export const documentLinksFor = (
  resolved: ResolvedMode | undefined,
  content: string,
  root: string,
): DocumentLink[] => {
  const format = resolved?.capabilities.format
  if (format === undefined) return []
  return viewOf(format, content).documentLinks.map(toDocumentLink(root))
}

// ── Config-driven path→mode dispatch (pure) ─────────────────────────────────

/** Fallback for any path the workflow's `file:` map doesn't cover. `TODO.md` is intentionally not mapped — the bundled `idle` state declares no `mode:` for it. */
export const basenameFallbackMode = (name: string): ResolvedMode | undefined => {
  if (name !== "REVIEW.md") return undefined
  const resolved = resolveMode(undefined, "", "review")
  return resolved.kind === "resolved" ? resolved : undefined
}

/** One `buildSteeringMap` finding: a `mode:` that didn't resolve, or a path two steps both declare (first wins). */
export type FileModeWarning = string

/** A step's declared steering file and its mode, as replay reached it. */
export interface SteeringStep {
  readonly name: string
  readonly file?: string | undefined
  readonly mode?: string | undefined
}

/**
 * The `file:`/`mode:` pairs of the steps the current process has reached, as
 * an absolute-path → `ResolvedMode` map. A flow is code, so only a step replay
 * reached is known; a path two steps both declare keeps the first one's mode,
 * warning.
 */
export const buildSteeringMap = (
  def: Pick<WorkflowDefinition, "modes">,
  steps: readonly SteeringStep[],
  root: string,
): {
  readonly map: ReadonlyMap<string, ResolvedMode>
  readonly warnings: readonly FileModeWarning[]
} => {
  const map = new Map<string, ResolvedMode>()
  const warnings: FileModeWarning[] = []
  for (const node of steps) {
    const { file, mode } = node
    if (file === undefined || mode === undefined) continue
    const absolute = resolvePath(root, file)
    const existing = map.get(absolute)
    if (existing !== undefined) {
      if (existing.mode !== mode) {
        warnings.push(
          `"${absolute}" is already mapped to mode "${existing.mode}" by an earlier step; step "${node.name}"'s mode ("${mode}") is ignored`,
        )
      }
      continue
    }
    const resolved = resolveMode(def, node.name, mode as StateMode)
    if (resolved.kind === "unknown") {
      warnings.push(`${resolved.message}, skipped`)
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
) => resolvedModeForDocument(uri, steeringMap)?.capabilities ?? {}

export const resolveWorkspaceRoot = (params: {
  readonly workspaceFolders?: ReadonlyArray<{ readonly uri: string }> | null
  readonly rootUri?: string | null
}): string | undefined => {
  const uri = params.workspaceFolders?.[0]?.uri ?? params.rootUri ?? undefined
  return uri === undefined || uri === null ? undefined : fileURLToPath(uri)
}

// ── `gtd.openSteeringFile` (pure resolution outcome) ────────────────────────

const OPEN_STEERING_FILE_COMMAND = "gtd.openSteeringFile"

/** Registered alongside `gtd.openSteeringFile`: a NEW command id rather than overloading that one, whose whole contract is "resolve the current state's steering file" — an unrelated argument shape (uri, position) has no business riding along. */
const REVEAL_POSITION_COMMAND = "gtd.revealPosition"

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
  /**
   * The active workflow's `file:`/`mode:` map for `root`, memoised by
   * `makeNodeLspEnv` on HEAD's hash plus the `(path, size, mtimeMs)` of every
   * file the LAST resolution's `ConfigService.load` reported touching
   * (`configFiles` + `workflowFiles` — the `.gtdrc` family AND `gtd.config.ts`
   * PLUS whatever it imports, e.g. a sibling module a split workflow re-
   * exports `steering`/steps from). That file SET is itself re-measured on
   * every miss, so it self-corrects the next time anything in it actually
   * changes — it is not a static, one-time-discovered list.
   *
   * HEAD plus that file set is the COMPLETE dependency set, because nothing
   * `reachedSteeringSteps` reads off `rest` depends on the working tree:
   * `rest.trace`, `rest.state` and `rest.hints.file` all come from `restAt`
   * (`src/edge/Edge.ts`), whose `replayFor(setup)` call passes no `pending` tree —
   * see the comment there, which this memo depends on staying true.
   */
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

/**
 * What a command does, in a form `bindSteeringServer` can act on without the
 * service itself ever touching `connection.window`. `show`'s `selection` is
 * present only for `gtd.revealPosition` — a collapsed range at the reveal
 * position — and absent for `gtd.openSteeringFile`, whose contract has never
 * been "move the cursor", only "open the file".
 */
export type ExecuteCommandOutcome =
  | { readonly kind: "show"; readonly uri: string; readonly selection?: Range }
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
  readonly documentLink: (uri: string, text: string) => Promise<DocumentLink[]>
  readonly executeCommand: (
    command: string,
    args: ReadonlyArray<unknown> | undefined,
  ) => Promise<ExecuteCommandOutcome>
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Reads `gtd.revealPosition`'s two required arguments off the raw, untyped `args` array — `undefined` for anything malformed (wrong length/types, a position missing `line`/`character`), never a thrown property access. */
const revealPositionArgs = (
  args: ReadonlyArray<unknown> | undefined,
): { readonly uri: string; readonly position: Position } | undefined => {
  const [uri, position] = args ?? []
  if (typeof uri !== "string" || typeof position !== "object" || position === null) {
    return undefined
  }
  const { line, character } = position as { line?: unknown; character?: unknown }
  if (typeof line !== "number" || typeof character !== "number") return undefined
  return { uri, position: { line, character } }
}

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
          documentLinkProvider: { resolveProvider: false },
          executeCommandProvider: {
            commands: [OPEN_STEERING_FILE_COMMAND, REVEAL_POSITION_COMMAND],
          },
        },
      }
    },

    documentSymbol: async (uri, text) => {
      const caps = await capabilitiesFor(uri)
      if (caps.format === undefined) return []
      return viewOf(caps.format, text).outline.map(toDocumentSymbol)
    },

    codeAction: async (uri, text, range) => {
      const caps = await capabilitiesFor(uri)
      if (caps.format === undefined) return []
      return viewOf(caps.format, text).actionsAt(range).map(toCodeAction(uri, text))
    },

    definition: async (uri, text, position) => {
      const caps = await capabilitiesFor(uri)
      const pointer =
        caps.format !== undefined ? viewOf(caps.format, text).pointerAt(position) : undefined
      if (pointer === undefined) return []
      if (pointer.path === undefined) return [toLocation("", uri)(pointer)]
      const root = (await safeGitTopLevel(dirname(fileURLToPath(uri)))) ?? workspaceRoot
      return root === undefined ? [] : [toLocation(root, uri)(pointer)]
    },

    diagnostics: async (uri, text) => {
      const map = await safeSteeringMap(rootFor(uri))
      return diagnosticsFor(resolvedModeForDocument(uri, map), text)
    },

    documentLink: async (uri, text) => {
      const map = await safeSteeringMap(rootFor(uri))
      const root = (await safeGitTopLevel(dirname(fileURLToPath(uri)))) ?? workspaceRoot
      if (root === undefined) return []
      return documentLinksFor(resolvedModeForDocument(uri, map), text, root)
    },

    executeCommand: async (command, args) => {
      if (command === REVEAL_POSITION_COMMAND) {
        const parsed = revealPositionArgs(args)
        if (!parsed) {
          return { kind: "error", message: "gtd.revealPosition: malformed arguments" }
        }
        return {
          kind: "show",
          uri: parsed.uri,
          selection: { start: parsed.position, end: parsed.position },
        }
      }
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
  | "onDocumentLinks"
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

  connection.onDocumentLinks(async (params) => {
    const document = documents.get(params.textDocument.uri)
    return document ? service.documentLink(document.uri, document.getText()) : []
  })

  connection.onExecuteCommand(async (params) => {
    const outcome = await service.executeCommand(params.command, params.arguments)
    if (outcome.kind === "show") {
      await connection.window.showDocument({
        uri: outcome.uri,
        ...(outcome.selection !== undefined
          ? { selection: outcome.selection, takeFocus: true }
          : {}),
      })
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

/**
 * `Host.Live`'s own home/env, resolved ONCE — the only place this module
 * reaches for the real environment; every per-root layer below overrides just
 * `root`, never touching `process.cwd()`/`process.env` itself.
 */
const liveHost = Effect.runSync(Effect.provide(Host, Host.Live))

const hostLayerForRoot = (root: string) => Host.layer({ ...liveHost, root })

/** `GitService.Live` scoped to `root`, with the Node command executor it needs to shell out to `git`. */
const gitLayerForRoot = (root: string) =>
  GitService.Live.pipe(Layer.provide(Layer.merge(hostLayerForRoot(root), NodeContext.layer)))

const workspaceLayerForRoot = (root: string) =>
  Workspace.Live.pipe(Layer.provide(Layer.merge(hostLayerForRoot(root), gitLayerForRoot(root))))

/** The layers `LspEnv`'s Effects run against. `Narrator` is a permanent no-op — the LSP talks stdio JSON-RPC, with nothing to narrate onto — provided only so the shared `Narrator` requirement typechecks. */
const layersForRoot = (root: string) =>
  Layer.mergeAll(
    gitLayerForRoot(root),
    ConfigService.Live,
    ConfigDiscovery.Live,
    workspaceLayerForRoot(root),
    hostLayerForRoot(root),
    Narrator.layer(() => {}, false),
  )

type RootRuntime = ManagedRuntime.ManagedRuntime<
  GitService | ConfigService | ConfigDiscovery | Workspace | Host | Narrator,
  never
>

/**
 * One `ManagedRuntime` per root, memoised — caches the runtime (the
 * constructed service layer), not the config: `currentSteeringFile` and a
 * `steeringMapFor` cache miss still call `ConfigService.load` fresh through
 * it. A `steeringMapFor` hit skips that load entirely, but its own memo (see
 * `makeNodeLspEnv`) is keyed on the `(path, size, mtimeMs)` of every file the
 * LAST such load reported touching, so an edit to `.gtdrc`, `gtd.config.ts`,
 * or a module `gtd.config.ts` imports still forces the next request to
 * reload — only an unrelated repeat request skips it.
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

/**
 * `reachedSteeringSteps`'s result — cached by `makeNodeLspEnv`'s steering-map
 * memo, since building the final map from it (`buildSteeringMap`) is pure and
 * cheap. `dependencyFiles` is every file THIS resolution's `ConfigService.load`
 * reported touching (`configFiles` + `workflowFiles` — see `ConfigOperations`)
 * — the memo re-stats exactly this set on its next call to decide whether the
 * cached `{def, steps}` is still good, so it stays correct even when it
 * doesn't know in advance what a split workflow's `gtd.config.ts` imports.
 */
interface ReachedSteeringSteps {
  readonly def: Pick<WorkflowDefinition, "modes">
  readonly steps: readonly SteeringStep[]
  readonly dependencyFiles: readonly string[]
}

// A repository whose process cannot be resolved (no commits yet, a diverged
// history) still has a config: it maps nothing but keeps the basename fallback.
const reachedSteeringSteps: Effect.Effect<ReachedSteeringSteps, Error, RestRequirements> =
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const rest = yield* Effect.either(currentRest)
    const reached =
      rest._tag === "Left"
        ? []
        : rest.right.trace.map((step) => ({
            name: step.name,
            file: step.request.options.file,
            mode: step.request.options.mode,
          }))
    // A step the process has reached wins; the `steering` export covers the rest.
    const declared = Object.entries(config.workflow.steering).map(([file, mode]) => ({
      name: "the steering export",
      file,
      mode,
    }))
    return {
      def: config.workflow,
      steps: [...reached, ...declared],
      dependencyFiles: [...config.configFiles, ...config.workflowFiles],
    }
  })

/** A cheap `(size, mtimeMs)` fingerprint of `path` — a stat, never a read. `"missing"` when it doesn't exist, so a file's creation OR deletion still changes the identity. */
const fingerprintOf = (path: string): string => {
  try {
    const stat = statSync(path)
    return `${stat.size}:${stat.mtimeMs}`
  } catch {
    return "missing"
  }
}

/** `paths`' identity, sorted so the same set always reads the same regardless of build order. `known`'s fingerprint wins over a fresh `fingerprintOf` stat where it has one — see `steeringMapFor`'s miss path for why that matters. */
const identityOf = (paths: readonly string[], known?: ReadonlyMap<string, string>): string =>
  paths
    .map((path) => `${path}:${known?.get(path) ?? fingerprintOf(path)}`)
    .sort()
    .join("|")

/**
 * Every path a `.gtdrc`/`gtd.config.ts` COULD live at for `root` — every
 * `SEARCH_PLACES` name plus `gtd.config.ts` itself, in every directory
 * `walkUp(root, home)` visits — computed from path strings alone, no
 * filesystem access. Unlike `ConfigOperations.configFiles`/`workflowFiles`
 * (which name only what a load actually FOUND), this list is complete
 * whether or not any of it exists yet, so `identityOf` on it catches a
 * brand-new `.gtdrc` appearing where there was none, not just an edit to one
 * that already existed.
 */
const candidateConfigPaths = (root: string): readonly string[] =>
  walkUp(root, liveHost.home).flatMap((dir) => [
    ...SEARCH_PLACES.map((name) => resolvePath(dir, name)),
    resolvePath(dir, WORKFLOW_MODULE),
  ])

/** The Node adapter: the only place `LspEnv`'s Effects/layers get built and run. `startLspServer` is its production caller; most `Lsp.test.ts` coverage exercises a fake `LspEnv` instead, but this is exported so the real wiring (real git/config/repo-files layers) gets exercised against a real temp repo too. */
export const makeNodeLspEnv = (warn: (message: string) => void): LspEnv => {
  // One entry per root: the resolved `{def, steps, dependencyFiles}` plus the
  // HEAD hash and config identity it was resolved under.
  const stepsMemo = new Map<
    string,
    {
      readonly headHash: string
      readonly configIdentity: string
      readonly result: ReachedSteeringSteps
    }
  >()

  const headHashFor = (root: string): Promise<string> =>
    runtimeFor(root)
      .runPromise(Effect.flatMap(GitService, (git) => git.resolveRef("HEAD")))
      .catch(() => "no-head")

  /** `result.dependencyFiles` beyond `candidateConfigPaths(root)` — a genuine import elsewhere (e.g. a split workflow's sibling module), never `gtd.config.ts`/`.gtdrc` themselves, which the static set already names. */
  const dynamicOnlyPaths = (root: string, result: ReachedSteeringSteps): readonly string[] => {
    const staticSet = new Set(candidateConfigPaths(root))
    return result.dependencyFiles.filter((path) => !staticSet.has(path))
  }

  // `documents.onDidOpen`/`onDidChangeContent` (async diagnostics) and a
  // direct `documentSymbol`/`codeAction`/etc. request both call
  // `steeringMapFor` for the SAME root on the SAME edit — often within the
  // same tick. Two resolutions of one root's `gtd.config.ts` (plus whatever
  // it imports) were observed to race each other under real concurrency: not
  // just the stat-vs-read ordering above, but jiti itself returning one
  // call's STALE import for a sibling module mid-edit while another
  // concurrent call for the same path was in flight. Serializing every
  // `steeringMapFor` call per root removes the possibility outright — at
  // most one resolution for a root is ever in flight, so nothing concurrent
  // is left to race against.
  const queues = new Map<string, Promise<unknown>>()
  const serialized = <T>(root: string, task: () => Promise<T>): Promise<T> => {
    const settled = (queues.get(root) ?? Promise.resolve()).then(task, task)
    queues.set(
      root,
      settled.then(
        () => undefined,
        () => undefined,
      ),
    )
    return settled
  }

  return {
    cwd: liveHost.root,

    steeringMapFor: (root) =>
      serialized(root, async () => {
        const headHash = await headHashFor(root)
        const cached = stepsMemo.get(root)
        const hit =
          cached !== undefined &&
          cached.headHash === headHash &&
          identityOf([...candidateConfigPaths(root), ...dynamicOnlyPaths(root, cached.result)]) ===
            cached.configIdentity
        if (hit) {
          const { map, warnings } = buildSteeringMap(cached.result.def, cached.result.steps, root)
          for (const warning of warnings) warn(warning)
          return map
        }
        // Every path already known to matter — static, or dynamic from the
        // entry this call is about to replace — is stat'd BEFORE this
        // resolution reads it, never after: stat-after-read lets a same-
        // window edit pair the edit's NEW stat with the OLD, pre-edit
        // result, and nothing later distinguishes that pairing from the
        // truth — a hit stuck wrong forever. Stat-before-read can only pair
        // an OLDER stat with a result that's already fresh, which the next
        // check reads as "disk moved past this" and reloads once more —
        // safe. A dependency no earlier resolution ever named has no
        // "before" to stat from and is measured after this one, same as
        // always — but from then on it too is "already known".
        const staticPaths = candidateConfigPaths(root)
        const knownDynamic = cached !== undefined ? dynamicOnlyPaths(root, cached.result) : []
        const before = new Map(
          [...staticPaths, ...knownDynamic].map((path) => [path, fingerprintOf(path)]),
        )
        const result = await runtimeFor(root).runPromise(reachedSteeringSteps)
        const configIdentity = identityOf(
          [...staticPaths, ...dynamicOnlyPaths(root, result)],
          before,
        )
        stepsMemo.set(root, { headHash, configIdentity, result })
        const { map, warnings } = buildSteeringMap(result.def, result.steps, root)
        for (const warning of warnings) warn(warning)
        return map
      }),

    gitTopLevel: (dir) =>
      runtimeFor(dir).runPromise(Effect.flatMap(GitService, (git) => git.topLevel())),

    currentSteeringFile: (root) => runtimeFor(root).runPromise(resolveSteeringFile),
  }
}

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
