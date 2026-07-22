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

After(async (world: GtdWorld) => {
  const client = clients.get(world)
  if (!client) return
  clients.delete(world)
  notify(client, "exit", null)
  client.proc.kill()
})
