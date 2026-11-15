import { randomBytes } from "node:crypto"
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createConnection, createServer, type Socket } from "node:net"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { UiError } from "../ui/index.js"
import { findWorkspaceModule } from "./Config.js"
import { stateDirectory } from "./Lock.js"
import { pauseScope } from "./Pauses.js"

/** One request per connection: a JSON line in, a JSON line back. */
export type ControlRequest =
  | {
      readonly command: "proceed" | "retry"
      /** The worktree's path. */
      readonly worktree: string
      readonly commit: string
    }
  | {
      readonly command: "note"
      readonly worktree: string
      /** `null` takes the note off. */
      readonly note: { readonly message: string; readonly error: boolean } | null
    }
  | {
      readonly command: "pause" | "resume"
      /** Absent: the workspace. */
      readonly project?: string
      /** A feed of `project`. */
      readonly feed?: string
      /** Answer once no driver runs in the scope. */
      readonly wait?: boolean
    }

export type ControlReply = { readonly ok: true } | { readonly ok: false; readonly message: string }

export const socketPath = (directory: string): string => join(directory, "socket")

const MAX_REQUEST_BYTES = 64 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const parseJson = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const parseRequest = (line: string): ControlRequest | undefined => {
  const value = parseJson(line)
  if (!isRecord(value)) return undefined
  const { command } = value
  if (command === "pause" || command === "resume") return parsePause(command, value)
  return parseWorktreeRequest(value)
}

const parseWorktreeRequest = ({
  command,
  worktree,
  commit,
  note,
}: Record<string, unknown>): ControlRequest | undefined => {
  if (typeof worktree !== "string") return undefined
  if (command === "note") {
    const parsed = parseNote(note)
    return parsed === undefined ? undefined : { command, worktree, note: parsed }
  }
  if (command !== "proceed" && command !== "retry") return undefined
  if (typeof commit !== "string") return undefined
  return { command, worktree, commit }
}

const parsePause = (
  command: "pause" | "resume",
  value: Record<string, unknown>,
): ControlRequest | undefined => {
  const scope = pauseScope(value)
  const { wait } = value
  if (scope === undefined || (wait !== undefined && typeof wait !== "boolean")) return undefined
  return { command, ...scope, ...(wait === true ? { wait } : {}) }
}

/** `null` clears; `undefined` is no note at all. */
const parseNote = (note: unknown): { message: string; error: boolean } | null | undefined => {
  if (note === null) return null
  if (!isRecord(note)) return undefined
  const { message, error } = note
  if (typeof message !== "string" || typeof error !== "boolean") return undefined
  return { message, error }
}

const spoolOf = (stateDirectory: string): string => join(stateDirectory, "spool")

/** Keeps a request for the next supervisor; the names sort in the order they were written. */
const spool = (stateDirectory: string, request: ControlRequest): void => {
  const directory = spoolOf(stateDirectory)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const name = `${Date.now().toString().padStart(15, "0")}-${process.hrtime.bigint()}-${randomBytes(4).toString("hex")}.json`
  // Renamed into place, so a starting supervisor never reads half a request.
  const file = join(directory, name)
  writeFileSync(`${file}.tmp`, `${JSON.stringify(request)}\n`, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

/** Hands each spooled request to `handle`, oldest first, and deletes it; the refusals. */
export const drainSpool = async (
  stateDirectory: string,
  handle: (request: ControlRequest) => Promise<ControlReply>,
): Promise<readonly string[]> => {
  const directory = spoolOf(stateDirectory)
  let names: string[]
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"))
  } catch {
    return []
  }
  const refusals: string[] = []
  for (const name of names.sort()) {
    const file = join(directory, name)
    const request = parseRequest(readFileSync(file, "utf8").trim())
    const reply: ControlReply =
      request === undefined
        ? { ok: false, message: "the supervisor does not know this request" }
        : await handle(request)
    if (!reply.ok) refusals.push(`${name}: ${reply.message}`)
    rmSync(file, { force: true })
  }
  return refusals
}

/** Reads up to the first newline; `undefined` when the peer ends first or sends too much. */
const readLine = (socket: Socket): Promise<string | undefined> =>
  new Promise((done) => {
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf("\n")
      if (end !== -1) return done(buffer.slice(0, end))
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy()
        done(undefined)
      }
    })
    socket.on("end", () => done(undefined))
    socket.on("close", () => done(undefined))
    socket.on("error", () => done(undefined))
  })

export interface ControlSocket {
  readonly close: () => Promise<void>
}

/**
 * Listens on `path` for the CLI. Only the owner may connect: the file is
 * 0600 and its directory 0700 — those permissions are the authentication.
 */
export const serveSocket = async (
  path: string,
  handle: (request: ControlRequest) => Promise<ControlReply>,
): Promise<ControlSocket> => {
  // The socket is open to anyone until its own chmod below; the directory is not.
  chmodSync(dirname(path), 0o700)
  // The lock makes this the only supervisor: a socket left here is stale.
  rmSync(path, { force: true })
  const open = new Set<Socket>()
  const server = createServer((socket) => {
    open.add(socket)
    socket.on("close", () => open.delete(socket))
    void readLine(socket).then(async (line) => {
      if (line === undefined) return
      const request = parseRequest(line)
      const reply: ControlReply =
        request === undefined
          ? { ok: false, message: "the supervisor does not know this request" }
          : await handle(request).catch(
              (error: unknown): ControlReply => ({
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              }),
            )
      if (!socket.destroyed) socket.end(`${JSON.stringify(reply)}\n`)
    })
  })
  await new Promise<void>((listening, failed) => {
    server.once("error", failed)
    server.listen(path, () => {
      server.off("error", failed)
      listening()
    })
  }).catch((error: unknown) => {
    throw new UiError(
      `gtd workspace: cannot listen on ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
  chmodSync(path, 0o600)
  return {
    close: () =>
      new Promise((closed) => {
        rmSync(path, { force: true })
        // A press still waiting for its driver must not hold the shutdown.
        for (const socket of open) socket.destroy()
        server.close(() => closed())
      }),
  }
}

/** The supervisor's reply, or `undefined` when no supervisor listens at `path`. */
const send = (path: string, request: ControlRequest): Promise<ControlReply | undefined> =>
  new Promise((answered, failed) => {
    const socket = createConnection(path)
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") answered(undefined)
      else failed(error)
    })
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`)
      void readLine(socket).then((line) => {
        socket.destroy()
        let reply: unknown
        try {
          reply = line === undefined ? undefined : JSON.parse(line)
        } catch {
          reply = undefined
        }
        if (isRecord(reply) && reply["ok"] === true) return answered({ ok: true })
        if (isRecord(reply) && typeof reply["message"] === "string") {
          return answered({ ok: false, message: reply["message"] })
        }
        failed(new Error("the supervisor ended before it answered"))
      })
    })
  })

export interface ControlCommand {
  readonly request: ControlRequest
  readonly config?: string
  readonly cwd: string
  readonly stateHome: string
}

const resolvePath = (cwd: string, path: string): string => {
  const absolute = resolve(cwd, path)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

/**
 * `gtd workspace proceed|retry|note|pause|resume`: hands the request to the running
 * supervisor. With none running, a note waits in the spool.
 */
export const runControlCommand = (command: ControlCommand): Effect.Effect<void, UiError> =>
  Effect.tryPromise({
    try: async () => {
      const prefix = `gtd workspace ${command.request.command}`
      const file = findWorkspaceModule(command.cwd, command.config)
      const directory = stateDirectory(command.stateHome, dirname(file))
      const path = socketPath(directory)
      const request =
        "worktree" in command.request
          ? { ...command.request, worktree: resolvePath(command.cwd, command.request.worktree) }
          : command.request
      const reply = await send(path, request).catch((error: unknown) => {
        throw new UiError(`${prefix}: ${error instanceof Error ? error.message : String(error)}`)
      })
      if (reply === undefined && request.command === "note") return spool(directory, request)
      if (reply === undefined) {
        throw new UiError(`${prefix}: supervisor not running for ${dirname(file)}`)
      }
      if (!reply.ok) throw new UiError(`${prefix}: ${reply.message}`)
    },
    catch: (error) =>
      error instanceof UiError
        ? error
        : new UiError(error instanceof Error ? error.message : String(error)),
  })
