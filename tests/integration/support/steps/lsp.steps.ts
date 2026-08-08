import { After, Given, Then, When } from "quickpickle"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// ── A minimal LSP client: enough of the stdio JSON-RPC framing protocol to
// drive `gtd lsp` for e2e — not a general-purpose client. Kept self-contained
// (module-local state keyed by world) rather than added to `GtdWorld` itself,
// since only this feature ever needs a long-running child process; every
// other scenario's `runGtd*` is one-shot exec.

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

interface JsonRpcResponse {
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message: string }
}

interface LspClient {
  readonly proc: ChildProcessWithoutNullStreams
  buffer: Buffer
  nextId: number
  readonly pending: Map<number, (response: JsonRpcResponse) => void>
  readonly stderr: string[]
  /** Requests the SERVER sent to this client (e.g. `window/showDocument`), oldest → newest — auto-acknowledged (see `dispatch`) so the server's own await unblocks; recorded here for assertions. */
  readonly serverRequests: JsonRpcResponse[]
}

const clients = new WeakMap<GtdWorld, LspClient>()

function frame(message: Record<string, unknown>): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`
}

/** One complete `Content-Length`-framed message pulled off the front of `buffer`, and the remainder left behind — or `undefined` if `buffer` doesn't yet hold a full frame. */
function popFrame(
  buffer: Buffer,
): { readonly message: JsonRpcResponse; readonly rest: Buffer } | undefined {
  const headerEnd = buffer.indexOf("\r\n\r\n")
  if (headerEnd === -1) return undefined
  const header = buffer.subarray(0, headerEnd).toString("utf-8")
  const match = /Content-Length:\s*(\d+)/i.exec(header)
  if (!match) return undefined
  const length = Number(match[1])
  const bodyStart = headerEnd + 4
  if (buffer.length < bodyStart + length) return undefined
  const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf-8")
  return { message: JSON.parse(body) as JsonRpcResponse, rest: buffer.subarray(bodyStart + length) }
}

/**
 * Handles a message carrying a `method` — the server calling US
 * (`window/showDocument` and friends): recorded in `serverRequests` for
 * assertions, and, when it carries an `id` (a request, not a notification),
 * immediately acknowledged with a generic success result so the server's own
 * `await` unblocks (this minimal client doesn't actually show anything — it
 * just proves the round trip).
 */
function handleServerRequest(client: LspClient, message: JsonRpcResponse): void {
  client.serverRequests.push(message)
  if (message.id === undefined) return
  client.proc.stdin.write(frame({ jsonrpc: "2.0", id: message.id, result: { success: true } }))
}

/** Delivers a RESPONSE (no `method`) to one of our own pending requests' waiter, if still waiting. */
function handleResponse(client: LspClient, message: JsonRpcResponse): void {
  if (message.id === undefined) return
  client.pending.get(message.id)?.(message)
  client.pending.delete(message.id)
}

/** Dispatches one decoded message to whichever of the two handlers above applies. */
function dispatch(client: LspClient, message: JsonRpcResponse): void {
  if (message.method !== undefined) {
    handleServerRequest(client, message)
  } else {
    handleResponse(client, message)
  }
}

/** Consumes every complete frame currently sitting in the client's buffer, dispatching each in turn. */
function drain(client: LspClient): void {
  for (;;) {
    const popped = popFrame(client.buffer)
    if (!popped) return
    client.buffer = popped.rest
    dispatch(client, popped.message)
  }
}

function request(client: LspClient, method: string, params: unknown): Promise<JsonRpcResponse> {
  const id = client.nextId++
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      client.pending.delete(id)
      rejectPromise(new Error(`LSP request "${method}" timed out waiting for a response`))
    }, 10_000)
    client.pending.set(id, (response) => {
      clearTimeout(timer)
      resolvePromise(response)
    })
    client.proc.stdin.write(frame({ jsonrpc: "2.0", id, method, params }))
  })
}

function notify(client: LspClient, method: string, params: unknown): void {
  client.proc.stdin.write(frame({ jsonrpc: "2.0", method, params }))
}

/** Waits for a server-initiated notification/request matching `method` + `predicate` to show up in `serverRequests` — `publishDiagnostics` is fired asynchronously off `didOpen`, with no response to await, so a check for it must poll rather than assume it has already arrived. */
function waitForServerRequest(
  client: LspClient,
  method: string,
  predicate: (message: JsonRpcResponse) => boolean,
  timeoutMs = 5_000,
): Promise<JsonRpcResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const deadline = Date.now() + timeoutMs
    const check = (): void => {
      const found = client.serverRequests.find((m) => m.method === method && predicate(m))
      if (found) {
        resolvePromise(found)
        return
      }
      if (Date.now() > deadline) {
        rejectPromise(new Error(`Timed out waiting for a "${method}" server request`))
        return
      }
      setTimeout(check, 25)
    }
    check()
  })
}

Given("an LSP server started in the test project", (world: GtdWorld) => {
  const proc = spawn(process.execPath, [GTD_BIN, "lsp"], {
    cwd: world.repoDir,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const client: LspClient = {
    proc,
    buffer: Buffer.alloc(0),
    nextId: 1,
    pending: new Map(),
    stderr: [],
    serverRequests: [],
  }
  proc.stdout.on("data", (chunk: Buffer) => {
    client.buffer = Buffer.concat([client.buffer, chunk])
    drain(client)
  })
  proc.stderr.on("data", (chunk: Buffer) => {
    client.stderr.push(chunk.toString("utf-8"))
  })
  clients.set(world, client)
})

When("the LSP client sends an initialize request", async (world: GtdWorld) => {
  const client = clients.get(world)!
  const response = await request(client, "initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(world.repoDir).toString(),
    capabilities: {},
  })
  ;(world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse = response
  notify(client, "initialized", {})
})

When(
  "the LSP client requests document symbols for {string} containing:",
  async (world: GtdWorld, path: string, content: string) => {
    const client = clients.get(world)!
    const uri = pathToFileURL(join(world.repoDir, path)).toString()
    notify(client, "textDocument/didOpen", {
      textDocument: { uri, languageId: "markdown", version: 1, text: content },
    })
    const response = await request(client, "textDocument/documentSymbol", {
      textDocument: { uri },
    })
    ;(world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse = response
  },
)

When(
  "the LSP client requests a definition at line {int} in {string} containing:",
  async (world: GtdWorld, line: number, path: string, content: string) => {
    const client = clients.get(world)!
    const uri = pathToFileURL(join(world.repoDir, path)).toString()
    notify(client, "textDocument/didOpen", {
      textDocument: { uri, languageId: "markdown", version: 1, text: content },
    })
    const response = await request(client, "textDocument/definition", {
      textDocument: { uri },
      position: { line, character: 0 },
    })
    ;(world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse = response
  },
)

When(
  "the LSP client requests code actions at line {int} in {string} containing:",
  async (world: GtdWorld, line: number, path: string, content: string) => {
    const client = clients.get(world)!
    const uri = pathToFileURL(join(world.repoDir, path)).toString()
    notify(client, "textDocument/didOpen", {
      textDocument: { uri, languageId: "markdown", version: 1, text: content },
    })
    const response = await request(client, "textDocument/codeAction", {
      textDocument: { uri },
      range: {
        start: { line, character: 0 },
        end: { line, character: 0 },
      },
      context: { diagnostics: [] },
    })
    ;(world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse = response
  },
)

Then(
  "the LSP response result points to {string} at line {int}",
  (world: GtdWorld, path: string, line: number) => {
    const response = (world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse
    const result = response.result as
      | { uri: string; range: { start: { line: number } } }
      | ReadonlyArray<{ uri: string; range: { start: { line: number } } }>
    const location = Array.isArray(result) ? result[0] : result
    assert.ok(location, `Expected a definition Location, got: ${JSON.stringify(response.result)}`)
    // The server anchors on the git toplevel (symlink-resolved on macOS), so
    // match the trailing path rather than the exact temp-dir prefix.
    assert.ok(
      location.uri.endsWith(`/${path}`),
      `Expected a Location ending in "/${path}", got: ${location.uri}`,
    )
    assert.strictEqual(location.range.start.line, line)
  },
)

When(
  "the LSP client sends a workspace\\/executeCommand request for {string}",
  async (world: GtdWorld, command: string) => {
    const client = clients.get(world)!
    const response = await request(client, "workspace/executeCommand", { command, arguments: [] })
    ;(world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse = response
  },
)

Then(
  "the LSP client received a window\\/showDocument request for {string}",
  (world: GtdWorld, path: string) => {
    const client = clients.get(world)!
    const expectedUri = pathToFileURL(join(world.repoDir, path)).toString()
    const found = client.serverRequests.some(
      (m) =>
        m.method === "window/showDocument" &&
        (m.params as { uri?: string } | undefined)?.uri === expectedUri,
    )
    assert.ok(
      found,
      `Expected a window/showDocument request for "${expectedUri}". Got server requests: ${JSON.stringify(
        client.serverRequests,
      )}`,
    )
  },
)

Then("the LSP response has no error", (world: GtdWorld) => {
  const response = (world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse
  assert.strictEqual(
    response.error,
    undefined,
    `Expected no LSP error, got: ${JSON.stringify(response.error)}`,
  )
})

Then("the LSP response result has a {string} capability", (world: GtdWorld, key: string) => {
  const response = (world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse
  const capabilities = (response.result as { capabilities?: Record<string, unknown> })?.capabilities
  assert.ok(
    capabilities !== undefined && key in capabilities,
    `Expected capabilities to include "${key}". Got: ${JSON.stringify(capabilities)}`,
  )
})

Then(
  "the LSP response result contains a symbol named {string}",
  (world: GtdWorld, name: string) => {
    const response = (world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse
    const symbols = response.result as ReadonlyArray<{ name: string }>
    assert.ok(
      symbols.some((s) => s.name === name),
      `Expected a symbol named "${name}". Got: ${JSON.stringify(symbols.map((s) => s.name))}`,
    )
  },
)

Then(
  "the LSP response result contains a code action titled {string}",
  (world: GtdWorld, title: string) => {
    const response = (world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse
    const actions = response.result as ReadonlyArray<{ title: string }>
    assert.ok(
      actions.some((a) => a.title === title),
      `Expected a code action titled "${title}". Got: ${JSON.stringify(actions.map((a) => a.title))}`,
    )
  },
)

Then(
  "the LSP client received a textDocument\\/publishDiagnostics notification for {string} with exactly one Information diagnostic containing {string}",
  async (world: GtdWorld, path: string, substring: string) => {
    const client = clients.get(world)!
    const expectedUri = pathToFileURL(join(world.repoDir, path)).toString()
    const notification = await waitForServerRequest(
      client,
      "textDocument/publishDiagnostics",
      (m) => (m.params as { uri?: string } | undefined)?.uri === expectedUri,
    )
    const diagnostics = (
      notification.params as { diagnostics: ReadonlyArray<{ message: string; severity: number }> }
    ).diagnostics
    assert.strictEqual(
      diagnostics.length,
      1,
      `Expected exactly one diagnostic for "${path}". Got: ${JSON.stringify(diagnostics)}`,
    )
    assert.strictEqual(diagnostics[0]!.severity, 3 /* DiagnosticSeverity.Information */)
    assert.ok(
      diagnostics[0]!.message.includes(substring),
      `Expected the diagnostic message to contain "${substring}". Got: ${diagnostics[0]!.message}`,
    )
  },
)

Then("the LSP response result is an empty symbol list", (world: GtdWorld) => {
  const response = (world as unknown as { lspLastResponse: JsonRpcResponse }).lspLastResponse
  const symbols = response.result as ReadonlyArray<{ name: string }>
  assert.ok(
    Array.isArray(symbols) && symbols.length === 0,
    `Expected no symbols. Got: ${JSON.stringify(symbols)}`,
  )
})

After(async (world: GtdWorld) => {
  const client = clients.get(world)
  if (!client) return
  clients.delete(world)
  notify(client, "exit", null)
  client.proc.kill()
})
