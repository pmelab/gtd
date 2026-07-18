import { Given, When, Then, After } from "quickpickle"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL, fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// `gtd lsp` is a long-running stdio server, unlike every other subcommand's
// run-to-completion `execFile` — so it can't go through the @inmem tier (no
// separate process to pipe stdin/stdout to) or the @live tier's `runGtdLive`
// (which waits for exit). These steps speak the real Content-Length-framed
// JSON-RPC protocol against a real spawned `gtd lsp` process instead.

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

interface JsonRpcMessage {
  readonly jsonrpc: "2.0"
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

interface LspSession {
  readonly proc: ChildProcessWithoutNullStreams
  nextId: number
  readonly pending: Map<number, (result: unknown) => void>
  readonly serverRequests: JsonRpcMessage[]
  lastResult: unknown
}

const sessions = new WeakMap<GtdWorld, LspSession>()

const encode = (message: object): Buffer => {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(json, "utf8")])
}

/** Feeds raw stdout bytes through Content-Length framing, dispatching each parsed message. */
class Framer {
  private buffer = Buffer.alloc(0)
  constructor(private readonly onMessage: (message: JsonRpcMessage) => void) {}

  // fallow-ignore-next-line complexity
  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString("ascii")
      const match = /Content-Length: (\d+)/.exec(header)
      if (!match) return
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8")
      this.buffer = this.buffer.subarray(bodyStart + length)
      this.onMessage(JSON.parse(body) as JsonRpcMessage)
    }
  }
}

const sendRequest = (session: LspSession, method: string, params: unknown): Promise<unknown> => {
  const id = session.nextId++
  return new Promise((resolve) => {
    session.pending.set(id, resolve)
    session.proc.stdin.write(encode({ jsonrpc: "2.0", id, method, params }))
  })
}

const sendNotification = (session: LspSession, method: string, params: unknown): void => {
  session.proc.stdin.write(encode({ jsonrpc: "2.0", method, params }))
}

const uriFor = (world: GtdWorld, path: string): string =>
  pathToFileURL(join(world.repoDir, path)).toString()

const openDocument = (session: LspSession, world: GtdWorld, path: string): string => {
  const uri = uriFor(world, path)
  sendNotification(session, "textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "markdown",
      version: 1,
      text: readFileSync(join(world.repoDir, path), "utf-8"),
    },
  })
  return uri
}

Given("a running gtd lsp server", async (world: GtdWorld) => {
  const proc = spawn(process.execPath, [GTD_BIN, "lsp"], { cwd: world.repoDir })
  const session: LspSession = {
    proc,
    nextId: 1,
    pending: new Map(),
    serverRequests: [],
    lastResult: undefined,
  }
  sessions.set(world, session)

  // fallow-ignore-next-line complexity
  const framer = new Framer((message) => {
    if (message.id !== undefined && message.method === undefined) {
      const resolve = session.pending.get(message.id)
      if (resolve) {
        session.pending.delete(message.id)
        resolve(message.result ?? message.error)
      }
      return
    }
    if (message.id !== undefined && message.method !== undefined) {
      // A request FROM the server (e.g. window/showDocument) — record it and
      // acknowledge so the server's own await doesn't hang.
      session.serverRequests.push(message)
      session.proc.stdin.write(encode({ jsonrpc: "2.0", id: message.id, result: null }))
    }
  })
  proc.stdout.on("data", (chunk: Buffer) => framer.push(chunk))

  await sendRequest(session, "initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(world.repoDir).toString(),
    capabilities: { window: { showDocument: { support: true } } },
  })
  sendNotification(session, "initialized", {})
})

After(async (world: GtdWorld) => {
  const session = sessions.get(world)
  if (session) {
    session.proc.kill()
    sessions.delete(world)
  }
})

When("I request document symbols for {string}", async (world: GtdWorld, path: string) => {
  const session = sessions.get(world)!
  const uri = openDocument(session, world, path)
  session.lastResult = await sendRequest(session, "textDocument/documentSymbol", {
    textDocument: { uri },
  })
})

When(
  "I request code actions at line containing {string} of {string}",
  async (world: GtdWorld, needle: string, path: string) => {
    const session = sessions.get(world)!
    const uri = openDocument(session, world, path)
    const lines = readFileSync(join(world.repoDir, path), "utf-8").split(/\r?\n/)
    const line = lines.findIndex((l) => l.includes(needle))
    assert.ok(line !== -1, `no line containing "${needle}" in ${path}`)
    session.lastResult = await sendRequest(session, "textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line, character: 0 }, end: { line, character: 0 } },
      context: { diagnostics: [] },
    })
  },
)

interface WorkspaceEditLike {
  readonly changes?: Record<
    string,
    ReadonlyArray<{
      range: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      newText: string
    }>
  >
}

/** Applies a WorkspaceEdit exactly as an editor accepting the code action would. */
const applyWorkspaceEdit = (edit: WorkspaceEditLike): void => {
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const path = fileURLToPath(uri)
    const lines = readFileSync(path, "utf-8").split(/\r?\n/)
    for (const textEdit of edits) {
      const line = lines[textEdit.range.start.line]!
      lines[textEdit.range.start.line] =
        line.slice(0, textEdit.range.start.character) +
        textEdit.newText +
        line.slice(textEdit.range.end.character)
    }
    writeFileSync(path, lines.join("\n"))
  }
}

When("I apply the code action titled {string}", (world: GtdWorld, title: string) => {
  const session = sessions.get(world)!
  const actions = session.lastResult as ReadonlyArray<{ title: string; edit: WorkspaceEditLike }>
  const action = actions.find((a) => a.title === title)
  assert.ok(
    action,
    `no code action titled "${title}" — got: ${actions.map((a) => a.title).join(", ")}`,
  )
  applyWorkspaceEdit(action.edit)
})

When("I run the gtd.openSteeringFile command", async (world: GtdWorld) => {
  const session = sessions.get(world)!
  await sendRequest(session, "workspace/executeCommand", {
    command: "gtd.openSteeringFile",
    arguments: [],
  })
})

Then("there are {int} document symbols", (world: GtdWorld, count: number) => {
  const session = sessions.get(world)!
  const symbols = session.lastResult as ReadonlyArray<unknown>
  assert.strictEqual(symbols.length, count)
})

Then("the document symbols include {string}", (world: GtdWorld, name: string) => {
  const session = sessions.get(world)!
  const symbols = session.lastResult as ReadonlyArray<{ name: string }>
  assert.ok(
    symbols.some((s) => s.name === name),
    `expected a symbol named "${name}" — got: ${symbols.map((s) => s.name).join(", ")}`,
  )
})

Then("the first symbol's children include {string}", (world: GtdWorld, name: string) => {
  const session = sessions.get(world)!
  const symbols = session.lastResult as ReadonlyArray<{
    children?: ReadonlyArray<{ name: string }>
  }>
  const children = symbols[0]?.children ?? []
  assert.ok(
    children.some((c) => c.name === name),
    `expected a child symbol named "${name}" — got: ${children.map((c) => c.name).join(", ")}`,
  )
})

Then("the server asked to show document {string}", (world: GtdWorld, path: string) => {
  const session = sessions.get(world)!
  const expectedUri = uriFor(world, path)
  const request = session.serverRequests.find((r) => r.method === "window/showDocument")
  assert.ok(
    request,
    `no window/showDocument request received — got: ${session.serverRequests.map((r) => r.method).join(", ")}`,
  )
  assert.strictEqual((request.params as { uri: string }).uri, expectedUri)
})

Then(
  "the server showed an information message containing {string}",
  (world: GtdWorld, needle: string) => {
    const session = sessions.get(world)!
    const request = session.serverRequests.find(
      (r) => r.method === "window/showMessageRequest" || r.method === "window/showMessage",
    )
    assert.ok(
      request,
      `no window/showMessage(Request) received — got: ${session.serverRequests.map((r) => r.method).join(", ")}`,
    )
    const message = (request.params as { message: string }).message
    assert.ok(
      message.includes(needle),
      `expected message to contain "${needle}" — got: "${message}"`,
    )
  },
)
