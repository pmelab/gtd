import { atom, read, update } from "claude-code"
import type { EngineInterface, Register } from "claude-code"

import type { Run, Stop } from "../types"
import { drive, isTrue } from "./drive"
import type { Beat, Io, Landing, TurnEnd } from "./drive"
import { ship } from "./ship"
import type { ShipIo } from "./ship"

type $ = EngineInterface

const run = atom({ plugin: "gtd", key: "run" } as const, { isRunning: false, beat: 0 } as Run)
// memory scope (`<scope>#<hash7>`) -> the subagent holding that conversation
const scopes = atom({ plugin: "gtd", key: "scopes" } as const, {} as Record<string, string>)
const agents = atom({ plugin: "gtd", key: "agents" } as const, [] as string[])

const TEN_MINUTES = 600_000

// gtd refuses outside the repository root; every process runs there.
let root = "."
let gateUi: { stop(): void } | undefined
// bumped per rest, so an answer or hand-back for an older rest is ignored
let gateToken = 0
let lastGate: { state?: string; head: string } | undefined

let stopRequested = false
const ours = new Set<string>()
const waiting = new Map<string, (end: TurnEnd) => void>()
const ended = new Map<string, TurnEnd>()
const personas = new Set<string>()

const turnEnd = (id: string) =>
  new Promise<TurnEnd>((resolve) => {
    const done = ended.get(id)
    if (done) {
      ended.delete(id)
      resolve(done)
    } else waiting.set(id, resolve)
  })

async function gtd($: $, args: string[], stdin?: string) {
  const r = await $.process.run(["gtd", ...args], { cwd: root, stdin, timeoutMs: TEN_MINUTES })
  if (r.exitCode !== 0) {
    throw new Error(`gtd ${args.join(" ")} exited ${r.exitCode}: ${r.stderr.trim()}`)
  }
  return r.stdout
}

// One agent type per system prompt. A registered type's prompt replaces the
// session's system prompt, as `--system-prompt` does for the sh driver.
async function persona($: $, system: string) {
  const bytes = new TextEncoder().encode(system)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  const name =
    "p-" + Array.from(digest.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("")
  if (!personas.has(name)) {
    await $.agent.register({
      name,
      description: "gtd workflow persona, spawned by the gtd driver only",
      prompt: system,
      permissionMode: "bypassPermissions",
    })
    personas.add(name)
  }
  return `gtd:${name}`
}

async function send($: $, agentId: string, text: string) {
  const end = turnEnd(agentId)
  const sent = await $.session.send({ to: { agentId }, text })
  if (sent.isDelivered) return end
  waiting.delete(agentId)
  return undefined
}

function io($: $): Io {
  return {
    next: async () => JSON.parse(await gtd($, ["next", "--json"])) as Beat,
    plain: () => gtd($, ["next"]),
    land: async (verdict) =>
      JSON.parse(
        verdict === undefined
          ? await gtd($, ["land", "--json"])
          : await gtd($, ["judge", "answer", "--json"], verdict),
      ) as Landing,
    sh: async (script, log) => {
      // Streamed, not `$.process.run`: a check beat can outlast run's 10-minute cap.
      const argv = log
        ? ["sh", "-c", 'sh -c "$1" >>"$2" 2>&1', "gtd", script, log]
        : ["sh", "-c", script]
      const child = $.process.spawn({ argv, cwd: root })
      for await (const _ of child);
      return (await child.result).code ?? 1
    },
    check: async (script) => {
      const r = await $.process.run(["sh", "-c", script], { cwd: root, timeoutMs: TEN_MINUTES })
      return { ok: r.exitCode === 0, out: (r.stdout + r.stderr).trim() }
    },
    judge: async () => {
      const key = (await $.env.get("TYPESAFE_API_KEY")) ?? (await $.env.get("TYPESAFE_AI_KEY"))
      if (!key) return undefined
      try {
        const doc = await gtd($, ["judge", "--json"])
        const r = await $.process.run(["gtd", "judge", "run", "--provider", "jev"], {
          cwd: root,
          stdin: doc,
          env: { TYPESAFE_API_KEY: key },
          timeoutMs: TEN_MINUTES,
        })
        return r.exitCode === 0 && r.stdout.trim() ? r.stdout : undefined
      } catch {
        return undefined
      }
    },
    turn: async (t) => {
      const known = (await read($, scopes))[t.memory]
      if (t.resume && known) {
        const end = await send($, known, t.prompt)
        if (end) return end
      }
      // No live conversation for this scope (fresh scope, or this session never
      // held it): start one, as the sh driver falls back to `--session-id`.
      const spawned = await $.agent.spawn({
        subagentType: t.system ? await persona($, t.system) : "general-purpose",
        prompt: t.prompt,
        description: t.label || "gtd",
        model: t.model,
        cwd: root,
      })
      const id = spawned.agentId
      if (!id) return { ok: false, why: spawned.deny ?? "subagent spawn refused" }
      ours.add(id)
      await update($, agents, (list) => [...list, id].slice(-200))
      await update($, scopes, (s) => ({ ...s, [t.memory]: id }))
      return turnEnd(id)
    },
    resume: async (memory, text) => {
      const id = (await read($, scopes))[memory]
      const end = id ? await send($, id, text) : undefined
      return end ?? { ok: false, why: `no live subagent for ${memory}` }
    },
    progress: (beat, b) => {
      void update($, run, (r) => ({ ...r, beat, state: b.state, label: b.label }))
    },
    stopped: () => stopRequested,
  }
}

async function findRoot($: $) {
  const r = await $.process.run(["git", "rev-parse", "--show-toplevel"])
  root = r.exitCode === 0 ? r.stdout.trim() : "."
}

async function head($: $) {
  return (await $.process.run(["git", "rev-parse", "HEAD"], { cwd: root })).stdout.trim()
}

async function start($: $) {
  if ((await read($, run)).isRunning) return
  closeUi()
  stopRequested = false
  await findRoot($)
  await update($, run, () => ({ isRunning: true, beat: 0 }))
  void drive(io($))
    .catch((err: unknown): Stop => ({ kind: "error", text: String(err) }))
    .then(async (stop) => {
      const at = { state: stop.state, head: await head($) }
      const isRepeat =
        stop.kind === "gate" && at.state === lastGate?.state && at.head === lastGate?.head
      lastGate = at
      await update($, run, (r) => ({ ...r, isRunning: false, stop, isRepeat }))
      $.ui.toast(`gtd: ${headline(stop)}`)
      if (stop.kind === "gate" || stop.kind === "done") await openGate($)
    })
}

// A new process starts from the requirements written to the steering file an
// idle rest names; the opening beat captures them like a hand-edit.
async function begin($: $, requirements: string) {
  await findRoot($)
  const b = JSON.parse(await gtd($, ["next", "--json"])) as Beat
  if (b.state !== "idle" || !isTrue(b.idle)) {
    return `A gtd process is already underway at ${b.state}. Run /gtd to continue it.`
  }
  const file = b.file ?? ".gtd/TODO.md"
  const path = `${root}/${file}`
  await $.process.run(["mkdir", "-p", path.slice(0, path.lastIndexOf("/"))])
  await $.fs.write(path, requirements + "\n")
  await start($)
  return `Started a new gtd process from ${file}.`
}

function closeUi() {
  gateUi?.stop()
  gateUi = undefined
}

const PROCEED = "Proceed"

// `gtd ui` serves exactly one rest and exits 0 once the person hands the turn
// back from the web client; that hand-back proceeds as the Proceed answer does.
function serveUi($: $, token: number) {
  let isKilled = false
  let ready = () => {}
  const isReady = new Promise<void>((resolve) => (ready = resolve))
  const child = $.process.spawn({ argv: ["gtd", "ui"], cwd: root })
  gateUi = {
    stop: () => {
      isKilled = true
      void child.return({ code: null, signal: "SIGTERM" })
    },
  }
  void (async () => {
    let err = ""
    try {
      for await (const chunk of child) {
        const url = chunk.stream === "stdout" ? /https?:\/\/\S+/.exec(chunk.text)?.[0] : undefined
        if (url) {
          await update($, run, (r) => ({ ...r, url }))
          ready()
        }
        if (chunk.stream === "stderr") err += chunk.text
      }
      const { code } = await child.result
      if (isKilled || token !== gateToken) return
      if (code === 0) return await proceed($)
      const uiNote = err.trim().replace(/^gtd ui: /, "") || `exited ${code}`
      await update($, run, (r) => ({ ...r, url: undefined, uiNote }))
    } catch (x) {
      if (!isKilled) await update($, run, (r) => ({ ...r, url: undefined, uiNote: String(x) }))
    }
    ready()
  })()
  return isReady
}

// The engine's own question dialog, not a pane: it is the state herdr, the
// desktop app and Remote Control recognize as "waiting on you".
async function openGate($: $) {
  closeUi()
  const token = ++gateToken
  await update($, run, (r) => ({ ...r, url: undefined, uiNote: undefined }))
  const stop = (await read($, run)).stop
  if (stop?.kind === "done") return offerShip($, token)
  // A judge gate has no screen in gtd ui: it refuses to start there.
  if (!stop?.isJudge) await Promise.race([serveUi($, token), $.clock.sleep(8000)])
  const r = await read($, run)
  if (token !== gateToken || !r.stop) return
  try {
    const answer = await $.ui.ask(question(r), { header: "gtd", options: [PROCEED, "Not yet"] })
    if (answer === PROCEED && token === gateToken) await proceed($)
  } catch {
    // dismissed: the band above the prompt still offers Proceed
  }
}

const SHIP = "Ship it"

// A finished process on a feature branch is one answer away from its pull request.
async function offerShip($: $, token: number) {
  const branch = (
    await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: root })
  ).stdout.trim()
  const summary = await $.process.run(["gtd", "summary"], { cwd: root })
  if (summary.exitCode !== 0 || ["main", "master", "HEAD"].includes(branch)) return
  try {
    const answer = await $.ui.ask(
      `gtd finished the process on ${branch}. Ship it: squash it into one commit, push, and open or refresh the pull request?`,
      { header: "gtd", options: [SHIP, "Not yet"] },
    )
    if (answer === SHIP && token === gateToken) await shipNow($, false)
  } catch {
    // dismissed: /gtd ship does the same later
  }
}

// Ship's text turns need git to read the process, so they run as a subagent.
// Its answer is a file, not its hand-back: a hand-back never reaches a mod.
async function writer($: $, prompt: string) {
  // In a linked worktree `.git` is a file; the git dir is elsewhere.
  const gitDir = await $.process.run(["git", "rev-parse", "--absolute-git-dir"], { cwd: root })
  const file = `${gitDir.stdout.trim()}/gtd-ship-reply.md`
  await $.process.run(["rm", "-f", file])
  if (!personas.has("shipper")) {
    await $.agent.register({
      name: "shipper",
      description:
        "Writes commit messages and pull requests for gtd's ship, spawned by the gtd mod only",
      prompt:
        "You write commit messages and pull-request descriptions for gtd's ship command. Read the repository with git and the file tools as the instructions ask. Never modify the repository: no commits, no checkouts, no pushes.",
      tools: ["Bash", "Read", "Grep", "Glob", "Write", "Skill"],
      permissionMode: "bypassPermissions",
    })
    personas.add("shipper")
  }
  const spawned = await $.agent.spawn({
    subagentType: "gtd:shipper",
    prompt: `${prompt}\n\n--- DELIVERY ---\nWrite your final answer, exactly as you would print it, to ${file} with the Write tool. Only that file is read. Then stop.`,
    description: "gtd ship",
    model: (await $.env.get("GTD_PLANNERMODEL")) ?? "opus",
    cwd: root,
  })
  const id = spawned.agentId
  if (!id) return undefined
  ours.add(id)
  if (!(await turnEnd(id)).ok) return undefined
  try {
    return await $.fs.read(file)
  } catch {
    return undefined
  }
}

function shipIo($: $): ShipIo {
  return {
    run: async (argv, stdin) => {
      const r = await $.process.run(argv, { cwd: root, stdin, timeoutMs: TEN_MINUTES })
      return { code: r.exitCode, out: r.stdout, err: r.stderr }
    },
    complete: (prompt) => writer($, prompt),
    log: (line) => {
      for (const l of line.split("\n")) $.ui.log(l)
    },
    today: () => new Date().toISOString().slice(0, 10),
  }
}

async function shipNow($: $, isDry: boolean) {
  await dismiss($)
  $.ui.status(isDry ? "gtd: previewing ship…" : "gtd: shipping…")
  const shipped = await ship(shipIo($), isDry).catch((err: unknown) => ({
    ok: false,
    text: String(err),
  }))
  $.ui.status(undefined)
  for (const line of shipped.text.split("\n")) $.ui.log(line)
  $.ui.toast(shipped.ok ? "gtd: shipped" : "gtd: ship failed")
}

function question(r: Run) {
  const stop = r.stop as Stop
  const where = stop.label ?? stop.state ?? "a gate"
  if (stop.isJudge) {
    return `gtd stopped at a judge gate: ${where}. No TYPESAFE_API_KEY is set, so Proceed lands it unanswered and the workflow takes its cautious route. Proceed?`
  }
  const ui = r.url ? `Review it in gtd ui: ${r.url}` : "Edit the files it names in your editor."
  const again = r.isRepeat ? "Nothing changed, so gtd still waits here. " : ""
  return `${again}gtd waits on you: ${where}. ${ui} Proceed when you are done?`
}

// Turns a missing CLI or a wrong directory into an instruction, not a stack trace.
async function preflight($: $) {
  try {
    const v = (await $.process.run(["gtd", "--version"])).stdout.trim()
    const [major = 0, minor = 0] = v.split(".").map(Number)
    if (major < 15 || (major === 15 && minor < 6)) {
      return `gtd ${v} is too old for this mod, which needs 15.6 or later. Update it: npm install -g @pmelab/gtd`
    }
  } catch {
    return "The gtd CLI is not on your PATH. Install it: npm install -g @pmelab/gtd"
  }
  await findRoot($)
  if (root === ".")
    return "gtd runs inside a git repository. Start Claude Code in one, then run /gtd again."
  return undefined
}

async function proceed($: $) {
  gateToken++
  closeUi()
  await update($, run, (r) => ({ ...r, stop: undefined, url: undefined, uiNote: undefined }))
  await start($)
}

async function dismiss($: $) {
  gateToken++
  closeUi()
  await update($, run, (r) => ({ ...r, stop: undefined, url: undefined, uiNote: undefined }))
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    for (const id of await read($, agents)) ours.add(id)
    // A reload drops the loop mid-beat; gtd re-derives everything from git.
    if ((await read($, run)).isRunning) {
      await update($, run, (r) => ({
        ...r,
        isRunning: false,
        stop: { kind: "stopped" as const, text: "mod reloaded mid-run" },
      }))
    }
    await $.command.register({
      name: "gtd",
      description: "Drive gtd until it rests on you; pass requirements to start a new process",
      argumentHint: "[requirements | stop | status | ship [-n]]",
      immediate: true,
    })
    return next(e)
  })

  on("command.run", { command: "gtd" }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === "stop") {
      stopRequested = true
      return { text: "Stopping after the current beat." }
    }
    const problem = await preflight($)
    if (problem) return { text: problem }
    if (arg === "status") return { text: await gtd($, ["next"]) }
    if (arg === "ship" || arg === "ship -n" || arg === "ship --dry-run") {
      void shipNow($, arg !== "ship")
      return {}
    }
    if (arg) return { text: await begin($, arg) }
    const b = JSON.parse(await gtd($, ["next", "--json"])) as Beat
    if (b.state === "idle" && isTrue(b.idle)) {
      return {
        text: "Nothing is in progress. Start a process with /gtd <requirements>, or sketch the change in .gtd/TODO.md and run /gtd.",
      }
    }
    await start($)
    return {}
  })

  on("turn.complete", ($, e, next) => {
    if (e.agentId && ours.has(e.agentId)) {
      const end: TurnEnd =
        e.reason === "answer" ? { ok: true } : { ok: false, why: `agent turn ended: ${e.reason}` }
      const resolve = waiting.get(e.agentId)
      waiting.delete(e.agentId)
      if (resolve) resolve(end)
      else ended.set(e.agentId, end)
    }
    return next(e)
  })

  // The loop lands a turn when it ends; work left running in the background
  // would still be writing the tree gtd is committing.
  on("tool.call", ($, e, next) => {
    if (!e.agentId || !ours.has(e.agentId)) return next(e)
    if (e.tool === "Bash") {
      return next({ ...e, run_in_background: false, timeout: e.timeout ?? TEN_MINUTES })
    }
    if (e.tool === "Agent") return next({ ...e, run_in_background: false })
    return next(e)
  })

  // A subagent's hand-back arrives as a prompt to the main session, whose model
  // would then act on it. gtd reads the turn's result from git instead.
  on("prompt.submit", ($, e, next) => {
    if (!e.origin || e.origin.kind === "composer" || e.origin.kind === "bridge") return next(e)
    if ([...ours].some((id) => e.text.includes(`from="${id}"`))) {
      return { drop: "gtd subagent notice" }
    }
    return next(e)
  })

  on("agent.offer", ($, e, next) => (e.agent.startsWith("gtd:") ? { isOffered: false } : next(e)))

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const r = await read($, run)
    if (!r.isRunning && !r.stop) return next(e)
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const where = r.label ? `${r.state} (${r.label})` : (r.state ?? "")
    if (r.isRunning) {
      return (
        <Box gap={1}>
          <Text color="cyan">gtd ▸ {where || "starting"}</Text>
          <Text dimColor>beat {r.beat}</Text>
          <Button key="stop" label="Stop" onPress={() => void (stopRequested = true)} />
        </Box>
      )
    }
    const stop = r.stop as Stop
    const isBad = stop.kind === "error" || stop.kind === "stalled"
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={isBad ? "red" : stop.kind === "done" ? "green" : "yellow"} bold>
            gtd {headline(stop)}
          </Text>
          <Button key="go" label="Proceed" variant="primary" onPress={() => proceed($)} />
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => dismiss($)} />
        </Box>
        {r.url && <Link href={r.url} label={`gtd ui: ${r.url}`} />}
        {!r.url && r.uiNote && <Text dimColor>gtd ui: {r.uiNote}</Text>}
        {isBad && <Text dimColor>{stop.text.split("\n").slice(0, 8).join("\n")}</Text>}
      </Box>
    )
  })
}

const headline = (s: Stop) => {
  const where = s.label ? `${s.state} (${s.label})` : (s.state ?? "")
  switch (s.kind) {
    case "gate":
      return `● your turn — ${where}`
    case "done":
      return `✔ ${where || "settled"}`
    case "stopped":
      return `■ ${s.text}`
    default:
      return `✘ ${s.kind} — ${where}`
  }
}
