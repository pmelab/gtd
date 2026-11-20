import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { createServer, type Socket } from "node:net"
import { inMemoryTerminal } from "../twins/index.js"
import { runNowCommand, stateDirectory, SupervisorHost } from "./index.js"
import type { SharedProject } from "./Socket.js"

const dirs: string[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const wt = (
  path: string,
  status: "needsYou" | "error" | "working",
  extra: Record<string, unknown> = {},
) => ({
  path,
  branch: path.split("/").pop(),
  head: "h",
  main: false,
  gate: "/g",
  status,
  ...extra,
})

const setup = async (initial: SharedProject[], focusless = false, rows?: number) => {
  const root = mkdtempSync(join(tmpdir(), "gtd-now-"))
  dirs.push(root)
  writeFileSync(join(root, "gtd.workspace.ts"), "")
  const directory = stateDirectory(root, root)
  mkdirSync(directory, { recursive: true })
  let projects = initial
  let answer: "projects" | "refuse" | "stall" = "projects"
  let connections = 0
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    connections += 1
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("data", () => {
      if (answer === "projects") socket.end(`${JSON.stringify({ ok: true, projects })}\n`)
      if (answer === "refuse")
        socket.end(`${JSON.stringify({ ok: false, message: "no, not now" })}\n`)
    })
  })
  await new Promise<void>((listening) => server.listen(join(directory, "socket"), listening))
  closers.push(
    () =>
      new Promise((closed) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => closed())
      }),
  )
  const terminal = inMemoryTerminal()
  const raw: boolean[] = []
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: (on: boolean) => raw.push(on),
    resume: () => {},
    pause: () => {},
  })
  let screen = ""
  const output = {
    isTTY: true,
    columns: 80,
    ...(rows === undefined ? {} : { rows }),
    write: (s: string) => (screen += s),
  }
  const host = Layer.succeed(SupervisorHost, {
    defaultTerminal: () => terminal.adapter,
  } as never)
  const { focus: _focus, ...bare } = terminal.adapter
  const adapter = focusless ? bare : terminal.adapter
  const run = Effect.runPromise(
    runNowCommand({
      cwd: root,
      stateHome: root,
      loadModule: async () => ({
        workspace: { adapters: { terminal: adapter } },
      }),
      input,
      output,
      pollMs: 50,
    }).pipe(Effect.provide(host)),
  )
  while (screen === "") await delay(5)
  const last = () => screen.slice(screen.lastIndexOf("\x1b[H\x1b[2J"))
  return {
    terminal,
    raw,
    output: () => screen,
    input,
    last,
    run,
    set: (next: SharedProject[]) => (projects = next),
    answer: (next: typeof answer) => (answer = next),
    connections: () => connections,
    key: async (k: string) => {
      input.emit("data", k)
      await delay(30)
    },
  }
}

const project = (...worktrees: unknown[]): SharedProject =>
  ({ id: "p", name: "portal", worktrees }) as unknown as SharedProject

describe("gtd workspace now", () => {
  it("lists attention rows with the dashboard's words, then the working count, within 80 columns", async () => {
    const t = await setup([
      project(
        wt("/w/plan", "needsYou", {
          kind: "question",
          label: "Answer the plan",
        }),
        wt("/w/build", "error", {
          errorKind: "crashed",
          message: "x".repeat(200),
        }),
        wt("/w/a-very-long-worktree-name-that-goes-on-and-on", "error", {
          errorKind: "crashed",
          message: "y".repeat(100),
        }),
        wt("/w/" + "n".repeat(120), "error"),
        wt("/w/busy", "working"),
      ),
    ])
    await delay(20)
    const text = t.last()
    expect(text).toContain("needs you (question) Answer the plan")
    expect(text).toContain("error (crashed)")
    expect(text).toContain("1 working")
    const rows = text
      .split("\r\n")
      // eslint-disable-next-line no-control-regex
      .map((line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""))
      .slice(0, 4)
    expect(rows.map((r) => r.length)).toEqual([52, 79, 79, 79])
    await t.key("q")
    await t.run
  })

  it("follows status changes without a key press", async () => {
    const t = await setup([project(wt("/w/plan", "working"))])
    await delay(20)
    expect(t.last()).toContain("Nothing needs you")
    t.set([project(wt("/w/plan", "needsYou", { kind: "question" }))])
    await delay(200)
    expect(t.last()).toContain("needs you (question)")
    await t.key("q")
    await t.run
  })

  it("jumps with Enter and number keys; a number with no row does nothing", async () => {
    const t = await setup([
      project(
        wt("/w/one", "needsYou", { pane: "pane-1" }),
        wt("/w/two", "needsYou", { pane: "pane-2" }),
      ),
    ])
    const pane1 = await t.terminal.adapter.run("p", "/w/one", ["x"], {})
    const pane2 = await t.terminal.adapter.run("p", "/w/two", ["x"], {})
    expect([pane1, pane2]).toEqual(["pane-1", "pane-2"])
    await t.key("j")
    await t.key("\r")
    await t.key("k")
    await t.key("\r")
    await t.key("5")
    await t.key("2")
    expect(t.terminal.focused()).toEqual(["pane-2", "pane-1", "pane-2"])
    await t.key("q")
    await t.run
  })

  it("ignores Delete, Page Up and F-keys instead of reading their digits", async () => {
    const t = await setup([
      project(
        wt("/w/one", "needsYou", { pane: "pane-1" }),
        wt("/w/two", "needsYou", { pane: "pane-2" }),
      ),
    ])
    await t.terminal.adapter.run("p", "/w/one", ["x"], {})
    await t.terminal.adapter.run("p", "/w/two", ["x"], {})
    await t.key("\x1b[3~")
    await t.key("\x1b[5~")
    await t.key("\x1b[15~")
    await t.key("\x1b[1;2A\x1b[B")
    await t.key("\r")
    expect(t.terminal.focused()).toEqual(["pane-2"])
    await t.key("q")
    await t.run
  })

  it("shows the handle and path without focus, and the path without a pane", async () => {
    const t = await setup(
      [project(wt("/w/one", "needsYou", { pane: "pane-9" }), wt("/w/two", "needsYou"))],
      true,
    )
    await t.key("1")
    await delay(20)
    expect(t.last()).toContain("pane-9")
    expect(t.last()).toContain("/w/one")
    await t.key("2")
    await delay(20)
    expect(t.last()).toContain("/w/two")
    expect(t.terminal.focused()).toEqual([])
    await t.key("q")
    await t.run
  })

  it("shows a failing focus and keeps running, then quits and restores the terminal", async () => {
    const t = await setup([project(wt("/w/one", "needsYou", { pane: "gone" }))])
    await t.key("\r")
    await delay(20)
    expect(t.last()).toContain("no pane gone")
    await t.key("q")
    await t.run
    expect(t.output().endsWith("\x1b[?25h\x1b[?1049l")).toBe(true)
    expect(t.raw).toEqual([true, false])
  })

  it("shows the supervisor's refusal while polling", async () => {
    const t = await setup([project(wt("/w/plan", "working"))])
    t.answer("refuse")
    await delay(150)
    expect(t.last()).toContain("no, not now")
    expect(t.last()).not.toContain("supervisor not running")
    await t.key("q")
    await t.run
  })

  it("keeps one read open against a supervisor that never answers, and gives up on it", async () => {
    const t = await setup([project(wt("/w/plan", "working"))])
    t.answer("stall")
    const before = t.connections()
    await delay(400)
    expect(t.connections() - before).toBeLessThanOrEqual(2)
    expect(t.last()).toContain("the supervisor did not answer — trying again")
    await t.key("q")
    await t.run
  })

  it("fits the list to the terminal's height and scrolls it with the selection", async () => {
    const names = ["a", "b", "c", "d", "e", "f"]
    const t = await setup([project(...names.map((n) => wt(`/w/${n}`, "needsYou")))], false, 5)
    const visible = () =>
      t
        .last()
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
        .split("\r\n")
    expect(visible()).toEqual([
      "> 1 portal a needs you",
      "  2 portal b needs you",
      "  3 portal c needs you",
      "0 working",
    ])
    for (let i = 0; i < 4; i += 1) await t.key("j")
    expect(visible()).toEqual([
      "  3 portal c needs you",
      "  4 portal d needs you",
      "> 5 portal e needs you",
      "0 working",
    ])
    await t.key("k")
    await t.key("k")
    await t.key("k")
    expect(visible().slice(0, 3)).toEqual([
      "> 2 portal b needs you",
      "  3 portal c needs you",
      "  4 portal d needs you",
    ])
    await t.key("q")
    await t.run
  })

  it("shrinks the list for a notice and a message, so the frame still fits the screen", async () => {
    const names = ["a", "b", "c", "d"]
    const t = await setup([project(...names.map((n) => wt(`/w/${n}`, "needsYou")))], false, 5)
    const visible = () =>
      t
        .last()
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
        .split("\r\n")
    t.answer("refuse")
    await delay(150)
    await t.key("1")
    expect(visible()).toEqual([
      "> 1 portal a needs you",
      "0 working",
      "no, not now",
      "no driver pane — /w/a",
    ])
    await t.key("q")
    await t.run
  })
})
