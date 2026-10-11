import { execFileSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  basenameFallbackFormat,
  bindSteeringServer,
  diagnosticsFor,
  formatForDocument,
  makeNodeLspEnv,
  makeSteeringLanguageService,
  parseCurrentRest,
  resolveWorkspaceRoot,
  startLspServer,
  steeringFileOutcome,
  documentLinksFor,
  toCodeAction,
  toDocumentLink,
  toDocumentSymbol,
  toLocation,
  type CurrentRest,
  type ExecuteCommandOutcome,
  type LspEnv,
  type SteeringConnection,
  type SteeringDocuments,
  type SteeringLanguageService,
} from "./Lsp.js"
import {
  DiagnosticSeverity,
  TextDocumentSyncKind,
  type Diagnostic,
} from "vscode-languageserver/node"
import { steeringFormatFor } from "../steering/index.js"

const QA_FORMAT = steeringFormatFor("qa")!
const REVIEW_FORMAT = steeringFormatFor("review")!

describe("basenameFallbackFormat", () => {
  it("maps REVIEW.md to the built-in `review` format, and anything else (including TODO.md) to undefined", () => {
    expect(basenameFallbackFormat("REVIEW.md")).toBe(REVIEW_FORMAT)
    expect(basenameFallbackFormat("TODO.md")).toBeUndefined()
    expect(basenameFallbackFormat("NOTES.md")).toBeUndefined()
  })
})

describe("formatForDocument", () => {
  const rest = (file?: string, mode?: string): CurrentRest => ({ state: "s", file, mode })

  it("gives the rest's own file the built-in format its mode names", () => {
    expect(formatForDocument("file:///repo/PLAN.md", rest("PLAN.md", "qa"), "/repo")).toBe(
      QA_FORMAT,
    )
  })

  it("falls back to basename dispatch for any other path", () => {
    const r = rest("PLAN.md", "qa")
    expect(formatForDocument("file:///repo/.gtd/REVIEW.md", r, "/repo")).toBe(REVIEW_FORMAT)
    expect(formatForDocument("file:///repo/.gtd/TODO.md", r, "/repo")).toBeUndefined()
    expect(formatForDocument("file:///repo/NOTES.md", undefined, "/repo")).toBeUndefined()
  })

  it("gives no format to a mode with no built-in format, or a rest with no mode", () => {
    expect(formatForDocument("file:///repo/adr.md", rest("adr.md", "adr"), "/repo")).toBeUndefined()
    expect(formatForDocument("file:///repo/PLAN.md", rest("PLAN.md"), "/repo")).toBeUndefined()
  })
})

describe("parseCurrentRest", () => {
  it("reads state, file and mode off a gtd next --json document, ignoring the rest", () => {
    expect(
      parseCurrentRest(
        '{"schema":1,"kind":"capture","state":"grilling","file":".gtd/TODO.md","mode":"qa"}',
      ),
    ).toEqual({ state: "grilling", file: ".gtd/TODO.md", mode: "qa" })
    expect(parseCurrentRest('{"state":"idle"}')).toEqual({
      state: "idle",
      file: undefined,
      mode: undefined,
    })
  })

  it("rejects a document with no state", () => {
    expect(() => parseCurrentRest('{"kind":"capture"}')).toThrow(/not a gtd next --json document/)
    expect(() => parseCurrentRest("null")).toThrow(/not a gtd next --json document/)
  })
})

describe("resolveWorkspaceRoot", () => {
  it("prefers the first workspaceFolders entry", () => {
    expect(
      resolveWorkspaceRoot({
        workspaceFolders: [{ uri: "file:///repo" }, { uri: "file:///other" }],
        rootUri: "file:///deprecated",
      }),
    ).toBe("/repo")
  })

  it("falls back to the deprecated rootUri when workspaceFolders is absent", () => {
    expect(resolveWorkspaceRoot({ rootUri: "file:///repo" })).toBe("/repo")
  })

  it("is undefined when neither is present", () => {
    expect(resolveWorkspaceRoot({})).toBeUndefined()
    expect(resolveWorkspaceRoot({ workspaceFolders: null, rootUri: null })).toBeUndefined()
  })
})

describe("steeringFileOutcome", () => {
  it("resolves a declared `file:` to a `file://` URI under root", () => {
    const outcome = steeringFileOutcome("grilling", ".gtd/TODO.md", "/repo")
    expect(outcome).toEqual({ kind: "show", uri: "file:///repo/.gtd/TODO.md" })
  })

  it("informs, naming the state, when no `file:` is declared", () => {
    const outcome = steeringFileOutcome("idle", undefined, "/repo")
    expect(outcome).toEqual({ kind: "inform", state: "idle" })
  })
})

describe("toDocumentSymbol", () => {
  it("maps a leaf outline node to SymbolKind.Boolean, a container to SymbolKind.Package, recursing into children", () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }
    const symbol = toDocumentSymbol({
      name: "container",
      detail: "a detail",
      range,
      selectionRange: range,
      children: [{ name: "leaf", range, selectionRange: range, leaf: true }],
    })
    expect(symbol.kind).toBe(4) // SymbolKind.Package
    expect(symbol.detail).toBe("a detail")
    expect(symbol.children).toHaveLength(1)
    expect(symbol.children?.[0]?.kind).toBe(17) // SymbolKind.Boolean
    expect(symbol.children?.[0]?.children).toBeUndefined()
  })
})

describe("toCodeAction", () => {
  it("scopes a SteeringAction's edits to the given uri as a QuickFix", () => {
    const edit = {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
      newText: "x",
    }
    const action = toCodeAction(
      "file:///repo/REVIEW.md",
      "a\n",
    )({
      title: "gtd: check this hunk",
      edits: [edit],
    })
    expect(action.title).toBe("gtd: check this hunk")
    expect(action.edit?.changes?.["file:///repo/REVIEW.md"]).toEqual([edit])
  })

  it("every non-footnote action's CodeAction carries no command field at all", () => {
    const edit = {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
      newText: "x",
    }
    const action = toCodeAction(
      "file:///repo/REVIEW.md",
      "a\n",
    )({
      title: "gtd: check this hunk",
      edits: [edit],
    })
    expect(action.command).toBeUndefined()
  })

  it("attaches gtd.revealPosition to the footnote action, with content 'a' (no trailing newline) landing on line 1", () => {
    const markerEdit = {
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
      newText: "[^fn1]",
    }
    const definitionEdit = {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
      newText: "\n[^fn1]:\n",
    }
    const action = toCodeAction(
      "file:///repo/REVIEW.md",
      "a",
    )({
      title: "gtd: add a footnote",
      edits: [markerEdit, definitionEdit],
    })
    expect(action.command).toEqual({
      title: "gtd: add a footnote",
      command: "gtd.revealPosition",
      arguments: ["file:///repo/REVIEW.md", { line: 1, character: 7 }],
    })
  })

  it("with content 'a\\n' (a real trailing newline), the reveal position lands on line 2", () => {
    const markerEdit = {
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
      newText: "[^fn1]",
    }
    const definitionEdit = {
      range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
      newText: "\n[^fn1]:\n\n",
    }
    const action = toCodeAction(
      "file:///repo/REVIEW.md",
      "a\n",
    )({
      title: "gtd: add a footnote",
      edits: [markerEdit, definitionEdit],
    })
    expect(action.command?.arguments?.[1]).toEqual({ line: 2, character: 7 })
  })

  it("a footnote action whose edits carry no matching definition edit gains no command, rather than throwing", () => {
    const edit = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "unrelated",
    }
    expect(() =>
      toCodeAction(
        "file:///repo/REVIEW.md",
        "a",
      )({
        title: "gtd: add a footnote",
        edits: [edit],
      }),
    ).not.toThrow()
    const action = toCodeAction(
      "file:///repo/REVIEW.md",
      "a",
    )({
      title: "gtd: add a footnote",
      edits: [edit],
    })
    expect(action.command).toBeUndefined()
  })
})

describe("toLocation", () => {
  it("resolves a SteeringPointer's path against root into a collapsed-range Location", () => {
    const location = toLocation(
      "/repo",
      "file:///repo/REVIEW.md",
    )({ path: "./src/calc.ts", line: 4 })
    expect(location.uri).toBe("file:///repo/src/calc.ts")
    expect(location.range.start).toEqual({ line: 4, character: 0 })
    expect(location.range.end).toEqual({ line: 4, character: 0 })
  })

  it("uses the document's own URI when the pointer's path is absent (a same-document footnote jump)", () => {
    const location = toLocation("/repo", "file:///repo/PLAN.md")({ line: 9, character: 3 })
    expect(location.uri).toBe("file:///repo/PLAN.md")
    expect(location.range.start).toEqual({ line: 9, character: 3 })
    expect(location.range.end).toEqual({ line: 9, character: 3 })
  })

  it("defaults an absent character to column 0", () => {
    const location = toLocation("/repo", "file:///repo/PLAN.md")({ line: 9 })
    expect(location.range.start).toEqual({ line: 9, character: 0 })
  })
})

describe("toDocumentLink", () => {
  it("resolves a SteeringLink's path against root, appending the 1-based line as a #L fragment", () => {
    const link = toDocumentLink("/repo")({
      range: { start: { line: 5, character: 6 }, end: { line: 5, character: 18 } },
      path: "./src/a.ts",
      line: 0,
    })
    expect(link.range).toEqual({
      start: { line: 5, character: 6 },
      end: { line: 5, character: 18 },
    })
    expect(link.target).toBe("file:///repo/src/a.ts#L1")
  })
})

describe("documentLinksFor", () => {
  it("returns one link per hunk pointer for a review-mode document", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#1",
      "",
    ].join("\n")
    const links = documentLinksFor(REVIEW_FORMAT, content, "/repo")
    expect(links).toEqual([
      {
        range: { start: { line: 5, character: 6 }, end: { line: 5, character: 18 } },
        target: "file:///repo/src/a.ts#L1",
      },
    ])
  })

  it("does not turn a footnote marker inside a hunk's inline note into a document link", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#1 — see docs[^fn1]",
      "",
      "[^fn1]: details",
      "",
    ].join("\n")
    const links = documentLinksFor(REVIEW_FORMAT, content, "/repo")
    // Exactly one link — the pointer token itself, never the `[^fn1]` marker
    // sitting later in the same note.
    expect(links).toEqual([
      {
        range: { start: { line: 5, character: 6 }, end: { line: 5, character: 18 } },
        target: "file:///repo/src/a.ts#L1",
      },
    ])
  })

  it("a bare pointer with no '#line' lands the link at line 0", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts",
      "",
    ].join("\n")
    const links = documentLinksFor(REVIEW_FORMAT, content, "/repo")
    expect(links).toEqual([
      {
        range: { start: { line: 5, character: 6 }, end: { line: 5, character: 16 } },
        target: "file:///repo/src/a.ts#L1",
      },
    ])
  })

  it("a '#42-70' range pointer's link targets the START line, with a range covering the whole token including the '-70' tail", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#42-70",
      "",
    ].join("\n")
    const links = documentLinksFor(REVIEW_FORMAT, content, "/repo")
    expect(links).toEqual([
      {
        range: { start: { line: 5, character: 6 }, end: { line: 5, character: 22 } },
        target: "file:///repo/src/a.ts#L42",
      },
    ])
  })

  it("returns none for a qa-mode document — qa declares no documentLinks member", () => {
    const content = ["## Open Questions", "", "### Which API?", "", "- [ ] REST", ""].join("\n")
    expect(documentLinksFor(QA_FORMAT, content, "/repo")).toEqual([])
  })

  it("returns none for a document with no format", () => {
    expect(documentLinksFor(undefined, "anything", "/repo")).toEqual([])
  })
})

describe("diagnosticsFor open threads", () => {
  const doc = [
    "## Open Questions",
    "",
    "### Which?",
    "",
    "- [ ] A [^t1]",
    "",
    "[^t1]:",
    "    - H: why",
    "    - A: because",
    "",
  ].join("\n")

  it("one Information diagnostic on the last entry", () => {
    const d = diagnosticsFor(QA_FORMAT, doc)
    expect(d).toHaveLength(1)
    expect(d[0]?.severity).toBe(DiagnosticSeverity.Information)
    expect(d[0]?.range.start.line).toBe(8)
  })

  it("none while waiting on the agent", () => {
    expect(diagnosticsFor(QA_FORMAT, doc.replace("    - A: because\n", ""))).toEqual([])
  })

  it("malformed thread findings stay Warnings", () => {
    const bad = doc.replace("    - H: why", "    - A: why")
    const d = diagnosticsFor(QA_FORMAT, bad)
    expect(d.some((x) => x.severity === DiagnosticSeverity.Warning)).toBe(true)
  })
})

describe("toCodeAction reply reveal", () => {
  it("lands the cursor right after '- H: '", () => {
    const action = toCodeAction(
      "file:///x.md",
      "a\nb",
    )({
      title: "gtd: reply",
      edits: [
        {
          range: { start: { line: 5, character: 9 }, end: { line: 5, character: 9 } },
          newText: "\r\n    - H: ",
        },
      ],
    })
    expect(action.command?.arguments).toEqual(["file:///x.md", { line: 6, character: 9 }])
  })
})

describe("diagnosticsFor", () => {
  it("publishes a built-in format's own validate findings", () => {
    const malformed = ["## Open Questions", "", "###", "", "no question text.", ""].join("\n")
    const diagnostics = diagnosticsFor(QA_FORMAT, malformed)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("has no question text")
    expect(diagnostics[0]?.severity).toBe(2) // DiagnosticSeverity.Warning
  })

  it("publishes nothing for a document with no format", () => {
    expect(diagnosticsFor(undefined, "anything")).toEqual([])
  })

  it("underlines exactly the second pointer token for a positioned review finding, not the whole line", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./src/thing.ts#1-1 — ./src/other.ts#2",
      "",
    ].join("\n")
    const diagnostics = diagnosticsFor(REVIEW_FORMAT, content)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("starts with a second pointer")
    // The finding's own range (the second pointer token, `./src/other.ts#2`)
    // hands straight through — never re-derived as the whole line.
    expect(diagnostics[0]?.range).toEqual({
      start: { line: 5, character: 27 },
      end: { line: 5, character: 43 },
    })
  })

  it("underlines the offending heading, not the whole document, for a section-order finding", () => {
    const content = [
      "## Answered Questions",
      "",
      "### Already resolved?",
      "",
      "Yes.",
      "",
      "## Notes",
      "",
      "some notes.",
      "",
    ].join("\n")
    const diagnostics = diagnosticsFor(QA_FORMAT, content)
    const ordering = diagnostics.find((d) => String(d.message).includes("must come last"))
    expect(ordering?.range).toEqual({
      start: { line: 6, character: 0 },
      end: { line: 6, character: "## Notes".length },
    })
  })

  it("underlines the wrong first block node for a missing-header finding, when the document has one", () => {
    const content = [
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./src/thing.ts#1",
      "",
    ].join("\n")
    const diagnostics = diagnosticsFor(REVIEW_FORMAT, content)
    const headerFinding = diagnostics.find((d) => String(d.message).includes("# Review: <hash>"))
    expect(headerFinding?.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: "<!-- base: abc1234def5678901234567890123456789abcd -->".length },
    })
  })

  it("spans the whole document for a genuinely positionless finding (a missing base comment)", () => {
    const content = [
      "# Review: abc1234",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./src/thing.ts#1",
      "",
    ].join("\n")
    const lines = content.split("\n")
    const diagnostics = diagnosticsFor(REVIEW_FORMAT, content)
    const baseFinding = diagnostics.find((d) => String(d.message).includes("base: <hash>"))
    expect(baseFinding?.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: lines.length - 1, character: lines[lines.length - 1]!.length },
    })
  })
})

const fakeEnv = (overrides: Partial<LspEnv> = {}): LspEnv => ({
  currentRest: async () => ({ state: "idle", file: undefined, mode: undefined }),
  gitTopLevel: async () => undefined,
  cwd: "/cwd",
  ...overrides,
})

/** A repository at `/repo` resting on a step that declares `file`/`mode`. */
const mapped = (file: string, mode: string): Partial<LspEnv> => ({
  currentRest: async () => ({ state: "working", file, mode }),
  gitTopLevel: async () => "/repo",
})

describe("makeSteeringLanguageService", () => {
  const questionsDoc = ["## Open Questions", "", "### Which API?", "", "- [ ] REST", ""].join("\n")
  const reviewDoc = [
    "# Review: abc1234",
    "<!-- base: abc1234def5678901234567890123456789abcd -->",
    "",
    "## Chunk",
    "",
    "- [ ] ./src/a.ts#1",
    "",
  ].join("\n")

  it("returns outline symbols for a mapped document, and none for an unmapped one", async () => {
    const env = fakeEnv({ ...mapped("PLAN.md", "qa") })
    const service = makeSteeringLanguageService(env, () => {})
    const symbols = await service.documentSymbol("file:///repo/PLAN.md", questionsDoc)
    expect(symbols.length).toBeGreaterThan(0)
    const unmapped = await service.documentSymbol("file:///repo/OTHER.md", questionsDoc)
    expect(unmapped).toEqual([])
  })

  it("dispatches an unmapped REVIEW.md via the basename fallback", async () => {
    const service = makeSteeringLanguageService(fakeEnv(), () => {})
    const symbols = await service.documentSymbol("file:///repo/REVIEW.md", reviewDoc)
    expect(symbols.map((s) => s.name)).toContain("Chunk (0/1)")
  })

  it("initialize records the workspace root and advertises the server's capabilities", () => {
    const service = makeSteeringLanguageService(fakeEnv(), () => {})
    const result = service.initialize({
      processId: null,
      rootUri: "file:///repo",
      capabilities: {},
    } as never)
    expect(result.capabilities.textDocumentSync).toBe(TextDocumentSyncKind.Incremental)
    expect(result.capabilities.documentSymbolProvider).toBe(true)
    expect(result.capabilities.codeActionProvider).toBe(true)
    expect(result.capabilities.definitionProvider).toBe(true)
    expect(result.capabilities.documentLinkProvider).toEqual({ resolveProvider: false })
    expect(result.capabilities.executeCommandProvider).toEqual({
      commands: ["gtd.openSteeringFile", "gtd.revealPosition"],
    })
  })

  it("codeAction maps a mapped document's actions, and returns none for an unmapped one", async () => {
    const env = fakeEnv({ ...mapped("REVIEW.md", "review") })
    const service = makeSteeringLanguageService(env, () => {})
    const range = { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } }
    const actions = await service.codeAction("file:///repo/REVIEW.md", reviewDoc, range)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions[0]?.edit?.changes?.["file:///repo/REVIEW.md"]).toBeDefined()
    const unmapped = await service.codeAction("file:///repo/OTHER.md", reviewDoc, range)
    expect(unmapped).toEqual([])
  })

  it("definition swallows a rejecting gitTopLevel and falls back to the workspace root", async () => {
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel: () => Promise.reject(new Error("not a git repo")),
    })
    const service = makeSteeringLanguageService(env, () => {})
    service.initialize({ rootUri: "file:///repo", capabilities: {} } as never)
    const locations = await service.definition("file:///repo/REVIEW.md", reviewDoc, {
      line: 5,
      character: 0,
    })
    expect(locations).toEqual([{ uri: "file:///repo/src/a.ts", range: expect.anything() }])
  })

  it("definition returns nothing when neither gitTopLevel nor the workspace root resolves", async () => {
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel: async () => undefined,
    })
    const service = makeSteeringLanguageService(env, () => {})
    const locations = await service.definition("file:///repo/REVIEW.md", reviewDoc, {
      line: 5,
      character: 0,
    })
    expect(locations).toEqual([])
  })

  it("definition resolves through gitTopLevel when it succeeds", async () => {
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel: async () => "/repo",
    })
    const service = makeSteeringLanguageService(env, () => {})
    const locations = await service.definition("file:///repo/REVIEW.md", reviewDoc, {
      line: 5,
      character: 0,
    })
    expect(locations).toEqual([{ uri: "file:///repo/src/a.ts", range: expect.anything() }])
  })

  it("definition on a '#42-70' range pointer jumps to the START line, 0-based", async () => {
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel: async () => "/repo",
    })
    const service = makeSteeringLanguageService(env, () => {})
    const rangeDoc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#42-70",
      "",
    ].join("\n")
    const locations = await service.definition("file:///repo/REVIEW.md", rangeDoc, {
      line: 5,
      character: 0,
    })
    expect(locations).toEqual([
      {
        uri: "file:///repo/src/a.ts",
        range: expect.objectContaining({ start: { line: 41, character: 0 } }),
      },
    ])
  })

  it("definition on a footnote marker jumps within the SAME document, asking gitTopLevel only to dispatch the format", async () => {
    const gitTopLevel = vi.fn(async () => "/repo")
    const footnoteDoc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#1[^fn1]",
      "",
      "[^fn1]: the reason",
      "",
    ].join("\n")
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel,
    })
    const service = makeSteeringLanguageService(env, () => {})
    const locations = await service.definition("file:///repo/REVIEW.md", footnoteDoc, {
      line: 5,
      character: 19, // inside "[^fn1]"
    })
    expect(locations).toEqual([
      {
        uri: "file:///repo/REVIEW.md",
        range: { start: { line: 7, character: 0 }, end: { line: 7, character: 0 } },
      },
    ])
    expect(gitTopLevel).toHaveBeenCalledTimes(1)
  })

  it("definition on a footnote definition line jumps to its first marker's line AND exact (non-zero) column, within the SAME document", async () => {
    const gitTopLevel = vi.fn(async () => "/repo")
    const footnoteDoc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#1[^fn1]",
      "",
      "[^fn1]: the reason",
      "",
    ].join("\n")
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel,
    })
    const service = makeSteeringLanguageService(env, () => {})
    const locations = await service.definition("file:///repo/REVIEW.md", footnoteDoc, {
      line: 7,
      character: 0,
    })
    expect(locations).toEqual([
      {
        uri: "file:///repo/REVIEW.md",
        range: { start: { line: 5, character: 18 }, end: { line: 5, character: 18 } },
      },
    ])
    expect(gitTopLevel).toHaveBeenCalledTimes(1)
  })

  it("definition on an orphan marker (no matching definition) returns [], never throwing", async () => {
    const env = fakeEnv({ ...mapped("REVIEW.md", "review") })
    const service = makeSteeringLanguageService(env, () => {})
    const orphanDoc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#1 orphan marker[^missing]",
      "",
    ].join("\n")
    const locations = await service.definition("file:///repo/REVIEW.md", orphanDoc, {
      line: 5,
      character: 34, // inside "[^missing]"
    })
    expect(locations).toEqual([])
  })

  it("definition on an orphan definition (no marker references it) returns [], never throwing", async () => {
    const env = fakeEnv({ ...mapped("REVIEW.md", "review") })
    const service = makeSteeringLanguageService(env, () => {})
    const orphanDoc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#1",
      "",
      "[^missing]: nobody points here",
      "",
    ].join("\n")
    const locations = await service.definition("file:///repo/REVIEW.md", orphanDoc, {
      line: 7,
      character: 0,
    })
    expect(locations).toEqual([])
  })

  it("documentLink resolves each hunk pointer to a link covering exactly the token, resolved against gitTopLevel", async () => {
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel: async () => "/repo",
    })
    const service = makeSteeringLanguageService(env, () => {})
    const links = await service.documentLink("file:///repo/REVIEW.md", reviewDoc)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      range: { start: { line: 5, character: 6 }, end: { line: 5, character: 18 } },
      target: "file:///repo/src/a.ts#L1",
    })
  })

  it("documentLink returns none for a qa-mode document — qa declares no documentLinks member", async () => {
    const env = fakeEnv({
      ...mapped("PLAN.md", "qa"),
      gitTopLevel: async () => "/repo",
    })
    const service = makeSteeringLanguageService(env, () => {})
    const links = await service.documentLink("file:///repo/PLAN.md", questionsDoc)
    expect(links).toEqual([])
  })

  it("documentLink returns none when neither gitTopLevel nor the workspace root resolves", async () => {
    const env = fakeEnv({
      ...mapped("REVIEW.md", "review"),
      gitTopLevel: async () => undefined,
    })
    const service = makeSteeringLanguageService(env, () => {})
    const links = await service.documentLink("file:///repo/REVIEW.md", reviewDoc)
    expect(links).toEqual([])
  })

  it("degrades to basename dispatch (and warns once) when currentRest rejects, instead of rejecting the request", async () => {
    const warnings: string[] = []
    const env = fakeEnv({
      gitTopLevel: async () => "/repo",
      currentRest: () => Promise.reject(new Error("no commits yet")),
    })
    const service = makeSteeringLanguageService(env, (m) => warnings.push(m))
    expect(await service.documentSymbol("file:///repo/PLAN.md", questionsDoc)).toEqual([])
    expect(await service.documentSymbol("file:///repo/REVIEW.md", reviewDoc)).not.toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("no commits yet")
  })

  it("never asks a repository outside the workspace's for its rest — it would run that repository's gtd.config.ts", async () => {
    const roots: string[] = []
    const env = fakeEnv({
      gitTopLevel: async (dir) => (dir.startsWith("/untrusted") ? "/untrusted" : "/repo"),
      currentRest: async (root) => {
        roots.push(root)
        return { state: "working", file: "PLAN.md", mode: "qa" }
      },
    })
    const service = makeSteeringLanguageService(env, () => {})
    service.initialize({ rootUri: "file:///repo", capabilities: {} } as never)
    expect(await service.documentSymbol("file:///untrusted/PLAN.md", questionsDoc)).toEqual([])
    expect(await service.documentSymbol("file:///untrusted/REVIEW.md", reviewDoc)).not.toEqual([])
    expect(roots).toEqual([])
  })

  it("asks the repository a workspace opened on a subfolder belongs to", async () => {
    const roots: string[] = []
    const env = fakeEnv({
      gitTopLevel: async () => "/repo",
      currentRest: async (root) => {
        roots.push(root)
        return { state: "working", file: "PLAN.md", mode: "qa" }
      },
    })
    const service = makeSteeringLanguageService(env, () => {})
    service.initialize({ rootUri: "file:///repo/packages/app", capabilities: {} } as never)
    expect(await service.documentSymbol("file:///repo/PLAN.md", questionsDoc)).not.toEqual([])
    expect(roots).toEqual(["/repo"])
  })

  describe("executeCommand", () => {
    it("returns 'unknown' for a command it doesn't recognize", async () => {
      const service = makeSteeringLanguageService(fakeEnv(), () => {})
      expect(await service.executeCommand("some.other.command", [])).toEqual({ kind: "unknown" })
    })

    it("resolves to 'show' when the current state has a file, and 'inform' when it doesn't", async () => {
      const withFile = makeSteeringLanguageService(
        fakeEnv({
          currentRest: async () => ({ state: "grilling", file: ".gtd/TODO.md", mode: "qa" }),
        }),
        () => {},
      )
      expect(await withFile.executeCommand("gtd.openSteeringFile", [])).toEqual({
        kind: "show",
        uri: "file:///cwd/.gtd/TODO.md",
      })

      const withoutFile = makeSteeringLanguageService(fakeEnv(), () => {})
      expect(await withoutFile.executeCommand("gtd.openSteeringFile", [])).toEqual({
        kind: "inform",
        message: 'gtd: state "idle" has no associated steering file.',
      })
    })

    it("asks for the rest at the git root of a workspace opened on a subfolder", async () => {
      const roots: string[] = []
      const service = makeSteeringLanguageService(
        fakeEnv({
          gitTopLevel: async () => "/repo",
          currentRest: async (root) => {
            roots.push(root)
            return { state: "grilling", file: ".gtd/TODO.md", mode: "qa" }
          },
        }),
        () => {},
      )
      service.initialize({ rootUri: "file:///repo/packages/app", capabilities: {} } as never)
      expect(await service.executeCommand("gtd.openSteeringFile", [])).toEqual({
        kind: "show",
        uri: "file:///repo/.gtd/TODO.md",
      })
      expect(roots).toEqual(["/repo"])
    })

    it("resolves to 'error' when currentRest rejects", async () => {
      const service = makeSteeringLanguageService(
        fakeEnv({ currentRest: () => Promise.reject(new Error("no repo here")) }),
        () => {},
      )
      const outcome = await service.executeCommand("gtd.openSteeringFile", [])
      expect(outcome.kind).toBe("error")
      expect((outcome as { message: string }).message).toContain("no repo here")
    })

    it("gtd.revealPosition resolves to 'show' with a collapsed selection at the given position", async () => {
      const service = makeSteeringLanguageService(fakeEnv(), () => {})
      const outcome = await service.executeCommand("gtd.revealPosition", [
        "file:///repo/TODO.md",
        { line: 3, character: 7 },
      ])
      expect(outcome).toEqual({
        kind: "show",
        uri: "file:///repo/TODO.md",
        selection: {
          start: { line: 3, character: 7 },
          end: { line: 3, character: 7 },
        },
      })
    })

    it("gtd.revealPosition resolves to 'error' for missing or malformed arguments, never a thrown rejection", async () => {
      const service = makeSteeringLanguageService(fakeEnv(), () => {})
      expect((await service.executeCommand("gtd.revealPosition", [])).kind).toBe("error")
      expect(
        (await service.executeCommand("gtd.revealPosition", ["file:///repo/TODO.md"])).kind,
      ).toBe("error")
      expect(
        (
          await service.executeCommand("gtd.revealPosition", [
            "file:///repo/TODO.md",
            { line: "not a number", character: 7 },
          ])
        ).kind,
      ).toBe("error")
    })
  })
})

/** A minimal fake `SteeringConnection` that records its registered handlers and every `window`/`sendDiagnostics` call, for `bindSteeringServer` tests. No real protocol, no real `vscode-languageserver` connection. */
const fakeConnection = () => {
  const handlers: Record<string, (arg: unknown) => unknown> = {}
  const disposable = { dispose: () => {} }
  const register =
    (name: string) =>
    (handler: (arg: unknown) => unknown): typeof disposable => {
      handlers[name] = handler
      return disposable
    }
  const connection = {
    onInitialize: register("onInitialize"),
    onDocumentSymbol: register("onDocumentSymbol"),
    onCodeAction: register("onCodeAction"),
    onDefinition: register("onDefinition"),
    onDocumentLinks: register("onDocumentLinks"),
    onExecuteCommand: register("onExecuteCommand"),
    sendDiagnostics: vi.fn(),
    console: { warn: vi.fn() },
    window: {
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showDocument: vi.fn(async () => true),
    },
    listen: vi.fn(),
    onExit: register("onExit"),
    onDidOpenTextDocument: register("onDidOpenTextDocument"),
    onDidChangeTextDocument: register("onDidChangeTextDocument"),
    onDidCloseTextDocument: register("onDidCloseTextDocument"),
    onWillSaveTextDocument: register("onWillSaveTextDocument"),
    onWillSaveTextDocumentWaitUntil: register("onWillSaveTextDocumentWaitUntil"),
    onDidSaveTextDocument: register("onDidSaveTextDocument"),
  } as unknown as SteeringConnection
  return { connection, handlers }
}

/** A minimal fake `SteeringDocuments` — `fire.open`/`fire.change` invoke whatever handler `bindSteeringServer` registered, simulating an editor's open/edit lifecycle with no real `TextDocument`. */
const fakeDocuments = () => {
  let onOpen: ((change: { document: { uri: string; getText: () => string } }) => void) | undefined
  let onChange: ((change: { document: { uri: string; getText: () => string } }) => void) | undefined
  const documents = {
    get: vi.fn((uri: string) => ({ uri, getText: () => "content" })),
    onDidOpen: (handler: typeof onOpen) => {
      onOpen = handler
    },
    onDidChangeContent: (handler: typeof onChange) => {
      onChange = handler
    },
    listen: vi.fn(),
  } as unknown as SteeringDocuments
  return {
    documents,
    fire: {
      open: (uri: string, text: string) => onOpen?.({ document: { uri, getText: () => text } }),
      change: (uri: string, text: string) => onChange?.({ document: { uri, getText: () => text } }),
    },
  }
}

const fakeService = (
  overrides: Partial<SteeringLanguageService> = {},
): SteeringLanguageService => ({
  initialize: vi.fn(() => ({ capabilities: {} })),
  documentSymbol: vi.fn(async () => []),
  codeAction: vi.fn(async () => []),
  definition: vi.fn(async () => []),
  diagnostics: vi.fn(async () => []),
  documentLink: vi.fn(async () => []),
  executeCommand: vi.fn(async (): Promise<ExecuteCommandOutcome> => ({ kind: "unknown" })),
  ...overrides,
})

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe("bindSteeringServer", () => {
  it("publishes diagnostics on both didOpen and didChangeContent", async () => {
    const diagnostic: Diagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: "x",
      severity: DiagnosticSeverity.Warning,
      source: "gtd",
    }
    const service = fakeService({ diagnostics: vi.fn(async () => [diagnostic]) })
    const { connection } = fakeConnection()
    const { documents, fire } = fakeDocuments()
    bindSteeringServer(connection, documents, service)

    fire.open("file:///repo/PLAN.md", "text")
    await flush()
    expect(connection.sendDiagnostics).toHaveBeenCalledWith({
      uri: "file:///repo/PLAN.md",
      diagnostics: [diagnostic],
    })

    fire.change("file:///repo/PLAN.md", "text2")
    await flush()
    expect(connection.sendDiagnostics).toHaveBeenCalledTimes(2)
  })

  it("returns null for an unknown executeCommand outcome, without touching connection.window", async () => {
    const service = fakeService()
    const { connection, handlers } = fakeConnection()
    const { documents } = fakeDocuments()
    bindSteeringServer(connection, documents, service)

    const result = await handlers["onExecuteCommand"]!({ command: "unknown", arguments: [] })
    expect(result).toBeNull()
    expect(connection.window.showInformationMessage).not.toHaveBeenCalled()
    expect(connection.window.showDocument).not.toHaveBeenCalled()
  })

  it("an 'inform' outcome calls showInformationMessage", async () => {
    const service = fakeService({
      executeCommand: vi.fn(
        async (): Promise<ExecuteCommandOutcome> => ({ kind: "inform", message: "no file here" }),
      ),
    })
    const { connection, handlers } = fakeConnection()
    const { documents } = fakeDocuments()
    bindSteeringServer(connection, documents, service)

    await handlers["onExecuteCommand"]!({ command: "gtd.openSteeringFile", arguments: [] })
    expect(connection.window.showInformationMessage).toHaveBeenCalledWith("no file here")
    expect(connection.window.showDocument).not.toHaveBeenCalled()
  })

  it("a 'show' outcome calls showDocument", async () => {
    const service = fakeService({
      executeCommand: vi.fn(
        async (): Promise<ExecuteCommandOutcome> => ({ kind: "show", uri: "file:///repo/TODO.md" }),
      ),
    })
    const { connection, handlers } = fakeConnection()
    const { documents } = fakeDocuments()
    bindSteeringServer(connection, documents, service)

    await handlers["onExecuteCommand"]!({ command: "gtd.openSteeringFile", arguments: [] })
    expect(connection.window.showDocument).toHaveBeenCalledWith({ uri: "file:///repo/TODO.md" })
  })

  it("a 'show' outcome carrying a selection passes it and takeFocus:true to showDocument", async () => {
    const service = fakeService({
      executeCommand: vi.fn(
        async (): Promise<ExecuteCommandOutcome> => ({
          kind: "show",
          uri: "file:///repo/TODO.md",
          selection: { start: { line: 3, character: 7 }, end: { line: 3, character: 7 } },
        }),
      ),
    })
    const { connection, handlers } = fakeConnection()
    const { documents } = fakeDocuments()
    bindSteeringServer(connection, documents, service)

    await handlers["onExecuteCommand"]!({ command: "gtd.revealPosition", arguments: [] })
    expect(connection.window.showDocument).toHaveBeenCalledWith({
      uri: "file:///repo/TODO.md",
      selection: { start: { line: 3, character: 7 }, end: { line: 3, character: 7 } },
      takeFocus: true,
    })
  })

  it("an 'error' outcome calls showErrorMessage", async () => {
    const service = fakeService({
      executeCommand: vi.fn(
        async (): Promise<ExecuteCommandOutcome> => ({ kind: "error", message: "boom" }),
      ),
    })
    const { connection, handlers } = fakeConnection()
    const { documents } = fakeDocuments()
    bindSteeringServer(connection, documents, service)

    await handlers["onExecuteCommand"]!({ command: "gtd.openSteeringFile", arguments: [] })
    expect(connection.window.showErrorMessage).toHaveBeenCalledWith("boom")
  })

  it("delegates initialize/documentSymbol/codeAction/definition to the service", async () => {
    const service = fakeService()
    const { connection, handlers } = fakeConnection()
    const { documents } = fakeDocuments()
    bindSteeringServer(connection, documents, service)

    handlers["onInitialize"]!({} as never)
    expect(service.initialize).toHaveBeenCalled()

    await handlers["onDocumentSymbol"]!({ textDocument: { uri: "file:///repo/PLAN.md" } })
    expect(service.documentSymbol).toHaveBeenCalledWith("file:///repo/PLAN.md", "content")

    await handlers["onCodeAction"]!({
      textDocument: { uri: "file:///repo/PLAN.md" },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    })
    expect(service.codeAction).toHaveBeenCalled()

    await handlers["onDefinition"]!({
      textDocument: { uri: "file:///repo/PLAN.md" },
      position: { line: 0, character: 0 },
    })
    expect(service.definition).toHaveBeenCalled()

    await handlers["onDocumentLinks"]!({ textDocument: { uri: "file:///repo/PLAN.md" } })
    expect(service.documentLink).toHaveBeenCalledWith("file:///repo/PLAN.md", "content")
  })

  it("listens on both documents and the connection", () => {
    const service = fakeService()
    const { connection } = fakeConnection()
    const { documents } = fakeDocuments()
    bindSteeringServer(connection, documents, service)
    expect(documents.listen).toHaveBeenCalledWith(connection)
    expect(connection.listen).toHaveBeenCalled()
  })
})

describe("makeNodeLspEnv", () => {
  let dir: string
  let bin: string
  let calls: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gtd-lsp-node-env-test-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir })
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "initial"], { cwd: dir })
    // A stand-in `gtd`: logs each call and prints a fixed beat.
    bin = mkdtempSync(join(tmpdir(), "gtd-lsp-fake-gtd-"))
    calls = join(bin, "calls.log")
    writeFileSync(
      join(bin, "gtd"),
      [
        "#!/bin/sh",
        `echo "$@" >> '${calls}'`,
        `echo '{"schema":1,"state":"working","file":".gtd/PLAN.md","mode":"qa"}'`,
      ].join("\n"),
    )
    chmodSync(join(bin, "gtd"), 0o755)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  })

  const callCount = (): number => readFileSync(calls, "utf8").trim().split("\n").length

  it("reads the rest off `gtd next --json`, and the git root off git", async () => {
    const env = makeNodeLspEnv([join(bin, "gtd")])
    mkdirSync(join(dir, "sub"))
    expect(await env.gitTopLevel(join(dir, "sub"))).toBe(dir)
    // Through a symlink the root keeps the symlinked spelling, so URIs built
    // from it match the editor's — on every platform, not only macOS's /var.
    const link = join(bin, "link")
    symlinkSync(dir, link)
    expect(await env.gitTopLevel(join(link, "sub"))).toBe(link)
    expect(await env.currentRest(dir)).toEqual({
      state: "working",
      file: ".gtd/PLAN.md",
      mode: "qa",
    })
    expect(readFileSync(calls, "utf8")).toBe("next --json\n")
  })

  it("runs gtd once per HEAD: a repeat request is served from memory, a landing re-reads", async () => {
    const env = makeNodeLspEnv([join(bin, "gtd")])
    await Promise.all([env.currentRest(dir), env.currentRest(dir)])
    await env.currentRest(dir)
    expect(callCount()).toBe(1)

    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "second"], { cwd: dir })
    await env.currentRest(dir)
    expect(callCount()).toBe(2)
  })

  it("rejects with gtd's own stderr, replays the failure briefly, then retries", async () => {
    const good = readFileSync(join(bin, "gtd"), "utf8")
    writeFileSync(
      join(bin, "gtd"),
      ["#!/bin/sh", `echo "$@" >> '${calls}'`, "echo 'gtd: no commits' >&2", "exit 1"].join("\n"),
    )
    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    try {
      const env = makeNodeLspEnv([join(bin, "gtd")], 5000)
      await expect(env.currentRest(dir)).rejects.toThrow("gtd: no commits")

      writeFileSync(join(bin, "gtd"), good)
      now += 4_999
      await expect(env.currentRest(dir)).rejects.toThrow("gtd: no commits")
      expect(callCount()).toBe(1)

      now += 1
      expect((await env.currentRest(dir)).state).toBe("working")
      expect(callCount()).toBe(2)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe("startLspServer's requirement set", () => {
  it("requires nothing at the type level — CommandRunner (or any other service) can never quietly reappear", () => {
    // A type-only assertion: this line fails to COMPILE (not merely to run)
    // if `startLspServer`'s Effect ever gains a requirement in `R`, since
    // `Effect.Effect<void, Error, never>` only accepts an Effect whose own
    // `R` is exactly `never`. Calling `startLspServer` builds the Effect
    // value without running it (no `createConnection`, no IO) — `Effect.gen`
    // only executes its generator body when the Effect is actually run.
    const typedAsRequiringNothing: Effect.Effect<void, Error, never> = startLspServer({
      gtd: ["gtd"],
    })
    expect(typedAsRequiringNothing).toBeDefined()
  })

  it("resolves once the client sends the LSP `exit` notification, running the generator to completion", async () => {
    // A PassThrough never emits `end`/`close` on its own (see the `gtd lsp`
    // test in src/program.test.ts for why that matters — a real stdin's
    // `end`/`close` listener calls `process.exit(1)`), so it's safe to swap
    // in here without risking the test process itself. `process.stdout` is
    // left alone — swapping it out here breaks vitest's own coverage-report
    // IPC, which relies on the real stdout/stderr streams surviving the run;
    // its `write` is stubbed instead, since `vscode-languageserver`'s own
    // `exit` handling unconditionally calls `process.exit` (vitest turns
    // that into a thrown error, logged as a JSON-RPC notice on stdout) on
    // top of our own `onExit` — noise this test isn't about.
    const stdin = new PassThrough()
    const savedStdin = Object.getOwnPropertyDescriptor(process, "stdin")
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true })
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    const send = (message: Record<string, unknown>): void => {
      const body = JSON.stringify(message)
      stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
    try {
      const result = Effect.runPromise(startLspServer({ gtd: ["gtd"] }))
      send({ jsonrpc: "2.0", method: "exit" })
      await expect(result).resolves.toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      writeSpy.mockRestore()
      if (savedStdin) Object.defineProperty(process, "stdin", savedStdin)
    }
  })
})
