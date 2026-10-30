import { execFile } from "node:child_process"
import { basename, dirname, resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect } from "effect"
import {
  createConnection,
  ProposedFeatures,
  StreamMessageReader,
  StreamMessageWriter,
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
import type { BeatDocument } from "../wire/index.js"
import {
  FOOTNOTE_ACTION_TITLE,
  THREAD_REPLY_ACTION_TITLE,
  openThreadFindings,
  steeringFormatFor,
  viewOf,
  type SteeringAction,
  type SteeringFinding,
  type SteeringFormat,
  type SteeringLink,
  type SteeringOutlineNode,
  type SteeringPointer,
} from "../steering/internal.js"

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

export const diagnosticsFor = (
  format: SteeringFormat | undefined,
  content: string,
): Diagnostic[] => {
  if (format === undefined) return []
  const lines = content.split(/\r?\n/)
  return [
    ...format.validate(content).map(toDiagnostic(lines)),
    ...openThreadFindings(content).map((f) => ({
      ...toDiagnostic(lines)(f),
      severity: DiagnosticSeverity.Information,
    })),
  ]
}

/** A `SteeringLink` → a `DocumentLink`, resolving its target file against `root` — same resolution `toLocation` already does for a foreign `pointerAt` jump. `line` is 0-based; the target URI's `#L<line+1>` fragment names the 1-based line, mirroring a familiar (GitHub-style) file-link convention. */
export const toDocumentLink =
  (root: string) =>
  (link: SteeringLink): DocumentLink => ({
    range: link.range,
    target: `${pathToFileURL(resolvePath(root, link.path)).toString()}#L${link.line + 1}`,
  })

export const documentLinksFor = (
  format: SteeringFormat | undefined,
  content: string,
  root: string,
): DocumentLink[] =>
  format === undefined ? [] : viewOf(format, content).documentLinks.map(toDocumentLink(root))

// ── Path → format dispatch (pure) ───────────────────────────────────────────

/** Fallback for any path the current rest doesn't name. `TODO.md` is intentionally not mapped — the bundled `idle` step declares no `mode` for it. */
export const basenameFallbackFormat = (name: string): SteeringFormat | undefined =>
  name === "REVIEW.md" ? steeringFormatFor("review") : undefined

export type CurrentRest = Pick<BeatDocument, "state" | "file" | "mode">

export const formatForDocument = (
  uri: string,
  rest: CurrentRest | undefined,
  root: string,
): SteeringFormat | undefined => {
  const path = fileURLToPath(uri)
  if (
    rest?.file !== undefined &&
    rest.mode !== undefined &&
    resolvePath(root, rest.file) === path
  ) {
    return steeringFormatFor(rest.mode)
  }
  return basenameFallbackFormat(basename(path))
}

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
 * reject; the service catches every rejection and degrades gracefully.
 */
export interface LspEnv {
  readonly currentRest: (root: string) => Promise<CurrentRest>
  /** The git working-tree root of `dir`, or `undefined` outside any repository. */
  readonly gitTopLevel: (dir: string) => Promise<string | undefined>
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
 * wrapped in a try/catch that degrades gracefully — a failed lookup behaves
 * like a document no rest names (basename dispatch), never a rejected request.
 */
export const makeSteeringLanguageService = (
  env: LspEnv,
  warn: (message: string) => void,
): SteeringLanguageService => {
  let workspaceRoot: string | undefined

  // A repository gtd cannot read (no commits yet) fails the same way on every keystroke.
  let lastWarning: string | undefined
  const warnOnce = (message: string): void => {
    if (message !== lastWarning) warn(message)
    lastWarning = message
  }

  const safeGitTopLevel = async (dir: string): Promise<string | undefined> => {
    try {
      return await env.gitTopLevel(dir)
    } catch {
      return undefined
    }
  }

  const repoRootFor = async (uri: string): Promise<string | undefined> =>
    (await safeGitTopLevel(dirname(fileURLToPath(uri)))) ?? workspaceRoot

  // `gtd next` evaluates the repository's gtd.config.ts, so only the repository
  // the user opened is asked — never one a stray document happens to live in.
  let workspaceRepo: Promise<string> | undefined
  const trusted = async (root: string): Promise<boolean> => {
    if (workspaceRoot === undefined) return true
    const ws = workspaceRoot
    workspaceRepo ??= safeGitTopLevel(ws).then((top) => top ?? ws)
    return root === (await workspaceRepo)
  }

  const formatFor = async (uri: string): Promise<SteeringFormat | undefined> => {
    const root = await repoRootFor(uri)
    if (root === undefined || !(await trusted(root))) {
      return formatForDocument(uri, undefined, "")
    }
    try {
      return formatForDocument(uri, await env.currentRest(root), root)
    } catch (e) {
      warnOnce(
        `failed to read the current rest at "${root}" — falling back to basename dispatch: ${errorText(e)}`,
      )
      return formatForDocument(uri, undefined, root)
    }
  }

  return {
    initialize: (params) => {
      workspaceRoot = resolveWorkspaceRoot(params)
      workspaceRepo = undefined
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
      const format = await formatFor(uri)
      return format === undefined ? [] : viewOf(format, text).outline.map(toDocumentSymbol)
    },

    codeAction: async (uri, text, range) => {
      const format = await formatFor(uri)
      if (format === undefined) return []
      return viewOf(format, text).actionsAt(range).map(toCodeAction(uri, text))
    },

    definition: async (uri, text, position) => {
      const format = await formatFor(uri)
      const pointer = format !== undefined ? viewOf(format, text).pointerAt(position) : undefined
      if (pointer === undefined) return []
      if (pointer.path === undefined) return [toLocation("", uri)(pointer)]
      const root = await repoRootFor(uri)
      return root === undefined ? [] : [toLocation(root, uri)(pointer)]
    },

    diagnostics: async (uri, text) => diagnosticsFor(await formatFor(uri), text),

    documentLink: async (uri, text) => {
      const root = await repoRootFor(uri)
      if (root === undefined) return []
      return documentLinksFor(await formatFor(uri), text, root)
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
      const start = workspaceRoot ?? env.cwd
      // `gtd next` runs only at a repository root, and `file` is relative to it.
      const root = (await safeGitTopLevel(start)) ?? start
      try {
        const { state, file } = await env.currentRest(root)
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

// ── The Node adapter ────────────────────────────────────────────────────────

const run = (command: string, args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout)
      else reject(new Error(stderr.trim() !== "" ? stderr.trim() : error.message))
    })
  })

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

export const parseCurrentRest = (stdout: string): CurrentRest => {
  const parsed = JSON.parse(stdout) as Record<string, unknown> | null
  const state = optionalString(parsed?.["state"])
  if (state === undefined) throw new Error(`not a gtd next --json document: ${stdout}`)
  return { state, file: optionalString(parsed?.["file"]), mode: optionalString(parsed?.["mode"]) }
}

/**
 * The git and gtd reads the server makes. `nodeLspIo` spawns them; an
 * in-memory twin answers from a fake repository, and
 * `tests/tooling/lsp-io.test.ts` holds the two to the same answers.
 */
export interface LspIo {
  readonly cwd: string
  /** `dir`'s working-tree root, keeping `dir`'s own spelling; rejects outside a repository. */
  readonly topLevel: (dir: string) => Promise<string>
  /** HEAD's hash; rejects in a repository without commits. */
  readonly head: (root: string) => Promise<string>
  /** `gtd next --json`'s stdout at `root`; rejects with gtd's stderr on failure. */
  readonly next: (root: string) => Promise<string>
}

/** Process state comes from spawning `gtd` — the same build serving the LSP — the way any driver reads it. */
export const nodeLspIo = (gtd: readonly [string, ...string[]]): LspIo => ({
  cwd: process.cwd(),
  // `--show-cdup`, not `--show-toplevel`: the root keeps `dir`'s own spelling
  // (no symlink resolution), so the URIs built from it match the editor's.
  topLevel: async (dir) =>
    resolvePath(dir, (await run("git", ["rev-parse", "--show-cdup"], dir)).trim()),
  head: async (root) => (await run("git", ["rev-parse", "HEAD"], root)).trim(),
  next: (root) => run(gtd[0], [...gtd.slice(1), "next", "--json"], root),
})

/**
 * A rest only moves when HEAD does, so one `gtd next --json` per root and
 * HEAD serves every request in between — the diagnostics and the outline of
 * the same keystroke included.
 */
export const makeLspEnv = (io: LspIo, retryAfterMs = 5000): LspEnv => {
  const memo = new Map<
    string,
    { readonly head: string; readonly rest: Promise<CurrentRest>; failedAt?: number }
  >()
  return {
    cwd: io.cwd,
    gitTopLevel: (dir) => io.topLevel(dir),
    currentRest: async (root) => {
      const head = await io.head(root).catch(() => "no-head")
      const cached = memo.get(root)
      // A failure is replayed for a while, not forever: most (no commits, a
      // broken gtd.config.ts) persist, so retrying per request would spawn gtd on
      // every keystroke, yet a config fix must still take effect without a commit.
      if (
        cached?.head === head &&
        (cached.failedAt === undefined || Date.now() - cached.failedAt < retryAfterMs)
      ) {
        return cached.rest
      }
      const entry: { head: string; rest: Promise<CurrentRest>; failedAt?: number } = {
        head,
        rest: io.next(root).then(parseCurrentRest),
      }
      memo.set(root, entry)
      entry.rest.catch(() => {
        entry.failedAt = Date.now()
      })
      return entry.rest
    },
  }
}

const serve = (io: LspIo, connection: Connection): Effect.Effect<void> =>
  Effect.gen(function* () {
    const documents = new TextDocuments(TextDocument)
    const warn = (message: string): void => connection.console.warn(`gtd lsp: ${message}`)
    bindSteeringServer(connection, documents, makeSteeringLanguageService(makeLspEnv(io), warn))
    yield* Effect.callback<void>((resume) => {
      connection.onExit(() => resume(Effect.void))
    })
  })

/**
 * The server over a stream pair, inside this process. Wrapped as message
 * reader and writer, so the stream ending never exits the process the way a
 * stdio server's does; `close` ends the connection instead of an `exit`
 * request, whose handler exits the process too.
 */
export const serveLspOver = (
  io: LspIo,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): { readonly close: () => void } => {
  const connection = createConnection(
    ProposedFeatures.all,
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  )
  void Effect.runPromise(serve(io, connection))
  return { close: () => connection.dispose() }
}

/**
 * Starts the `gtd lsp` server over stdio. The returned Effect resolves when
 * the client disconnects (`exit` notification), so the process exits cleanly
 * rather than blocking forever.
 */
export const startLspServer = (options: {
  readonly gtd: readonly [string, ...string[]]
}): Effect.Effect<void, Error> =>
  Effect.suspend(() =>
    serve(
      nodeLspIo(options.gtd),
      createConnection(ProposedFeatures.all, process.stdin, process.stdout),
    ),
  )
