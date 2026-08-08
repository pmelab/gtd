import type { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  basenameFallbackMode,
  bindSteeringServer,
  buildSteeringMap,
  capabilitiesForDocument,
  diagnosticsFor,
  externalValidatorNotice,
  makeSteeringLanguageService,
  resolvedModeForDocument,
  resolveWorkspaceRoot,
  startLspServer,
  steeringFileOutcome,
  toCodeAction,
  toDocumentSymbol,
  toLocation,
  type ExecuteCommandOutcome,
  type LspEnv,
  type SteeringConnection,
  type SteeringDocuments,
  type SteeringLanguageService,
} from "./Lsp.js"
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver/node"
import { resolveBuiltInMode, resolveSteeringMode } from "./SteeringMode.js"
import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"
import type { WorkflowDefinition } from "./PatternMachine.js"

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
    const location = toLocation("/repo")({ path: "./src/calc.ts", line: 4 })
    expect(location.uri).toBe("file:///repo/src/calc.ts")
    expect(location.range.start).toEqual({ line: 4, character: 0 })
    expect(location.range.end).toEqual({ line: 4, character: 0 })
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
})
