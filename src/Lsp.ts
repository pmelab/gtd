/**
 * LSP server for `.gtd/` steering files — document symbols for a `qa`-mode
 * file's open questions and a `review`-mode file's review chunks/hunks, code
 * actions to check/uncheck a hunk or a whole chunk, go-to-definition from a
 * `review`-mode hunk line into the file it points at, and diagnostics
 * publishing the same parsers' `errors` the `gtd validate` CLI command reports
 * (see `src/OpenQuestions.ts` / `src/ReviewDoc.ts`'s module docs — those
 * parsers are each format's single source of truth, shared by this server and
 * the command).
 *
 * GO-TO-DEFINITION (`textDocument/definition`, `review`-mode only): the cursor
 * on a hunk pointer line (`- [ ] ./src/foo.ts#42`) jumps to `./src/foo.ts` at
 * line 42 (`hunkDefinitionLocation`). The `./`-relative path resolves against
 * the git toplevel of the file's own directory (`tryGitTopLevel`), falling
 * back to the workspace root — never the document's own `.gtd/` directory — so
 * a repo-root-relative diff path lands correctly even with no workspace folder
 * open; no target is returned when neither anchor resolves. The `#line` is
 * 1-based (a bare `./path` lands at the top of the file); the target file is
 * not stat-ed, so a stale pointer still jumps and the editor reports the miss.
 *
 * CONFIG-DRIVEN: the server
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
 * dispatch (`REVIEW.md` → `review`), so the server still works standalone with
 * no `.gtdrc` in sight. (`.gtd/TODO.md` is NOT dispatched by basename — the
 * bundled template's simple flow iterates on a free-form plan there, not a
 * `qa`-format file; a custom workflow that wants qa validation on TODO.md
 * declares it with `file:`+`mode: qa`, which the config-driven map covers.)
 *
 * KNOWN LIMITATION — this server understands only the two VALIDATOR built-in
 * modes (`qa`/`review`, whose parsers it owns). A workflow-declared mode (a
 * `modes:` entry, whose validation is a shell command — see
 * `src/SteeringMode.ts`) — and the third built-in, `prose` (a format-only
 * name with no in-process parser — see `PatternMachine.isKnownBuiltInMode`) —
 * dispatches to no symbols, no code actions, and an empty diagnostic list: gtd
 * never runs a mode's command per keystroke over an unsaved buffer. Such a
 * file is still formatted and validated by `gtd validate` and the `gtd step`
 * capture gate, just not live in the editor.
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
 * bottom (the IO edge, including the git/config Effect layers `loadModeMap`/
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
  type DefinitionParams,
  type Diagnostic,
  type DocumentSymbol,
  type DocumentSymbolParams,
  type ExecuteCommandParams,
  type InitializeParams,
  type Location,
  type Range,
  type TextEdit,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { parseOpenQuestions, type OpenQuestion, type QuestionOption } from "./OpenQuestions.js"
import { parseReviewDoc, FILE_POINTER_RE } from "./ReviewDoc.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
import { RepoFiles } from "./RepoFiles.js"
import { currentRest } from "./Edge.js"
import type { StateMode, WorkflowDefinition } from "./PatternMachine.js"
import { renderStateTemplate, varsOnlyContext } from "./PatternTemplates.js"

// ── Pure helpers ─────────────────────────────────────────────────────────────

const lineRange = (lines: readonly string[], line: number): Range => ({
  start: { line, character: 0 },
  end: { line, character: (lines[line] ?? "").length },
})

const spanRange = (lines: readonly string[], startLine: number, endLine: number): Range => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: (lines[endLine] ?? "").length },
})

/**
 * The outline marker for one question. Answered-section questions are
 * `[answered]`. An OPEN question is `[answered]` once exactly one option is
 * ticked (see `OpenQuestion.answered`) and `[unanswered]` otherwise — so the
 * `[unanswered]` entries are exactly the questions still blocking the
 * answer-completeness gate, navigable straight from the outline.
 */
const statusMarker = (question: OpenQuestion): string => {
  if (question.status === "answered") return "[answered]"
  return question.answered ? "[answered]" : "[unanswered]"
}

/** Document symbols for a `qa`-mode file's open/answered questions (each option a navigable child of an open question). */
export const questionSymbols = (content: string): DocumentSymbol[] => {
  const { questions } = parseOpenQuestions(content)
  const lines = content.split(/\r?\n/)
  return questions.map((question, i) => {
    const start = question.headingLine
    const end = Math.max(start, (questions[i + 1]?.headingLine ?? lines.length) - 1)
    const children: DocumentSymbol[] = question.options.map((option) => ({
      name: `${option.checked ? "[x]" : "[ ]"} ${option.text || "your answer"}`,
      kind: SymbolKind.Boolean,
      range: spanRange(lines, option.sourceLine, option.endLine),
      selectionRange: lineRange(lines, option.sourceLine),
    }))
    return {
      name: `${statusMarker(question)} ${question.question}`,
      detail: question.text,
      kind: SymbolKind.Boolean,
      range: spanRange(lines, start, end),
      selectionRange: lineRange(lines, start),
      ...(children.length > 0 ? { children } : {}),
    }
  })
}

/** Diagnostics for `.gtd/TODO.md` — the same findings `gtd validate` reports for a `qa`-mode file, published live over LSP instead. Whole-document range: `OpenQuestionsDoc.errors` carries no per-line position. */
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

/** Document symbols for `.gtd/REVIEW.md`: only the headlines of chunks (the user-facing "work packages") that still carry at least one unchecked hunk — the outline is the list of packages left to review, nothing else. */
export const reviewSymbols = (content: string): DocumentSymbol[] => {
  const { changesets } = parseReviewDoc(content)
  const lines = content.split(/\r?\n/)
  return changesets
    .map((chunk, i) => {
      const start = chunk.headingLine
      const end = Math.max(start, (changesets[i + 1]?.headingLine ?? lines.length) - 1)
      const checkedCount = chunk.files.filter((file) => file.checked).length
      return {
        name: `${chunk.title} (${checkedCount}/${chunk.files.length})`,
        kind: SymbolKind.Package,
        range: spanRange(lines, start, end),
        selectionRange: lineRange(lines, start),
        unchecked: checkedCount < chunk.files.length,
      }
    })
    .filter((symbol) => symbol.unchecked)
    .map(({ unchecked: _unchecked, ...symbol }) => symbol)
}

/** Diagnostics for `.gtd/REVIEW.md` — the same findings `gtd validate` reports for a `review`-mode file, published live over LSP instead. Whole-document range: `ReviewDoc.errors` carries no per-line position. */
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

/** Flips the `[ ]`/`[x]` box of the checkbox on line `line`, preserving the rest of the line exactly. `undefined` when the line has no checkbox. */
export const toggleOptionEdit = (content: string, line: number): TextEdit | undefined => {
  const raw = content.split(/\r?\n/)[line]
  if (raw === undefined) return undefined
  const match = /\[([ xX])\]/.exec(raw)
  if (!match) return undefined
  const character = match.index + 1
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    newText: match[1] === " " ? "x" : " ",
  }
}

/** The edits that make `option` the sole ticked option in `question` (radio semantics): check it, and uncheck any already-ticked sibling — so the question ends with exactly one tick (what the completeness gate wants). */
const pickOptionEdits = (
  content: string,
  question: OpenQuestion,
  option: QuestionOption,
): TextEdit[] => {
  const edits: TextEdit[] = []
  for (const sibling of question.options) {
    if (sibling.sourceLine !== option.sourceLine && !sibling.checked) continue
    const edit = toggleOptionEdit(content, sibling.sourceLine)
    if (edit) edits.push(edit)
  }
  return edits
}

/** The single code action for the option line the cursor sits on: uncheck it if ticked, else pick it (radio). `undefined` when there is no edit to make. */
const optionCodeAction = (
  uri: string,
  content: string,
  question: OpenQuestion,
  option: QuestionOption,
): CodeAction | undefined => {
  const edits = option.checked
    ? [toggleOptionEdit(content, option.sourceLine)].filter((e): e is TextEdit => e !== undefined)
    : pickOptionEdits(content, question, option)
  if (edits.length === 0) return undefined
  return {
    title: option.checked ? "gtd: uncheck this option" : "gtd: pick this option",
    kind: CodeActionKind.QuickFix,
    edit: { changes: { [uri]: edits } },
  }
}

/**
 * Code actions for a `qa`-mode file: anywhere on an open question's option's
 * list item — its `- [ ]` line or any of its wrapped continuation lines (see
 * `QuestionOption.endLine`) — "pick this option" (radio semantics — check it
 * and uncheck every sibling in the same question, so exactly one stays
 * ticked) or "uncheck this option" when it is already the chosen one. No
 * action off an option's span, or on an answered-section (prose) question.
 */
export const questionCodeActions = (uri: string, content: string, range: Range): CodeAction[] => {
  const { questions } = parseOpenQuestions(content)
  const cursorLine = range.start.line
  const actions: CodeAction[] = []
  for (const question of questions) {
    if (question.status !== "open") continue
    const option = question.options.find(
      (o) => cursorLine >= o.sourceLine && cursorLine <= o.endLine,
    )
    if (!option) continue
    const action = optionCodeAction(uri, content, question, option)
    if (action) actions.push(action)
  }
  return actions
}

/**
 * Go-to-definition target for a `.gtd/REVIEW.md` hunk line: the file the hunk
 * pointer at `line` (0-based, `params.position.line`) points into. `root` is
 * the repo the `./`-relative hunk paths were authored against (the git
 * toplevel of REVIEW.md's directory — see `resolveDefinitionRoot`). Returns
 * `undefined` when `line` isn't a parsed hunk pointer (a heading, prose, or a
 * malformed line has no `sourceLine`), so the provider yields no target there.
 *
 * The `#line` in a pointer is 1-based (git/human line numbers); LSP positions
 * are 0-based, so it maps to `line - 1`. A bare `./path` with no `#line` lands
 * at the top of the file (line 0). The range is collapsed (a cursor, not a
 * selection) and the target file is NOT stat-ed — a stale/deleted/`../`-escaping
 * path still returns a Location and the editor reports the miss itself. Pure —
 * no git, no protocol, unit-testable directly.
 */
export const hunkDefinitionLocation = (
  content: string,
  line: number,
  root: string,
): Location | undefined => {
  const { changesets } = parseReviewDoc(content)
  const hunk = changesets.flatMap((chunk) => chunk.files).find((file) => file.sourceLine === line)
  if (!hunk) return undefined
  const targetLine = hunk.line !== undefined ? hunk.line - 1 : 0
  return {
    uri: pathToFileURL(resolvePath(root, hunk.path)).toString(),
    range: {
      start: { line: targetLine, character: 0 },
      end: { line: targetLine, character: 0 },
    },
  }
}

// ── Config-driven path→mode dispatch (pure) ─────────────────────────────────

/** The basename dispatch this server has always had — the fallback for any path the active workflow's `file:` map doesn't cover (or when no config resolves at all). `TODO.md` is intentionally NOT mapped: the bundled template's simple flow now iterates on a free-form plan there, not a `qa`-format file. */
export const basenameFallbackMode = (name: string): StateMode | undefined => {
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

/** Diagnostics for one document, dispatching on its resolved `mode` — the same dispatch `onDocumentSymbol`/`onCodeAction` below use. No mode (an unrecognized path, config or no) — or a workflow-declared mode this server has no parser for (see the module docstring's limitation) — publishes an empty list, clearing any diagnostics a client is still showing for it. */
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
      ConfigService.pipe(
        Effect.flatMap((c) => c.load),
        Effect.provide(configLayerForRoot(root)),
      ),
    )
    const vars = mergeStaticVars(config.workflowVars, config.rcVars, process.env)
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
 * The git working-tree root of `dir` (`git rev-parse --show-toplevel`), or
 * `undefined` when `dir` is outside any repository. This is the anchor a
 * hunk's `./`-relative path resolves against — the repo the review diff's
 * paths were authored against (`GitService.topLevel()`, the same op the CLI
 * uses). Any failure resolves to `undefined` so the caller can fall back to
 * the workspace root.
 */
const tryGitTopLevel = async (dir: string): Promise<string | undefined> => {
  try {
    return await Effect.runPromise(
      GitService.pipe(
        Effect.flatMap((git) => git.topLevel()),
        Effect.provide(gitLayerForRoot(dir)),
      ),
    )
  } catch {
    return undefined
  }
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
          definitionProvider: true,
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
      switch (modeForDocument(document.uri, map)) {
        case "review":
          return reviewCodeActions(document.uri, document.getText(), params.range)
        case "qa":
          return questionCodeActions(document.uri, document.getText(), params.range)
        default:
          return []
      }
    })

    connection.onDefinition(async (params: DefinitionParams) => {
      const document = documents.get(params.textDocument.uri)
      if (!document) return []
      const map = await loadModeMap(rootFor(document.uri), warn)
      if (modeForDocument(document.uri, map) !== "review") return []
      const root = (await tryGitTopLevel(dirname(fileURLToPath(document.uri)))) ?? workspaceRoot
      if (root === undefined) return []
      return hunkDefinitionLocation(document.getText(), params.position.line, root) ?? []
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
