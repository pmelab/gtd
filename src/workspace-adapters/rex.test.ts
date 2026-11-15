import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { terminalContract, type TerminalHarness } from "../workspace-testkit/index.js"
import { changedPane, rex } from "./rex.js"

const which = (command: string): string | undefined => {
  try {
    return execFileSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim()
  } catch {
    return undefined
  }
}

const REX = which("rex")
const BASH = which("bash")

// The probe is a node script: it records what it sees, prints the OSC 7501
// records it was given, and ends as told.
const PROBE = `
const fs = require("node:fs")
const [spec, ...args] = process.argv.slice(2)
const { out, end, report } = JSON.parse(spec)
fs.writeFileSync(out + ".tmp", JSON.stringify({ pid: process.pid, env: process.env, args }))
fs.renameSync(out + ".tmp", out)
const b64 = (s) => Buffer.from(s).toString("base64")
const osc = (fields) => process.stdout.write("\\u001b]7501;" + fields + "\\u001b\\\\")
if (report) {
  osc(["state=" + report.state, report.kind && "kind=" + report.kind, report.title && "title=" + b64(report.title), report.msg && "msg=" + b64(report.msg)].filter(Boolean).join(":"))
  osc("id=probe:state=working")
}
const finish = () => {
  if (end === "hold") {
    if (fs.existsSync(out + ".release")) process.exit(0)
    return setTimeout(finish, 50)
  }
  if (end.signal) return process.kill(process.pid, end.signal)
  process.exit(end.exit)
}
setTimeout(finish, 100)
`

let workspace = ""
let server: ChildProcess | undefined
let address = ""
let sessions = 0

const rexCli = (...args: string[]): string =>
  execFileSync(REX!, ["-S", address, "--autostart=false", ...args], { encoding: "utf8" })

const harness: TerminalHarness = {
  setup: async () => {
    const project = `contract-${++sessions}`
    const worktree = join(workspace, project)
    mkdirSync(worktree, { recursive: true })
    const probeFile = join(workspace, "probe.cjs")
    let probes = 0
    return {
      adapter: rex({ server: address, shell: BASH! }),
      project,
      worktree,
      login: { name: "GTD_CONTRACT_LOGIN", value: "from the startup files" },
      probe: (spec) => {
        const out = join(worktree, `probe-${++probes}.json`)
        const config = JSON.stringify({ out, end: spec.end, report: spec.report })
        return {
          argv: [process.execPath, probeFile, config, ...(spec.args ?? [])],
          sight: async () =>
            existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as never) : undefined,
          release: async () => writeFileSync(`${out}.release`, ""),
        }
      },
      topProcess: async (handle) =>
        (
          JSON.parse(rexCli("block", "call", "-b", handle, "process")) as {
            child?: { pid: number }
          }
        ).child?.pid,
      dispose: async () => {
        try {
          rexCli("kill", project)
        } catch {
          // A case that failed before its first pane has no session.
        }
      },
    }
  },
}

describe.skipIf(REX === undefined || BASH === undefined)(
  "the rex adapter, on a private Rex server",
  () => {
    beforeAll(async () => {
      workspace = realpathSync(mkdtempSync(join(tmpdir(), "gtd-rex-")))
      const home = join(workspace, "home")
      mkdirSync(home)
      writeFileSync(join(home, ".bash_profile"), ". ~/.bashrc\n")
      writeFileSync(join(home, ".bashrc"), 'export GTD_CONTRACT_LOGIN="from the startup files"\n')
      writeFileSync(join(workspace, "probe.cjs"), PROBE)
      address = `unix://${join(workspace, "rex.sock")}`
      server = spawn(
        REX!,
        [
          "server",
          "run",
          "--listen",
          address,
          "--restore=false",
          "--state-dir",
          join(workspace, "state"),
        ],
        {
          env: { PATH: process.env["PATH"], HOME: home, SHELL: BASH, XDG_RUNTIME_DIR: workspace },
          stdio: "ignore",
        },
      )
      for (let i = 0; i < 100 && !existsSync(join(workspace, "rex.sock")); i++) await delay(50)
    }, 30_000)

    afterAll(() => {
      server?.kill()
      rmSync(workspace, { recursive: true, force: true })
    })

    describe("passes the terminal contract", () => {
      for (const contractCase of terminalContract(harness)) {
        it(contractCase.name, contractCase.run, 30_000)
      }
    })

    const exitedPane = async (adapter: ReturnType<typeof rex>, handle: string) => {
      for (let i = 0; i < 300; i++) {
        const status = await adapter.status(handle)
        if (status?.exit !== null) return status
        await delay(50)
      }
      throw new Error("the command never exited")
    }

    // The OSC 7501 spec: a terminal drops `working` and `blocked` when the
    // process exits, and keeps `done` and `error`. A kept pane starts no shell
    // after the exit, so no prompt clears what is left.
    it("keeps an error record after the command exits, with its message", async () => {
      const fixture = await harness.setup()
      try {
        const probe = fixture.probe({
          end: { exit: 3 },
          report: { state: "error", msg: "the build broke" },
        })
        const handle = await fixture.adapter.run(fixture.project, fixture.worktree, probe.argv, {})
        const status = await exitedPane(fixture.adapter as ReturnType<typeof rex>, handle)
        expect(status).toEqual({
          record: { state: "error", msg: "the build broke" },
          alive: false,
          busy: false,
          exit: { code: 3 },
        })
      } finally {
        await fixture.dispose()
      }
    }, 30_000)

    it("drops a working record when the command exits", async () => {
      const fixture = await harness.setup()
      try {
        const probe = fixture.probe({
          end: { exit: 0 },
          report: { state: "working", title: "Build" },
        })
        const handle = await fixture.adapter.run(fixture.project, fixture.worktree, probe.argv, {})
        const status = await exitedPane(fixture.adapter as ReturnType<typeof rex>, handle)
        expect(status?.record).toBeUndefined()
      } finally {
        await fixture.dispose()
      }
    }, 30_000)

    it("watch() names a pane whose command exits", async () => {
      const fixture = await harness.setup()
      try {
        const probe = fixture.probe({ end: "hold" })
        const handle = await fixture.adapter.run(fixture.project, fixture.worktree, probe.argv, {})
        const hints = fixture.adapter.watch!()[Symbol.asyncIterator]()
        const seen = (async () => {
          for (;;) {
            const hint = await hints.next()
            if (hint.done === true || hint.value === handle) return hint.value
          }
        })()
        await delay(500)
        await probe.release()
        expect(await seen).toBe(handle)
        await hints.return?.()
      } finally {
        await fixture.dispose()
      }
    }, 30_000)
  },
)

describe("changedPane", () => {
  const blockEvent = (name: string): string =>
    JSON.stringify({
      type: "session_event",
      payload: {
        session_id: "session:1",
        event: { type: "block_event", payload: { block_id: "block:1", name, payload: {} } },
      },
    })

  it("names the block of a status, process or exit event", () => {
    expect(
      ["program_status_changed", "program_status_removed", "process_changed", "child_exited"].map(
        (name) => changedPane(blockEvent(name)),
      ),
    ).toEqual(["block:1", "block:1", "block:1", "block:1"])
  })

  it("names a closed block", () => {
    const line = JSON.stringify({
      type: "session_event",
      payload: { event: { type: "block_closed", payload: { block_id: "block:2" } } },
    })
    expect(changedPane(line)).toBe("block:2")
  })

  it("ignores other events and lines that are not JSON", () => {
    expect(changedPane(blockEvent("pwd_changed"))).toBeUndefined()
    expect(changedPane(JSON.stringify({ type: "client_joined", payload: {} }))).toBeUndefined()
    expect(changedPane("Error: no Rex server")).toBeUndefined()
  })
})
