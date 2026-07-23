/**
 * LSP server for `.gtd/` steering files — document symbols for a `qa`-mode
 * file's open questions and a `review`-mode file's review chunks/hunks, code
 * actions to check/uncheck a hunk or a whole chunk, and diagnostics publishing
 * the same parsers' `errors` the bundled workflow's `.gtd/FORMAT.md`
 * validators produce (see `src/OpenQuestions.ts` / `src/ReviewDoc.ts`'s
 * module docs for the "executable spec ↔ bash validator" contract this server
 * rides on top of).
 *
 * CONFIG-DRIVEN (see `docs/design/state-file-association.md` §3): the server
 * locates the active gtd config the SAME way the CLI does (`ConfigService`'s
 * cosmiconfig search — no second config code path), from the `initialize`
 * request's `workspaceFolders`/`rootUri`, falling back to the open document's
 * own directory (`ConfigService`'s own cwd→home walk-up takes it from there).
 * It renders every state's declared `file:` (the vars/env layers of
 * `it.vars` — see `resolveVars`) into an absolute-path → `mode` map, and
 * dispatches document symbols/code actions/diagnostics on THAT map — first
 * declaring state wins a path conflict, logged as a warning. Config is
 * (re)loaded lazily, fresh per request (no watcher, no cache — v1). A path
 * this map doesn't cover (or no config at all) falls back to today's basename
 * dispatch (`TODO.md` → `qa`, `REVIEW.md` → `review`), so the server still
 * works standalone with no `.gtdrc` in sight.
 *
 * `gtd.openSteeringFile` (an `executeCommand`) resolves the CURRENT state
 * exactly like the CLI (`resolveRest`/`computeProcessRun`/
 * `buildTemplateContext` — the same `src/Edge.ts` helpers `gtd status`/`gtd
 * next` use, re-adding the git/config wiring the v2 server had), renders its
 * `file:`, and asks the client to show it (`window/showDocument`); a state
 * with no `file:` gets an informational message naming the state instead.
 *
 * Split like the rest of the codebase: pure helpers below (symbol/edit/
 * diagnostic building, the path→mode map, the command's resolution outcome —
 * unit-testable, no protocol/IO), the `vscode-languageserver` wiring at the
 * bottom (the IO edge, including the git/config Effect layers `resolveMode`/
 * `resolveSteeringFile` run against).
 */

import { basename, dirname, resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect, Layer } from "effect"
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
  type CodeActionParams,
  type Diagnostic,
  type DocumentSymbol,
  type DocumentSymbolParams,
  type ExecuteCommandParams,
  type InitializeParams,
  type Range,
  type TextEdit,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { parseOpenQuestions, type OpenQuestion } from "./OpenQuestions.js"
import { parseReviewDoc, type ReviewFile, FILE_POINTER_RE } from "./ReviewDoc.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
import { WorktreeReader } from "./WorktreeReader.js"
import {
  buildTemplateContext,
  computeProcessRun,
  renderFile,
  resolveRest,
  resolveVars,
} from "./Edge.js"
import type { StateMode, WorkflowDefinition } from "./PatternMachine.js"
import { renderStateTemplate } from "./PatternTemplates.js"

// ── Pure helpers ─────────────────────────────────────────────────────────────

const lineRange = (lines: readonly string[], line: number): Range => ({
  start: { line, character: 0 },
  end: { line, character: (lines[line] ?? "").length },
})

const spanRange = (lines: readonly string[], startLine: number, endLine: number): Range => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: (lines[endLine] ?? "").length },
})

const statusMarker = (status: OpenQuestion["status"]): string =>
  status === "answered" ? "[answered]" : "[suggested]"

/** Document symbols for `.gtd/TODO.md`'s open questions. */
export const questionSymbols = (content: string): DocumentSymbol[] => {
  const { questions } = parseOpenQuestions(content)
  const lines = content.split(/\r?\n/)
  return questions.map((question, i) => {
    const start = question.headingLine
    const end = Math.max(start, (questions[i + 1]?.headingLine ?? lines.length) - 1)
    return {
      name: `${statusMarker(question.status)} ${question.question}`,
      detail: question.text,
      kind: SymbolKind.Boolean,
      range: spanRange(lines, start, end),
      selectionRange: lineRange(lines, start),
    }
  })
}

/** Diagnostics for `.gtd/TODO.md` — the same findings the workflow's `todo-validating` script would write to `.gtd/FORMAT.md`, published live over LSP instead. Whole-document range: `OpenQuestionsDoc.errors` carries no per-line position. */
export const questionDiagnostics = (content: string): Diagnostic[] => {
  const { errors } = parseOpenQuestions(content)
  const lines = content.split(/\r?\n/)
  const range = spanRange(lines, 0, Math.max(0, lines.length - 1))
  return errors.map((message) => ({
    range,
    message,
    severity: DiagnosticSeverity.Warning,
    source: "gtd",
  }))
}

const hunkLabel = (file: ReviewFile): string => {
  const box = file.checked ? "[x]" : "[ ]"
  const location = file.line !== undefined ? `${file.path}#${file.line}` : file.path
  return file.note ? `${box} ${location} — ${file.note}` : `${box} ${location}`
}

/** Document symbols for `.gtd/REVIEW.md`'s chunks (the user-facing "work packages") and their hunks. */
export const reviewSymbols = (content: string): DocumentSymbol[] => {
  const { changesets } = parseReviewDoc(content)
  const lines = content.split(/\r?\n/)
  return changesets.map((chunk, i) => {
    const start = chunk.headingLine
    const end = Math.max(start, (changesets[i + 1]?.headingLine ?? lines.length) - 1)
    const checkedCount = chunk.files.filter((file) => file.checked).length
    const children: DocumentSymbol[] = chunk.files.map((file) => ({
      name: hunkLabel(file),
      kind: SymbolKind.Boolean,
      range: lineRange(lines, file.sourceLine),
      selectionRange: lineRange(lines, file.sourceLine),
    }))
    return {
      name: `${chunk.title} (${checkedCount}/${chunk.files.length})`,
      kind: SymbolKind.Package,
      range: spanRange(lines, start, end),
      selectionRange: lineRange(lines, start),
      children,
    }
  })
}

/** Diagnostics for `.gtd/REVIEW.md` — the same findings the workflow's `review-validating` script would write to `.gtd/FORMAT.md`, published live over LSP instead. Whole-document range: `ReviewDoc.errors` carries no per-line position. */
export const reviewDiagnostics = (content: string): Diagnostic[] => {
  const { errors } = parseReviewDoc(content)
  const lines = content.split(/\r?\n/)
  const range = spanRange(lines, 0, Math.max(0, lines.length - 1))
  return errors.map((message) => ({
    range,
    message,
    severity: DiagnosticSeverity.Warning,
    source: "gtd",
  }))
}

/** Flips the `[ ]`/`[x]` box of the hunk line at `line`, preserving path/note text exactly. */
export const toggleHunkEdit = (content: string, line: number): TextEdit | undefined => {
  const raw = content.split(/\r?\n/)[line]
  if (raw === undefined) return undefined
  const leading = raw.length - raw.trimStart().length
  const trimmed = raw.slice(leading)
  const match = FILE_POINTER_RE.exec(trimmed)
  if (!match) return undefined
  const bracketContent = match[0].indexOf("[") + 1
  const character = leading + bracketContent
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    newText: match[1] === " " ? "x" : " ",
  }
}

/**
 * The target state a whole-chunk toggle drives every hunk to: `true` (check
 * all) unless a strict majority are already checked, in which case `false`
 * (uncheck all) — a chunk with no strict majority either way (including an
 * even split) defaults to checking, so it's never a meaningless no-op on a
 * chunk that's already uniform.
 */
const chunkToggleTarget = (checkedCount: number, total: number): boolean =>
  checkedCount * 2 <= total

/**
 * Toggles every hunk in the chunk headed at `headingLine` to a single target
 * state (`chunkToggleTarget`). Only hunks not already at the target state
 * produce an edit.
 */
export const toggleChunkEdits = (content: string, headingLine: number): TextEdit[] => {
  const { changesets } = parseReviewDoc(content)
  const chunk = changesets.find((c) => c.headingLine === headingLine)
  if (!chunk || chunk.files.length === 0) return []
  const checkedCount = chunk.files.filter((file) => file.checked).length
  const target = chunkToggleTarget(checkedCount, chunk.files.length)
  const edits: TextEdit[] = []
  for (const file of chunk.files) {
    if (file.checked === target) continue
    const edit = toggleHunkEdit(content, file.sourceLine)
    if (edit) edits.push(edit)
  }
  return edits
}

/**
 * Code actions for `.gtd/REVIEW.md`: "check/uncheck this hunk" when `range`
 * sits on a hunk line, "check/uncheck all hunks" when `range` sits anywhere
 * in a chunk (heading or body).
 */
export const reviewCodeActions = (uri: string, content: string, range: Range): CodeAction[] => {
  const { changesets } = parseReviewDoc(content)
  const lines = content.split(/\r?\n/)
  const cursorLine = range.start.line
  const actions: CodeAction[] = []

  // fallow-ignore-next-line complexity
  changesets.forEach((chunk, i) => {
    const hunk = chunk.files.find((file) => file.sourceLine === cursorLine)
    if (hunk) {
      const edit = toggleHunkEdit(content, hunk.sourceLine)
      if (edit) {
        actions.push({
          title: hunk.checked ? "gtd: uncheck this hunk" : "gtd: check this hunk",
          kind: CodeActionKind.QuickFix,
          edit: { changes: { [uri]: [edit] } },
        })
      }
    }

    const chunkEnd = Math.max(
      chunk.headingLine,
      (changesets[i + 1]?.headingLine ?? lines.length) - 1,
    )
    if (chunk.files.length > 0 && cursorLine >= chunk.headingLine && cursorLine <= chunkEnd) {
      const edits = toggleChunkEdits(content, chunk.headingLine)
      if (edits.length > 0) {
        const checkedCount = chunk.files.filter((file) => file.checked).length
        const willCheck = chunkToggleTarget(checkedCount, chunk.files.length)
        actions.push({
          title: willCheck
            ? `gtd: check all hunks in "${chunk.title}"`
            : `gtd: uncheck all hunks in "${chunk.title}"`,
          kind: CodeActionKind.QuickFix,
          edit: { changes: { [uri]: edits } },
        })
      }
    }
  })

  return actions
}

// ── Config-driven path→mode dispatch (pure) ─────────────────────────────────

/** The basename dispatch this server has always had — the fallback for any path the active workflow's `file:` map doesn't cover (or when no config resolves at all). */
export const basenameFallbackMode = (name: string): StateMode | undefined => {
  if (name === "TODO.md") return "qa"
  if (name === "REVIEW.md") return "review"
  return undefined
}

/** One `buildFileModeMap` finding: a state whose `file:` failed to render, or a path two states both declare (first wins). */
export type FileModeWarning = string

/**
 * Render every state's declared `file:`/`mode:` pair into an absolute-path →
 * `mode` map, for a workflow already compiled against `root` (the workspace
 * root, or the open document's directory when no workspace root is known —
 * see `resolveWorkspaceRoot`). `vars` is the already-merged three-layer
 * `it.vars` (`resolveVars`) — the map-building context otherwise carries
 * empty-string commit-ish fields and a `read` that throws (no working tree to
 * read from at map-build time; the JUMP command — `resolveSteeringFile`
 * below — uses the FULL edge context instead). A state whose `file:` fails to
 * render is skipped with a warning, not fatal; a path two states both declare
 * keeps the FIRST declaring state's mode, also warning (`Object.entries`
 * preserves the workflow's own declaration order). Pure — no git, no
 * protocol, unit-testable directly.
 */
export const buildFileModeMap = (
  def: WorkflowDefinition,
  vars: Record<string, string>,
  root: string,
): {
  readonly map: ReadonlyMap<string, StateMode>
  readonly warnings: readonly FileModeWarning[]
} => {
  const map = new Map<string, StateMode>()
  const warnings: FileModeWarning[] = []
  for (const [name, stateDef] of Object.entries(def.states)) {
    if (stateDef.file === undefined || stateDef.mode === undefined) continue
    let rendered: string
    try {
      rendered = renderStateTemplate(stateDef.file, {
        startCommit: "",
        currentCommit: "",
        previousCommit: "",
        state: name,
        actor: "",
        processDiff: "",
        lastDiff: "",
        read: (path: string) => {
          throw new Error(
            `"file:" is not readable while building the path→mode map (path: ${path})`,
          )
        },
        vars,
        edges: [],
      })
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
        `"${absolute}" is already mapped to mode "${existing}" by an earlier state; state "${name}"'s mode ("${stateDef.mode}") is ignored`,
      )
      continue
    }
    map.set(absolute, stateDef.mode)
  }
  return { map, warnings }
}

/** The mode a document's URI dispatches to: the config-driven map first, the basename fallback otherwise. */
export const modeForDocument = (
  uri: string,
  fileModeMap: ReadonlyMap<string, StateMode>,
): StateMode | undefined =>
  fileModeMap.get(fileURLToPath(uri)) ?? basenameFallbackMode(basename(fileURLToPath(uri)))

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

// ── Protocol adapter ─────────────────────────────────────────────────────────

/** Diagnostics for one document, dispatching on its resolved `mode` — the same dispatch `onDocumentSymbol`/`onCodeAction` below use. No mode (an unrecognized path, config or no) publishes an empty list, clearing any diagnostics a client is still showing for it. */
const diagnosticsForMode = (mode: StateMode | undefined, content: string): Diagnostic[] => {
  switch (mode) {
    case "qa":
      return questionDiagnostics(content)
    case "review":
      return reviewDiagnostics(content)
    default:
      return []
  }
}

/** `ConfigService.Live` scoped to `root` — the same config-loading code path the CLI uses (`src/Config.ts`), never a second one. */
const configLayerForRoot = (root: string) => ConfigService.Live.pipe(Layer.provide(Cwd.layer(root)))

/** `GitService.Live` scoped to `root`, with the Node command executor it needs to shell out to `git`. */
const gitLayerForRoot = (root: string) =>
  GitService.Live.pipe(Layer.provide(Layer.merge(Cwd.layer(root), NodeContext.layer)))

const worktreeLayerForRoot = (root: string) =>
  WorktreeReader.Live.pipe(Layer.provide(Cwd.layer(root)))

/**
 * Load the active workflow's `file:`/`mode:` map for `root` (see
 * `buildFileModeMap`) — config (re)loaded fresh, no cache. Any failure (a bad
 * `.gtdrc`, no config at all) is caught and reported via `onWarn`; the caller
 * falls back to `basenameFallbackMode` for every document either way (an
 * empty map behaves identically to "no config resolved").
 */
const loadModeMap = async (
  root: string,
  onWarn: (message: string) => void,
): Promise<ReadonlyMap<string, StateMode>> => {
  try {
    const config = await Effect.runPromise(
      ConfigService.pipe(Effect.provide(configLayerForRoot(root))),
    )
    const vars = resolveVars(config.workflowVars, config.rcVars, process.env)
    const { map, warnings } = buildFileModeMap(config.workflow, vars, root)
    for (const warning of warnings) onWarn(warning)
    return map
  } catch (e) {
    onWarn(
      `failed to load gtd config at "${root}" — falling back to basename dispatch: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
    return new Map()
  }
}

/**
 * Resolve the CURRENT state/actor and its `file:` (rendered), exactly like
 * the CLI (`resolveRest`/`computeProcessRun`/`buildTemplateContext` — the
 * same `src/Edge.ts` helpers `gtd status`/`gtd next` call), scoped to `root`.
 * `file` is `undefined` when the resolved state declares none — see
 * `steeringFileOutcome` for what that means to the command.
 */
const resolveSteeringFile = (
  root: string,
): Effect.Effect<{ readonly state: string; readonly file: string | undefined }, Error> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* ConfigService
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const vars = resolveVars(config.workflowVars, config.rcVars, envVars.all)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      rest.state,
      rest.actor,
      run,
      vars,
      rest.stateDef.on,
    )
    const file = yield* renderFile(rest.stateDef, context)
    return { state: rest.state, file }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        gitLayerForRoot(root),
        configLayerForRoot(root),
        worktreeLayerForRoot(root),
        EnvVars.Live,
      ),
    ),
  )

/**
 * Starts the `gtd lsp` server over stdio. Config-driven (see the module
 * docstring): the workspace root is captured at `initialize` time
 * (`resolveWorkspaceRoot`); every document-scoped request falls back to that
 * document's own directory when no workspace root was ever given. The
 * returned Effect resolves when the client disconnects (`exit`
 * notification), so the process exits cleanly rather than blocking forever.
 */
export const startLspServer = (): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
    const documents = new TextDocuments(TextDocument)
    let workspaceRoot: string | undefined

    const rootFor = (documentUri: string): string =>
      workspaceRoot ?? dirname(fileURLToPath(documentUri))
    const warn = (message: string): void => connection.console.warn(`gtd lsp: ${message}`)

    connection.onInitialize((params: InitializeParams) => {
      workspaceRoot = resolveWorkspaceRoot(params)
      return {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Incremental,
          documentSymbolProvider: true,
          codeActionProvider: true,
          executeCommandProvider: { commands: [OPEN_STEERING_FILE_COMMAND] },
        },
      }
    })

    connection.onDocumentSymbol(async (params: DocumentSymbolParams) => {
      const document = documents.get(params.textDocument.uri)
      if (!document) return []
      const map = await loadModeMap(rootFor(document.uri), warn)
      switch (modeForDocument(document.uri, map)) {
        case "qa":
          return questionSymbols(document.getText())
        case "review":
          return reviewSymbols(document.getText())
        default:
          return []
      }
    })

    connection.onCodeAction(async (params: CodeActionParams) => {
      const document = documents.get(params.textDocument.uri)
      if (!document) return []
      const map = await loadModeMap(rootFor(document.uri), warn)
      if (modeForDocument(document.uri, map) !== "review") return []
      return reviewCodeActions(document.uri, document.getText(), params.range)
    })

    connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
      if (params.command !== OPEN_STEERING_FILE_COMMAND) return null
      const root = workspaceRoot ?? process.cwd()
      try {
        const { state, file } = await Effect.runPromise(resolveSteeringFile(root))
        const outcome = steeringFileOutcome(state, file, root)
        if (outcome.kind === "inform") {
          connection.window.showInformationMessage(
            `gtd: state "${outcome.state}" has no associated steering file.`,
          )
        } else {
          await connection.window.showDocument({ uri: outcome.uri })
        }
      } catch (e) {
        connection.window.showErrorMessage(
          `gtd.openSteeringFile: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      return null
    })

    const publishDiagnostics = async (uri: string, content: string): Promise<void> => {
      const map = await loadModeMap(rootFor(uri), warn)
      connection.sendDiagnostics({
        uri,
        diagnostics: diagnosticsForMode(modeForDocument(uri, map), content),
      })
    }

    documents.onDidOpen((change) => {
      void publishDiagnostics(change.document.uri, change.document.getText())
    })
    documents.onDidChangeContent((change) => {
      void publishDiagnostics(change.document.uri, change.document.getText())
    })

    documents.listen(connection)
    connection.listen()

    yield* Effect.async<void>((resume) => {
      connection.onExit(() => resume(Effect.void))
    })
  })
