/**
 * LSP server for `.gtd/` steering files — document symbols for `.gtd/TODO.md`'s
 * open questions and `.gtd/REVIEW.md`'s review chunks/hunks, code actions to
 * check/uncheck a hunk or a whole chunk, and diagnostics publishing the same
 * parsers' `errors` the bundled workflow's `.gtd/FORMAT.md` validators produce
 * (see `src/OpenQuestions.ts` / `src/ReviewDoc.ts`'s module docs for the
 * "executable spec ↔ bash validator" contract this server rides on top of).
 *
 * Keyed on FILE NAME, not workflow state — v3 is intentionally engine-agnostic
 * about what any given state means (a state names no file; see
 * `docs/design/steering-file-loops.md` §6), so this server needs no
 * git/config/workflow dependency at all: it serves whatever `.gtd/TODO.md` /
 * `.gtd/REVIEW.md` content the editor hands it over the LSP protocol, exactly
 * like it would for any other document. The v2 `gtd.openSteeringFile` command
 * and its hardcoded state→file map are NOT restored — a v3 workflow declares
 * no such mapping (see §6 of the plan above for why this is out of scope for
 * now).
 *
 * Split like the rest of the codebase: pure helpers below (symbol/edit/
 * diagnostic building — unit-testable, no protocol/IO), the
 * `vscode-languageserver` wiring at the bottom (the IO edge).
 */

import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
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
  type InitializeParams,
  type Range,
  type TextEdit,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { parseOpenQuestions, type OpenQuestion } from "./OpenQuestions.js"
import { parseReviewDoc, type ReviewFile, FILE_POINTER_RE } from "./ReviewDoc.js"

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

// ── Protocol adapter ─────────────────────────────────────────────────────────

const documentName = (uri: string): string => basename(fileURLToPath(uri))

/**
 * Publishes diagnostics for one document, dispatching on file name — the same
 * dispatch `onDocumentSymbol` below uses. A file gtd doesn't recognize (or a
 * document with zero findings) gets an empty diagnostics list, which clears
 * any diagnostics a client is still showing for it.
 */
const diagnosticsFor = (name: string, content: string): Diagnostic[] => {
  switch (name) {
    case "TODO.md":
      return questionDiagnostics(content)
    case "REVIEW.md":
      return reviewDiagnostics(content)
    default:
      return []
  }
}

/**
 * Starts the `gtd lsp` server over stdio. No git/config/workflow dependency —
 * this server is keyed on file name, not any particular workflow's state, so
 * it needs no `Effect` requirements at all. The returned Effect resolves when
 * the client disconnects (`exit` notification), so the process exits cleanly
 * rather than blocking forever.
 */
export const startLspServer = (): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
    const documents = new TextDocuments(TextDocument)

    connection.onInitialize((_params: InitializeParams) => ({
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentSymbolProvider: true,
        codeActionProvider: true,
      },
    }))

    connection.onDocumentSymbol((params: DocumentSymbolParams) => {
      const document = documents.get(params.textDocument.uri)
      if (!document) return []
      switch (documentName(document.uri)) {
        case "TODO.md":
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

    const publishDiagnostics = (uri: string, content: string): void => {
      connection.sendDiagnostics({ uri, diagnostics: diagnosticsFor(documentName(uri), content) })
    }

    documents.onDidOpen((change) =>
      publishDiagnostics(change.document.uri, change.document.getText()),
    )
    documents.onDidChangeContent((change) =>
      publishDiagnostics(change.document.uri, change.document.getText()),
    )

    documents.listen(connection)
    connection.listen()

    yield* Effect.async<void>((resume) => {
      connection.onExit(() => resume(Effect.void))
    })
  })
