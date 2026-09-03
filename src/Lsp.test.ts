import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  basenameFallbackMode,
  bindSteeringServer,
  buildSteeringMap,
  capabilitiesForDocument,
  diagnosticsFor,
  externalValidatorNotice,
  makeNodeLspEnv,
  makeSteeringLanguageService,
  mergeStaticVars,
  resolveSteeringFile,
  resolvedModeForDocument,
  resolveWorkspaceRoot,
  startLspServer,
  steeringFileOutcome,
  documentLinksFor,
  toCodeAction,
  toDocumentLink,
  toDocumentSymbol,
  toLocation,
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
import { resolveBuiltInMode, resolveSteeringMode } from "./SteeringMode.js"
import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { testLayers } from "./testing/Layers.js"

describe("basenameFallbackMode", () => {
  it("maps REVIEW.md to the built-in `review` mode, and anything else (including TODO.md) to undefined", () => {
    expect(basenameFallbackMode("REVIEW.md")).toEqual(resolveBuiltInMode("review"))
    expect(basenameFallbackMode("TODO.md")).toBeUndefined()
    expect(basenameFallbackMode("NOTES.md")).toBeUndefined()
  })
})

describe("buildSteeringMap", () => {
  const def = (
    states: WorkflowDefinition["states"],
    modes: WorkflowDefinition["modes"] = { qa: {}, review: {} },
  ): WorkflowDefinition => ({
    states,
    entries: { default: Object.keys(states)[0]!, manual: [] },
    modes,
  })

  it("renders each state's `file:` (vars-layer context) into an absolute path keyed to its resolved mode", () => {
    const { map, warnings } = buildSteeringMap(
      def({
        grilling: {
          actor: "agent",
          prompt: "x",
          file: "<%= it.vars.todoFile %>",
          mode: "qa",
        },
        reviewing: {
          actor: "agent",
          prompt: "x",
          file: "<%= it.vars.reviewFile %>",
          mode: "review",
        },
        idle: { actor: "human", message: "x" },
      }),
      { todoFile: ".gtd/TODO.md", reviewFile: ".gtd/REVIEW.md" },
      "/repo",
    )
    expect(warnings).toEqual([])
    expect(map.get("/repo/.gtd/TODO.md")?.builtIn).toBe(QA_FORMAT)
    expect(map.get("/repo/.gtd/REVIEW.md")?.builtIn).toBe(REVIEW_FORMAT)
    expect(map.size).toBe(2)
  })

  it("skips a state whose `file:` fails to render and warns, without failing the whole map", () => {
    const { map, warnings } = buildSteeringMap(
      def({
        broken: { actor: "agent", prompt: "x", file: "<%= it.vars.nope.deeper %>", mode: "qa" },
        ok: { actor: "agent", prompt: "x", file: "PLAN.md", mode: "qa" },
      }),
      {},
      "/repo",
    )
    expect(map.get("/repo/PLAN.md")?.builtIn).toBe(QA_FORMAT)
    expect(map.size).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('state "broken"')
  })

  it("keeps the FIRST declaring state's mode on a path conflict, warning about the later one", () => {
    const { map, warnings } = buildSteeringMap(
      def({
        first: { actor: "agent", prompt: "x", file: "SHARED.md", mode: "qa" },
        second: { actor: "agent", prompt: "x", file: "SHARED.md", mode: "review" },
      }),
      {},
      "/repo",
    )
    expect(map.get("/repo/SHARED.md")?.builtIn).toBe(QA_FORMAT)
    expect(map.size).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('state "second"')
  })

  it("ignores a state declaring neither `file:` nor `mode:`", () => {
    const { map, warnings } = buildSteeringMap(
      def({ idle: { actor: "human", message: "x" } }),
      {},
      "/repo",
    )
    expect(map.size).toBe(0)
    expect(warnings).toEqual([])
  })

  it("skips (with a warning) a state whose `mode:` does not resolve — an unregistered, undeclared name", () => {
    const { map, warnings } = buildSteeringMap(
      def(
        { drafting: { actor: "agent", prompt: "x", file: "docs/adr.md", mode: "adr" } },
        undefined,
      ),
      {},
      "/repo",
    )
    expect(map.size).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('mode "adr" does not resolve')
  })
})

describe("resolvedModeForDocument", () => {
  it("prefers the config-driven map over the basename fallback", () => {
    const resolved = resolveBuiltInMode("qa")!
    const map = new Map([["/repo/PLAN.md", resolved]])
    expect(resolvedModeForDocument("file:///repo/PLAN.md", map)).toBe(resolved)
  })

  it("falls back to basename dispatch for a path the map doesn't cover", () => {
    const map = new Map()
    expect(resolvedModeForDocument("file:///repo/.gtd/REVIEW.md", map)?.builtIn).toBe(REVIEW_FORMAT)
    expect(resolvedModeForDocument("file:///repo/.gtd/TODO.md", map)).toBeUndefined()
    expect(resolvedModeForDocument("file:///repo/NOTES.md", map)).toBeUndefined()
  })
})

describe("capabilitiesForDocument", () => {
  it("carries the built-in format and a live validate for a mapped qa document", () => {
    const map = new Map([["/repo/PLAN.md", resolveBuiltInMode("qa")!]])
    const caps = capabilitiesForDocument("file:///repo/PLAN.md", map)
    expect(caps.format).toBe(QA_FORMAT)
    expect(caps.liveValidate).toBe(QA_FORMAT.validate)
  })

  it("is empty for a document dispatching to no mode at all", () => {
    expect(capabilitiesForDocument("file:///repo/NOTES.md", new Map())).toEqual({})
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
    const action = toCodeAction("file:///repo/REVIEW.md")({
      title: "gtd: check this hunk",
      edits: [edit],
    })
    expect(action.title).toBe("gtd: check this hunk")
    expect(action.edit?.changes?.["file:///repo/REVIEW.md"]).toEqual([edit])
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
    const links = documentLinksFor(resolveBuiltInMode("review"), content, "/repo")
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
    const links = documentLinksFor(resolveBuiltInMode("review"), content, "/repo")
    // Exactly one link — the pointer token itself, never the `[^fn1]` marker
    // sitting later in the same note.
    expect(links).toEqual([
      {
        range: { start: { line: 5, character: 6 }, end: { line: 5, character: 18 } },
        target: "file:///repo/src/a.ts#L1",
      },
    ])
  })

  it("returns none for a qa-mode document — qa declares no documentLinks member", () => {
    const content = ["## Open Questions", "", "### Which API?", "", "- [ ] REST", ""].join("\n")
    expect(documentLinksFor(resolveBuiltInMode("qa"), content, "/repo")).toEqual([])
  })

  it("returns none for an unresolved mode", () => {
    expect(documentLinksFor(undefined, "anything", "/repo")).toEqual([])
  })
})

describe("externalValidatorNotice", () => {
  it("names the mode and the command, pointing at gtd validate", () => {
    const diagnostic = externalValidatorNotice("qa", "npx my-linter <%= it.file %>")
    expect(diagnostic.message).toBe(
      'mode "qa" is validated by a shell command (`npx my-linter <%= it.file %>`) — run `gtd validate`; no live diagnostics',
    )
    expect(diagnostic.severity).toBe(3) // DiagnosticSeverity.Information
    expect(diagnostic.source).toBe("gtd")
    expect(diagnostic.range.start).toEqual({ line: 0, character: 0 })
  })
})

describe("diagnosticsFor", () => {
  it("publishes a built-in format's own validate findings for an unoverridden built-in mode", () => {
    const malformed = ["## Open Questions", "", "###", "", "no question text.", ""].join("\n")
    const diagnostics = diagnosticsFor(resolveBuiltInMode("qa"), malformed)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("has no question text")
    expect(diagnostics[0]?.severity).toBe(2) // DiagnosticSeverity.Warning
  })

  it("suppresses built-in findings and publishes the external-validator notice instead when validate: is overridden", () => {
    const def: WorkflowDefinition = {
      states: {},
      entries: { default: "x", manual: [] },
      modes: { qa: { validate: "npx my-linter <%= it.file %>" } },
    }
    const malformed = ["## Open Questions", "", "###", "", "no question text.", ""].join("\n")
    const diagnostics = diagnosticsFor(resolveSteeringMode(def, "qa"), malformed)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe(3) // DiagnosticSeverity.Information
    expect(diagnostics[0]?.message).toContain("npx my-linter")
  })

  it("publishes nothing for an unresolved mode", () => {
    expect(diagnosticsFor(undefined, "anything")).toEqual([])
  })

  it("underlines exactly the second pointer token for a positioned review finding, not the whole line", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./src/thing.ts#1 — ./src/other.ts#2",
      "",
    ].join("\n")
    const diagnostics = diagnosticsFor(resolveBuiltInMode("review"), content)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("starts with a second pointer")
    // The finding's own range (the second pointer token, `./src/other.ts#2`)
    // hands straight through — never re-derived as the whole line.
    expect(diagnostics[0]?.range).toEqual({
      start: { line: 5, character: 25 },
      end: { line: 5, character: 41 },
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
    const diagnostics = diagnosticsFor(resolveBuiltInMode("qa"), content)
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
    const diagnostics = diagnosticsFor(resolveBuiltInMode("review"), content)
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
    const diagnostics = diagnosticsFor(resolveBuiltInMode("review"), content)
    const baseFinding = diagnostics.find((d) => String(d.message).includes("base: <hash>"))
    expect(baseFinding?.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: lines.length - 1, character: lines[lines.length - 1]!.length },
    })
  })
})

const fakeEnv = (overrides: Partial<LspEnv> = {}): LspEnv => ({
  steeringMapFor: async () => new Map(),
  gitTopLevel: async () => undefined,
  currentSteeringFile: async () => ({ state: "idle", file: undefined }),
  cwd: "/cwd",
  ...overrides,
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
    const resolved = resolveBuiltInMode("qa")!
    const env = fakeEnv({ steeringMapFor: async () => new Map([["/repo/PLAN.md", resolved]]) })
    const service = makeSteeringLanguageService(env, () => {})
    const mapped = await service.documentSymbol("file:///repo/PLAN.md", questionsDoc)
    expect(mapped.length).toBeGreaterThan(0)
    const unmapped = await service.documentSymbol("file:///repo/OTHER.md", questionsDoc)
    expect(unmapped).toEqual([])
  })

  it("suppresses built-in diagnostics but keeps outline/actions live when validate: is shell-overridden", async () => {
    const def: WorkflowDefinition = {
      states: {},
      entries: { default: "x", manual: [] },
      modes: { qa: { validate: "npx my-linter <%= it.file %>" } },
    }
    const resolved = resolveSteeringMode(def, "qa")!
    const env = fakeEnv({ steeringMapFor: async () => new Map([["/repo/PLAN.md", resolved]]) })
    const service = makeSteeringLanguageService(env, () => {})
    const diagnostics = await service.diagnostics("file:///repo/PLAN.md", questionsDoc)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe(3) // Information notice, not a built-in finding
    const symbols = await service.documentSymbol("file:///repo/PLAN.md", questionsDoc)
    expect(symbols.length).toBeGreaterThan(0)
  })

  it("dispatches an unmapped REVIEW.md via the basename fallback (resolveBuiltInMode)", async () => {
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
      commands: ["gtd.openSteeringFile"],
    })
  })

  it("codeAction maps a mapped document's actions, and returns none for an unmapped one", async () => {
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({ steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]) })
    const service = makeSteeringLanguageService(env, () => {})
    const range = { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } }
    const actions = await service.codeAction("file:///repo/REVIEW.md", reviewDoc, range)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions[0]?.edit?.changes?.["file:///repo/REVIEW.md"]).toBeDefined()
    const unmapped = await service.codeAction("file:///repo/OTHER.md", reviewDoc, range)
    expect(unmapped).toEqual([])
  })

  it("definition swallows a rejecting gitTopLevel and falls back to the workspace root", async () => {
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({
      steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]),
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
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({
      steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]),
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
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({
      steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]),
      gitTopLevel: async () => "/repo",
    })
    const service = makeSteeringLanguageService(env, () => {})
    const locations = await service.definition("file:///repo/REVIEW.md", reviewDoc, {
      line: 5,
      character: 0,
    })
    expect(locations).toEqual([{ uri: "file:///repo/src/a.ts", range: expect.anything() }])
  })

  it("definition on a footnote marker jumps within the SAME document, never touching gitTopLevel", async () => {
    const resolved = resolveBuiltInMode("review")!
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
      steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]),
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
    expect(gitTopLevel).not.toHaveBeenCalled()
  })

  it("definition on a footnote definition line jumps to its first marker's line AND exact (non-zero) column, within the SAME document", async () => {
    const resolved = resolveBuiltInMode("review")!
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
      steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]),
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
    expect(gitTopLevel).not.toHaveBeenCalled()
  })

  it("definition on an orphan marker (no matching definition) returns [], never throwing", async () => {
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({ steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]) })
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
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({ steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]) })
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
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({
      steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]),
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
    const resolved = resolveBuiltInMode("qa")!
    const env = fakeEnv({
      steeringMapFor: async () => new Map([["/repo/PLAN.md", resolved]]),
      gitTopLevel: async () => "/repo",
    })
    const service = makeSteeringLanguageService(env, () => {})
    const links = await service.documentLink("file:///repo/PLAN.md", questionsDoc)
    expect(links).toEqual([])
  })

  it("documentLink returns none when neither gitTopLevel nor the workspace root resolves", async () => {
    const resolved = resolveBuiltInMode("review")!
    const env = fakeEnv({
      steeringMapFor: async () => new Map([["/repo/REVIEW.md", resolved]]),
      gitTopLevel: async () => undefined,
    })
    const service = makeSteeringLanguageService(env, () => {})
    const links = await service.documentLink("file:///repo/REVIEW.md", reviewDoc)
    expect(links).toEqual([])
  })

  it("degrades to an empty steering map (and warns) when steeringMapFor rejects, instead of rejecting the request", async () => {
    const warnings: string[] = []
    const env = fakeEnv({ steeringMapFor: () => Promise.reject(new Error("bad .gtdrc")) })
    const service = makeSteeringLanguageService(env, (m) => warnings.push(m))
    const symbols = await service.documentSymbol("file:///repo/PLAN.md", questionsDoc)
    expect(symbols).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("bad .gtdrc")
  })

  describe("executeCommand", () => {
    it("returns 'unknown' for a command it doesn't recognize", async () => {
      const service = makeSteeringLanguageService(fakeEnv(), () => {})
      expect(await service.executeCommand("some.other.command", [])).toEqual({ kind: "unknown" })
    })

    it("resolves to 'show' when the current state has a file, and 'inform' when it doesn't", async () => {
      const withFile = makeSteeringLanguageService(
        fakeEnv({ currentSteeringFile: async () => ({ state: "grilling", file: ".gtd/TODO.md" }) }),
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

    it("resolves to 'error' when currentSteeringFile rejects", async () => {
      const service = makeSteeringLanguageService(
        fakeEnv({ currentSteeringFile: () => Promise.reject(new Error("no repo here")) }),
        () => {},
      )
      const outcome = await service.executeCommand("gtd.openSteeringFile", [])
      expect(outcome.kind).toBe("error")
      expect((outcome as { message: string }).message).toContain("no repo here")
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

describe("resolveSteeringFile", () => {
  it("resolves idle's .gtd/TODO.md with no stat — gtd names the path, never checks it exists", async () => {
    // No `.gtdrc` at all — the bundled/built-in template applies, whose
    // `idle` state resolves `file:` to `.gtd/TODO.md` (its `todoFile` var,
    // src/workflows/unified.yaml). One commit, nothing under `.gtd/` — the
    // repo-relative path resolves purely from the workflow + state, never by
    // stat-ing the worktree for it.
    const repo = new InMemRepo()
    repo.writeFile("README.md", "hello")
    repo.commitAllWithPrefix("chore: initial commit")

    const resolved = await Effect.runPromise(
      resolveSteeringFile.pipe(Effect.provide(testLayers(repo))),
    )

    expect(resolved.state).toBe("idle")
    expect(resolved.file).toBe(".gtd/TODO.md")
    expect(repo.hasPath(".gtd/TODO.md")).toBe(false)
  })
})

describe("mergeStaticVars", () => {
  it("layers rcVars over workflowVars, then a GTD_<NAME> env override over both", () => {
    const merged = mergeStaticVars(
      { todoFile: ".gtd/TODO.md", reviewFile: ".gtd/REVIEW.md" },
      { reviewFile: ".gtd/REVIEW2.md" },
      { GTD_TODOFILE: "/override/TODO.md" },
    )
    expect(merged).toEqual({
      todoFile: "/override/TODO.md",
      reviewFile: ".gtd/REVIEW2.md",
    })
  })

  it("ignores env entries that don't match a GTD_<NAME> for a known var", () => {
    const merged = mergeStaticVars({ todoFile: ".gtd/TODO.md" }, {}, { GTD_OTHER: "x" })
    expect(merged).toEqual({ todoFile: ".gtd/TODO.md" })
  })
})

describe("makeNodeLspEnv", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gtd-lsp-node-env-test-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir })
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "initial"], { cwd: dir })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("wires the real git/config/repo-files layers: steeringMapFor, gitTopLevel and currentSteeringFile all resolve against a real repo", async () => {
    const env = makeNodeLspEnv(() => {})

    const map = await env.steeringMapFor(dir)
    expect(map).toBeInstanceOf(Map)

    const realDir = realpathSync(dir)
    const topLevel = await env.gitTopLevel(dir)
    expect(topLevel).toBe(realDir)

    const { state, file } = await env.currentSteeringFile(dir)
    expect(state).toBe("idle")
    expect(file).toBe(".gtd/TODO.md")

    // Calling again for the same root exercises the memoised-runtime path
    // (`runtimeFor`'s cache hit) rather than constructing a fresh one.
    const topLevelAgain = await env.gitTopLevel(dir)
    expect(topLevelAgain).toBe(realDir)
  })
})

describe("startLspServer's requirement set", () => {
  it("requires nothing at the type level — CommandRunner (or any other service) can never quietly reappear", () => {
    // A type-only assertion: this line fails to COMPILE (not merely to run)
    // if `startLspServer`'s Effect ever gains a requirement in `R`, since
    // `Effect.Effect<void, Error, never>` only accepts an Effect whose own
    // `R` is exactly `never`. Calling `startLspServer()` builds the Effect
    // value without running it (no `createConnection`, no IO) — `Effect.gen`
    // only executes its generator body when the Effect is actually run.
    const typedAsRequiringNothing: Effect.Effect<void, Error, never> = startLspServer()
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
      const result = Effect.runPromise(startLspServer())
      send({ jsonrpc: "2.0", method: "exit" })
      await expect(result).resolves.toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      writeSpy.mockRestore()
      if (savedStdin) Object.defineProperty(process, "stdin", savedStdin)
    }
  })
})
