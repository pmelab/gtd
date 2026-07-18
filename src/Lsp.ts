/**
 * LSP server for `.gtd/` steering files — document symbols for open
 * questions (`.gtd/TODO.md`/`.gtd/ARCHITECTURE.md`) and review chunks/hunks
 * (`.gtd/REVIEW.md`), code actions to check/uncheck a hunk or a whole chunk,
 * and a `gtd.openSteeringFile` command that opens whichever steering file
 * matches the current `GtdState`.
 *
 * Split like the rest of the codebase: pure helpers below (symbol/edit
 * building — unit-testable, no protocol/IO), the `vscode-languageserver`
 * wiring at the bottom (the IO edge, analogous to `Events.ts`).
 */

import { pathToFileURL, fileURLToPath } from "node:url"
import { basename, join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect, Runtime } from "effect"
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  CodeActionKind,
  SymbolKind,
  ShowDocumentRequest,
  type CodeAction,
  type CodeActionParams,
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
import {
  gatherEvents,
  TODO_FILE,
  ARCHITECTURE_FILE,
  REVIEW_FILE,
  FEEDBACK_FILE,
  ERRORS_FILE,
  HEALTH_FILE,
  SQUASH_MSG_FILE,
  LEARNINGS_FILE,
} from "./Events.js"
import { resolve, type GtdState } from "./Machine.js"
import { closeReviewWindow, openReviewWindow } from "./ReviewWindow.js"
import { GitService } from "./Git.js"
import { ConfigInit, ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"

export const OPEN_STEERING_FILE_COMMAND = "gtd.openSteeringFile"

/**
 * States mapped to a single fixed steering file. Absent states —
 * `planning`/`building`/`testing` (per-task-file work packages, no single
 * fixed path) and the no-file rests `done`/`idle`/`close-package`/
 * `learning-applied` — fall back to an informational message naming the
 * state instead of guessing a file.
 */
export const STATE_FILE: Partial<Record<GtdState, string>> = {
  grilling: TODO_FILE,
  architecting: ARCHITECTURE_FILE,
  grilled: ARCHITECTURE_FILE,
  fixing: FEEDBACK_FILE,
  "agentic-review": FEEDBACK_FILE,
  escalate: ERRORS_FILE,
  review: REVIEW_FILE,
  "await-review": REVIEW_FILE,
  learning: LEARNINGS_FILE,
  "await-learning-review": LEARNINGS_FILE,
  "learning-apply": LEARNINGS_FILE,
  squashing: SQUASH_MSG_FILE,
  "health-check": HEALTH_FILE,
  "health-fixing": HEALTH_FILE,
}

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

/** Document symbols for `.gtd/TODO.md` / `.gtd/ARCHITECTURE.md`'s open questions. */
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

// ── Protocol adapter ─────────────────────────────────────────────────────────

type SteeringFileOutcome =
  | { readonly kind: "file"; readonly uri: string }
  | { readonly kind: "none"; readonly state: GtdState }

/**
 * Reads the current `GtdState` and maps it to a steering-file URI, exactly
 * mirroring `program.ts`'s own dispatch wrapper (`closeReviewWindow` before
 * `gatherEvents`, `openReviewWindow` re-armed after — see `ReviewWindow.ts`),
 * but scoped to a single on-demand call rather than the whole server's
 * lifetime: `gtd lsp` is long-running, so holding the window closed for as
 * long as the server runs would leave a reviewer's working tree un-rewound
 * (no diff visible) for the entire session.
 */
const currentSteeringFile: Effect.Effect<
  SteeringFileOutcome,
  Error,
  GitService | FileSystem.FileSystem | ConfigService | ConfigInit | Cwd
> = Effect.gen(function* () {
  yield* closeReviewWindow
  yield* (yield* ConfigInit).ensure
  const events = yield* gatherEvents("none")
  const result = yield* Effect.try({
    try: () => resolve(events),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })
  const relativePath = STATE_FILE[result.state]
  if (relativePath === undefined) return { kind: "none" as const, state: result.state }
  const cwd = yield* Cwd
  return { kind: "file" as const, uri: pathToFileURL(join(cwd.root, relativePath)).toString() }
}).pipe(
  Effect.tap(() => openReviewWindow),
  Effect.tapError(() => openReviewWindow.pipe(Effect.ignore)),
)

const documentName = (uri: string): string => basename(fileURLToPath(uri))

/**
 * Starts the `gtd lsp` server over stdio. The returned Effect resolves when
 * the client disconnects (`exit` notification), so the process exits
 * cleanly rather than blocking forever.
 */
export const startLspServer = (): Effect.Effect<
  void,
  Error,
  GitService | FileSystem.FileSystem | ConfigService | ConfigInit | Cwd
> =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<
      GitService | FileSystem.FileSystem | ConfigService | ConfigInit | Cwd
    >()
    const runPromise = Runtime.runPromise(runtime)

    const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
    const documents = new TextDocuments(TextDocument)
    let showDocumentCapable = false

    connection.onInitialize((params: InitializeParams) => {
      showDocumentCapable = params.capabilities.window?.showDocument?.support ?? false
      return {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Incremental,
          documentSymbolProvider: true,
          codeActionProvider: true,
          executeCommandProvider: { commands: [OPEN_STEERING_FILE_COMMAND] },
        },
      }
    })

    connection.onDocumentSymbol((params: DocumentSymbolParams) => {
      const document = documents.get(params.textDocument.uri)
      if (!document) return []
      switch (documentName(document.uri)) {
        case "TODO.md":
        case "ARCHITECTURE.md":
          return questionSymbols(document.getText())
        case "REVIEW.md":
          return reviewSymbols(document.getText())
        default:
          return []
      }
    })

    connection.onCodeAction((params: CodeActionParams) => {
      const document = documents.get(params.textDocument.uri)
      if (!document || documentName(document.uri) !== "REVIEW.md") return []
      return reviewCodeActions(document.uri, document.getText(), params.range)
    })

    connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
      if (params.command !== OPEN_STEERING_FILE_COMMAND) return
      try {
        const outcome = await runPromise(currentSteeringFile)
        if (outcome.kind === "none") {
          connection.window.showInformationMessage(
            `gtd: no single steering file for state "${outcome.state}"`,
          )
          return
        }
        if (showDocumentCapable) {
          await connection.sendRequest(ShowDocumentRequest.type, {
            uri: outcome.uri,
            takeFocus: true,
          })
        } else {
          connection.window.showInformationMessage(`gtd: steering file is ${outcome.uri}`)
        }
      } catch (error) {
        connection.window.showErrorMessage(
          `gtd: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })

    documents.listen(connection)
    connection.listen()

    yield* Effect.async<void>((resume) => {
      connection.onExit(() => resume(Effect.void))
    })
  })
