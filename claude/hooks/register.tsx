import { atom, read, update } from "claude-code"
import type { EngineInterface, Register } from "claude-code"

import type { Run, Stop } from "../types"
import { afterReload, drive, isTrue } from "./drive"
import type { Beat, Io, Landing, TurnEnd } from "./drive"
import { doors, enter } from "./doors"
import { subagentModel } from "./models"
import { JUDGE_SYSTEM, judgePrompt, toVerdicts } from "./judge"
import type { Judgment } from "./judge"
import { catchFrom, throwTo } from "./handoff"
import { READ_ONLY_GIT, ship } from "./ship"
import type { ShipIo } from "./ship"
import {
  ANYONE,
  beatLine,
  CANCEL,
  CLOSE,
  CONTINUE,
  gateOptions,
  HANDOFF,
  handoffQuestion,
  headline,
  LATER,
  pushText,
  runningLine,
  question,
  RELOAD_CUT_SCRIPT,
  SAFE,
  SHIP,
  shipQuestion,
  STALE,
  TONE,
} from "./wording"

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
// the question dialog this mod has open, to mark it stale once gtd moves on
let openAsk: { token: number; text: string } | undefined

let stopRequested = false
// when the current step began, for the band's elapsed time
let stepStartedAt = Date.now()
// Set before the first await of `start`, so two Continue presses arriving
// together cannot both pass the isRunning check and start two drivers.
let isDriving = false
let isShipping = false
// subagents answering into a file: what each may touch (see tool.call)
const delegates = new Map<string, { file: string; mayRun: RegExp | undefined }>()
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
  // A turn that ended while nothing waited on it must not end this one.
  ended.delete(agentId)
  const end = turnEnd(agentId)
  const sent = await $.session.send({ to: { agentId }, text })
  if (sent.isDelivered) return end
  waiting.delete(agentId)
  return undefined
}

async function settle($: $, end: TurnEnd) {
  await update($, run, (r) => ({ ...r, inflight: undefined }))
  return end
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
      await update($, run, (r) => ({ ...r, isScripting: true }))
      const child = $.process.spawn({ argv, cwd: root })
      for await (const _ of child);
      const code = (await child.result).code ?? 1
      await update($, run, (r) => ({ ...r, isScripting: false }))
      return code
    },
    check: async (script) => {
      // Streamed for the same reason: a validator may outlast run's cap.
      const child = $.process.spawn({ argv: ["sh", "-c", script], cwd: root })
      let out = ""
      for await (const chunk of child) out += chunk.text
      return { ok: (await child.result).code === 0, out: out.trim() }
    },
    judge: async () => {
      const key = (await $.env.get("TYPESAFE_API_KEY")) ?? (await $.env.get("TYPESAFE_AI_KEY"))
      if (!key) return judgeInSession($)
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
        const end = send($, known, t.prompt)
        await update($, run, (r) => ({ ...r, inflight: { agentId: known, memory: t.memory } }))
        const ended = await end
        if (ended) return settle($, ended)
      }
      // No live conversation for this scope (fresh scope, or this session never
      // held it): start one, as the sh driver falls back to `--session-id`.
      const spawned = await $.agent.spawn({
        subagentType: t.system ? await persona($, t.system) : "general-purpose",
        prompt: t.prompt,
        description: t.label || "gtd",
        model: subagentModel(t.model, {
          smart: await $.env.get("GTD_PLANNERMODEL"),
          base: await $.env.get("GTD_CODERMODEL"),
        }),
        cwd: root,
      })
      const id = spawned.agentId
      if (!id) return { ok: false, why: spawned.deny ?? "subagent spawn refused" }
      ours.add(id)
      await update($, agents, (list) => [...list, id].slice(-200))
      await update($, scopes, (s) => ({ ...s, [t.memory]: id }))
      await update($, run, (r) => ({ ...r, inflight: { agentId: id, memory: t.memory } }))
      return settle($, await turnEnd(id))
    },
    resume: async (memory, text) => {
      const id = (await read($, scopes))[memory]
      const end = id ? await send($, id, text) : undefined
      return end ?? { ok: false, why: `no live subagent for ${memory}` }
    },
    progress: (beat, b) => {
      // The band is not drawn everywhere (Remote Control, the mobile app):
      // the status line and one transcript line per step say it too.
      stepStartedAt = Date.now()
      $.ui.status(beatLine(beat, b))
      $.ui.log(beatLine(beat, b))
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

async function start($: $, landTurn?: string) {
  if (isDriving) return
  isDriving = true
  closeUi()
  moveOn($)
  stopRequested = false
  await findRoot($)
  await update($, run, () => ({ isRunning: true, beat: 0 }))
  void drive(io($), landTurn)
    .catch((err: unknown): Stop => ({ kind: "error", text: String(err) }))
    .then(async (stop) => {
      isDriving = false
      const at = { state: stop.state, head: await head($) }
      const isRepeat =
        stop.kind === "gate" && at.state === lastGate?.state && at.head === lastGate?.head
      lastGate = at
      await update($, run, (r) => ({ ...r, isRunning: false, stop, isRepeat }))
      $.ui.status(undefined)
      $.ui.toast(headline(stop))
      if (stop.kind === "gate" || stop.kind === "done") await openGate($)
      else await push($, stop)
    })
}

// A new process starts from the requirements written to the steering file an
// idle rest names; the opening beat captures them like a hand-edit.
async function begin($: $, requirements: string) {
  await findRoot($)
  const b = JSON.parse(await gtd($, ["next", "--json"])) as Beat
  if (isTrue(b.initial) && !isTrue(b.idle)) {
    const paths = (b.changes ?? []).map((c) => c.path).join(", ")
    return `The working tree has uncommitted changes (${paths}); gtd would start from those. Commit, stash or revert them, or run /gtd to start from them.`
  }
  if (!isTrue(b.initial)) {
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

// `gtd ui` serves exactly one rest. Its exit never continues the process, not
// even a hand-back from the web page: only the mod's own question or the band's
// Continue does, so a person always decides in Claude Code itself.
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
      const uiNote =
        code === 0
          ? "the browser view closed"
          : err.trim().replace(/^gtd ui: /, "") || `exited ${code}`
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
  await push($, r.stop, r.url)
  // Also a transcript line: Remote Control and the phone show no dialog.
  if (r.url) $.ui.log(`Open in your browser: ${r.url}`)
  const answer = await ask($, token, question(r), gateOptions(r.stop))
  if (token !== gateToken) return
  if (answer === CONTINUE || answer === SAFE) await proceed($)
  if (answer === HANDOFF) await askThrow($)
}

// The engine's own dialog; undefined when dismissed. Remembered, so it can be
// marked out of date once gtd moves on without it (a mod cannot close it).
async function ask($: $, token: number, text: string, options: string[]) {
  openAsk = { token, text }
  try {
    return await $.ui.ask(text, { header: "gtd", options })
  } catch {
    return undefined
  } finally {
    if (openAsk?.text === text) openAsk = undefined
  }
}

// A gate is news even when nobody watches the terminal: a push reaches the
// phone over Remote Control, and the engine drops it while the person is here.
async function push($: $, stop: Stop, url?: string) {
  const repo = root.split("/").pop() ?? "gtd"
  try {
    await $.tool.call({
      tool: "PushNotification",
      message: pushText(stop, repo, url),
      status: "proactive",
    })
  } catch {
    // no push channel: the dialog and the band still say it
  }
}

async function askThrow($: $) {
  const answer = await ask($, gateToken, handoffQuestion, [ANYONE, CANCEL])
  if (answer && answer !== CANCEL) await throwNow($, answer === ANYONE ? undefined : answer.trim())
}

async function throwNow($: $, target: string | undefined) {
  if ((await read($, run)).isRunning) return $.ui.log("Stop the loop first: /gtd stop.")
  closeUi()
  moveOn($)
  const b = JSON.parse(await gtd($, ["next", "--json"])) as Beat
  $.ui.status("handing off…")
  const rest = {
    state: b.state,
    label: b.label,
    content: b.content,
    isIdle: isTrue(b.idle),
  }
  const thrown = await throwTo(shipIo($), rest, target, new Date().toISOString()).catch(
    (err: unknown) => ({ ok: false, text: String(err) }),
  )
  $.ui.status(undefined)
  for (const line of thrown.text.split("\n")) $.ui.log(line)
  if (thrown.ok) {
    await update($, run, (r) => ({
      ...r,
      url: undefined,
      uiNote: undefined,
      stop: { kind: "stopped" as const, text: thrown.text },
    }))
  } else if ((await read($, run)).stop?.kind === "gate") {
    // Nothing left: the person is still at the gate they tried to throw.
    void openGate($)
  }
}

async function enterNow($: $, door: string, args: string[]) {
  if ((await read($, run)).isRunning) return "Stop the loop first: /gtd stop."
  const entered = await enter(shipIo($), door, args)
  if (entered.ok) await start($)
  return entered.text
}

// Picks the process up where it was thrown: a rest that waits on a person is
// shown to the catcher first, never landed unseen.
async function catchNow($: $, ref: string) {
  if ((await read($, run)).isRunning) return "Stop the loop first: /gtd stop."
  const caught = await catchFrom(shipIo($), ref)
  if (!caught.ok) return caught.text
  await findRoot($)
  const b = JSON.parse(await gtd($, ["next", "--json"])) as Beat
  if (b.kind === "message") {
    const stop: Stop = { kind: "gate", text: b.content ?? "", state: b.state, label: b.label }
    if (b.judge) stop.isJudge = true
    await update($, run, (r) => ({ ...r, stop, isRepeat: false }))
    void openGate($)
  } else {
    await start($)
  }
  return caught.text
}

// A finished process on a feature branch is one answer away from its pull request.
async function offerShip($: $, token: number) {
  const branch = (
    await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: root })
  ).stdout.trim()
  const summary = await $.process.run(["gtd", "summary"], { cwd: root })
  if (summary.exitCode !== 0 || ["main", "master", "HEAD"].includes(branch)) return
  await push($, { kind: "done", text: "", label: `ready to open a pull request for ${branch}` })
  const answer = await ask($, token, shipQuestion(branch), [SHIP, LATER])
  if (answer === SHIP && token === gateToken) await shipNow($, false)
}

// Ship's text turns need git to read the process, so they run as a subagent.
// Its answer is a file, not its hand-back: a hand-back never reaches a mod.
// `mayRun`: the only shell commands the subagent may run; none when absent.
type Delegate = {
  name: string
  description: string
  system: string
  tools: string[]
  mayRun?: RegExp
}

const SHIPPER: Delegate = {
  name: "shipper",
  description:
    "Writes commit messages and pull requests for gtd's ship, spawned by the gtd mod only",
  system:
    "You write commit messages and pull-request descriptions for gtd's ship command. Read the repository with git and the file tools as the instructions ask. Never modify the repository: no commits, no checkouts, no pushes.",
  tools: ["Bash", "Read", "Grep", "Glob", "Write", "Skill"],
  // It reads commit messages anyone on the branch wrote: read-only git, and
  // no shell syntax to chain anything else onto it.
  mayRun: READ_ONLY_GIT,
}

// gtd's llm judge persona; writing its answer file is its one tool.
const JUDGE: Delegate = {
  name: "judge",
  description: "Answers gtd judge gates, spawned by the gtd mod only",
  system: `${JUDGE_SYSTEM}\nThe one tool you use is Write, to deliver that answer to the file the task names.`,
  tools: ["Write"],
}

// A one-off subagent whose answer is a file, not its hand-back: a hand-back
// never reaches a mod. The file lives in the git dir, which in a linked
// worktree is not `.git`.
async function delegate($: $, who: Delegate, prompt: string, model: string, delivery: string) {
  const gitDir = await $.process.run(["git", "rev-parse", "--absolute-git-dir"], { cwd: root })
  const file = `${gitDir.stdout.trim()}/gtd-${who.name}-${crypto.randomUUID()}`
  if (!personas.has(who.name)) {
    await $.agent.register({
      name: who.name,
      description: who.description,
      prompt: who.system,
      tools: who.tools,
      permissionMode: "bypassPermissions",
    })
    personas.add(who.name)
  }
  const spawned = await $.agent.spawn({
    subagentType: `gtd:${who.name}`,
    prompt: `${prompt}\n\n--- DELIVERY ---\n${delivery} Write it to ${file} with the Write tool. Only that file is read. Then stop.`,
    description: `gtd ${who.name}`,
    model,
    cwd: root,
  })
  const id = spawned.agentId
  if (!id) return undefined
  ours.add(id)
  delegates.set(id, { file, mayRun: who.mayRun })
  const ended = await turnEnd(id)
  delegates.delete(id)
  try {
    return ended.ok ? await $.fs.read(file) : undefined
  } catch {
    return undefined
  } finally {
    await $.process.run(["rm", "-f", file])
  }
}

async function writer($: $, prompt: string) {
  const model = (await $.env.get("GTD_PLANNERMODEL")) ?? "opus"
  return delegate($, SHIPPER, prompt, model, "Your final answer, exactly as you would print it.")
}

// Without a TypeSafe key a judge gate is put to a small model, as gtd's own
// llm provider does, but as a subagent of this session. Any doubt leaves the
// gate to the person, which routes the workflow its cautious way.
async function judgeInSession($: $) {
  try {
    const j = JSON.parse(await gtd($, ["judge", "--json"])) as Judgment
    const model = (await $.env.get("GTD_JUDGE_MODEL")) ?? "haiku"
    const reply = await delegate(
      $,
      JUDGE,
      judgePrompt(j),
      model,
      'A JSON object mapping every question id to {"answer": <your answer>, "p": <your confidence>}, and nothing else.',
    )
    const verdicts = reply ? toVerdicts(j, JSON.parse(reply)) : "no answer"
    return typeof verdicts === "string" ? undefined : JSON.stringify(verdicts)
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
  if (isShipping) return $.ui.log("A pull request is already being prepared.")
  isShipping = true
  await dismiss($)
  $.ui.status(isDry ? "previewing the pull request…" : "opening the pull request…")
  const shipped = await ship(shipIo($), isDry).catch((err: unknown) => ({
    ok: false,
    text: String(err),
  }))
  isShipping = false
  $.ui.status(undefined)
  for (const line of shipped.text.split("\n")) $.ui.log(line)
  $.ui.toast(shipped.ok ? "pull request ready" : "opening the pull request failed")
}

// Turns a missing CLI or a wrong directory into an instruction, not a stack trace.
// The plugin is gtd's own npm package, so it runs the gtd it ships and the mod
// and the CLI never disagree. A checkout without a build falls back to PATH.
// The plugin install fetches no dependencies, so they arrive here, once per
// version, beside the bundle that resolves them.
async function adoptOwnGtd($: $) {
  const dir = $.plugin.root
  if (!(await $.fs.exists(`${dir}/dist/gtd.bundle.mjs`))) return undefined
  if (!(await $.fs.exists(`${dir}/node_modules/effect`))) {
    $.ui.status("installing gtd's runtime, once per version…")
    try {
      const npm = await $.process.run(
        [
          "npm",
          "install",
          "--omit=dev",
          "--omit=peer",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
        ],
        { cwd: dir, timeoutMs: TEN_MINUTES },
      )
      if (npm.exitCode !== 0) return `Installing gtd's runtime failed:\n${npm.stderr.trim()}`
    } catch {
      return "gtd needs node and npm on your PATH."
    } finally {
      $.ui.status(undefined)
    }
  }
  const path = (await $.env.get("PATH")) ?? ""
  if (!path.startsWith(`${dir}/bin:`)) await $.env.set("PATH", `${dir}/bin:${path}`)
  return undefined
}

async function preflight($: $) {
  const setup = await adoptOwnGtd($)
  if (setup) return setup
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

// A new rest, or none: answers to the old one no longer count, and its dialog
// is redrawn as out of date.
function moveOn($: $) {
  gateToken++
  $.ui.invalidate("ui.render")
}

async function proceed($: $) {
  moveOn($)
  closeUi()
  await update($, run, (r) => ({ ...r, stop: undefined, url: undefined, uiNote: undefined }))
  await start($)
}

async function dismiss($: $) {
  moveOn($)
  closeUi()
  await update($, run, (r) => ({ ...r, stop: undefined, url: undefined, uiNote: undefined }))
}

const DROPPED = "gtd subagent notice"

async function refreshBand($: $) {
  if ((await read($, run)).isRunning) $.ui.invalidate("ui.render")
}

// `/gtd [verb] …`; anything that is not a verb is a new process's requirements.
async function command($: $, arg: string): Promise<string | undefined> {
  if (arg === "stop") {
    stopRequested = true
    return "Stopping after the current beat."
  }
  const problem = await preflight($)
  if (problem) return problem
  const [verb = "", ...rest] = arg.split(/\s+/)
  switch (verb) {
    case "status":
      return gtd($, ["next"])
    case "throw":
      void throwNow($, rest[0])
      return undefined
    case "catch":
      return rest[0]
        ? catchNow($, rest[0])
        : "Name the pull request or branch: /gtd catch <number|branch>."
    case "ship":
      void shipNow($, rest[0] === "-n" || rest[0] === "--dry-run")
      return undefined
    case "":
      return resume($)
    default:
      return (await doors(shipIo($))).some((d) => d.name === verb)
        ? enterNow($, verb, rest)
        : begin($, arg)
  }
}

async function resume($: $) {
  const b = JSON.parse(await gtd($, ["next", "--json"])) as Beat
  if (isTrue(b.idle)) {
    return `Nothing is in progress. Start a process with /gtd <requirements>, or sketch the change in ${b.file ?? ".gtd/TODO.md"} and run /gtd.`
  }
  await start($)
  return undefined
}

// A turn a reload cut off keeps running as a subagent; wait for it, then land
// it rather than start it again.
async function resumeAfterReload($: $, was: Run) {
  await findRoot($)
  const { inflight } = was
  const agent = inflight && (await $.agent.list()).find((a) => a.id === inflight.agentId)
  const next = afterReload({ isScripting: was.isScripting, agentStatus: agent?.status })
  if (next === "wait") {
    $.ui.status("picking up where gtd left off…")
    $.clock.after(5000, () => void resumeAfterReload($, was))
    return
  }
  await update($, run, (r) => ({ ...r, isRunning: false, inflight: undefined, isScripting: false }))
  if (next === "halt") {
    const stop: Stop = {
      kind: "stopped",
      text: RELOAD_CUT_SCRIPT,
      state: was.state,
      label: was.label,
    }
    await update($, run, (r) => ({ ...r, stop }))
    $.ui.status(undefined)
    $.ui.toast(headline(stop))
    return
  }
  await start($, next === "land" ? inflight?.memory : undefined)
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    // The band's elapsed time ticks while a step runs.
    $.clock.every(10_000, () => void refreshBand($))
    for (const id of await read($, agents)) ours.add(id)
    // A reload drops the loop mid-beat and closes an open dialog; gtd keeps
    // its state in git, so pick both up again.
    const was = await read($, run)
    if (was.isRunning) void resumeAfterReload($, was)
    else if (was.stop?.kind === "gate") void findRoot($).then(() => openGate($))
    await $.command.register({
      name: "gtd",
      description: "Drive gtd until it rests on you; pass requirements to start a new process",
      argumentHint:
        "[requirements | <door> [args] | stop | status | ship [-n] | throw [@user] | catch <pr|branch>]",
      immediate: true,
    })
    return next(e)
  })

  on("command.run", { command: "gtd" }, async ($, e) => {
    const text = await command($, e.args.trim())
    return text ? { text } : {}
  }).catch(($, e, next) => ({ text: next.error.message }))

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
    const delegated = delegates.get(e.agentId)
    if (delegated) {
      if (e.tool === "Write" && e.file_path !== delegated.file) {
        return { deny: `Write only your answer, to ${delegated.file}.` }
      }
      if (e.tool === "Bash" && !delegated.mayRun?.test(String(e.command).trim())) {
        return { deny: "Only read-only git commands, without shell syntax, are allowed here." }
      }
    }
    if (e.tool === "Bash") {
      return next({ ...e, run_in_background: false, timeout: e.timeout ?? TEN_MINUTES })
    }
    if (e.tool === "Agent") return next({ ...e, run_in_background: false })
    return next(e)
  })

  // A subagent's hand-back arrives as a prompt to the main session, whose model
  // would then act on it. gtd reads the turn's result from git instead.
  on("prompt.submit", async ($, e, next) => {
    if (!e.origin || e.origin.kind === "composer" || e.origin.kind === "bridge") return next(e)
    if ([...ours].some((id) => e.text.includes(`from="${id}"`))) {
      return { drop: DROPPED }
    }
    return next(e)
  })

  // A dialog gtd has moved past still waits for an answer; say it is stale.
  on("ui.render", { component: "AskUserQuestion" }, ($, e, next) => {
    const [first] = e.props.questions as { question?: string }[]
    if (!openAsk || openAsk.token === gateToken || first?.question !== openAsk.text) return next(e)
    return next({
      ...e,
      props: {
        ...e.props,
        questions: [
          {
            ...first,
            question: STALE,
            header: "gtd",
            multiSelect: false,
            options: [
              { label: CLOSE, description: "Nothing happens." },
              { label: LATER, description: "Nothing happens." },
            ],
          },
        ],
      },
    })
  })

  on("agent.offer", ($, e, next) => (e.agent.startsWith("gtd:") ? { isOffered: false } : next(e)))

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const r = await read($, run)
    if (!r.isRunning && !r.stop) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (r.isRunning) {
      // Shaped like Claude's own spinner line, the one herdr reads as working
      // (its `live_turn_working` rule): an idle prompt would say idle.
      return (
        <Box gap={1}>
          <Text color="cyan">
            {runningLine(r.label ?? r.state ?? "starting", r.beat, Date.now() - stepStartedAt)}
          </Text>
          <Button key="stop" label="Stop" onPress={() => void (stopRequested = true)} />
        </Box>
      )
    }
    const stop = r.stop as Stop
    const ui = r.url ? `Open in your browser: ${r.url}` : r.uiNote && `No browser view: ${r.uiNote}`
    const detail = TONE[stop.kind] === "red" ? stop.text.split("\n").slice(0, 8).join("\n") : ""
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={TONE[stop.kind]} bold>
            gtd {headline(stop)}
          </Text>
          <Button key="go" label="Continue" variant="primary" onPress={() => proceed($)} />
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => dismiss($)} />
        </Box>
        {ui && <Text dimColor>{ui}</Text>}
        {detail && <Text dimColor>{detail}</Text>}
      </Box>
    )
  })
}
