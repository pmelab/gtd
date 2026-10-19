import { atom, read, update } from "claude-code"
import type { EngineInterface, Register } from "claude-code"

import type { Run, Stop } from "../types"
import { accessDenial, mainDenial } from "./access"
import type { AccessDef } from "./access"
import { jobPrompt, wakePrompt, wakes } from "./assist"
import { afterReload, drive, isTrue } from "./drive"
import type { Io, Opening, Turn, TurnEnd } from "./drive"
import { doorFor, doors, enter } from "./doors"
import { subagentModel } from "./models"
import { pastedCommand } from "./paste"
import { personaSpec, resumable } from "./persona"
import { JUDGE_SYSTEM, judgePrompt, judgeQuestions, judgeRunEnv, toVerdicts } from "./judge"
import type { Judgment } from "./judge"
import { catchFrom, throwTo } from "./handoff"
import { jobs } from "./jobs"
import { documents, readDocument } from "./schema"
import { READ_ONLY_GIT, ship } from "./ship"
import type { Shipped, ShipIo } from "./ship"
import { collectAnswer } from "./delegate"
import { decideCommand, decideContinue, decideJob, restId, TOOLS } from "./tools"
import type { JobName } from "./tools"
import {
  beatLine,
  headline,
  jobHeadline,
  jobPushText,
  pushText,
  lostLine,
  restartLine,
  RELOAD_CUT_SCRIPT,
  runningLine,
  TONE,
} from "./wording"

type $ = EngineInterface

const run = atom({ plugin: "gtd", key: "run" } as const, { isRunning: false, beat: 0 } as Run)
// memory scope (`<scope>#<hash7>`) -> the subagent holding that conversation
const scopes = atom(
  { plugin: "gtd", key: "scopes" } as const,
  {} as Record<string, { agentId: string; persona: string }>,
)
const agents = atom({ plugin: "gtd", key: "agents" } as const, [] as string[])

const TEN_MINUTES = 600_000

// gtd refuses outside the repository root; every process runs there.
let root = "."
let gateUi: { stop(): void } | undefined
// bumped per rest, so a browser view of an older rest is ignored
let gateToken = 0
let lastGate: { state?: string; head: string } | undefined

let stopRequested = false
// when the current step began, for the band's elapsed time
let stepStartedAt = Date.now()
// Set before the first await of `start`, so two Continue presses arriving
// together cannot both pass the isRunning check and start two drivers.
let isDriving = false
// bumped by every stop, so a queued continue that was mid-check sees it
let stopCount = 0
// subagents answering into a file: what each may touch (see tool.call)
const delegates = new Map<string, { file: string; mayRun: RegExp | undefined }>()
const ours = new Set<string>()
// What each turn agent may read and write; reset on every spawn and resume,
// since the steering file can differ per step.
const accesses = new Map<string, AccessDef>()
const setAccess = (id: string, a: AccessDef | undefined) =>
  void (a ? accesses.set(id, a) : accesses.delete(id))
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

// One agent type per scope, system prompt and skill list. A registered type's
// prompt replaces the session's system prompt, as `--system-prompt` does for
// the sh driver.
async function persona($: $, t: Pick<Turn, "scope" | "system" | "skills">) {
  const spec = await personaSpec(t)
  if (!personas.has(spec.name)) {
    await $.agent.register({
      ...spec,
      description: "gtd workflow persona, spawned by the gtd driver only",
    })
    personas.add(spec.name)
  }
  return `gtd:${spec.name}`
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

// A subagent that no longer takes messages can leave its task listed with a
// frozen timer: stop it, and forget it as the scope's conversation.
async function forget($: $, memory: string, agentId: string) {
  $.ui.log(lostLine(memory.split("#")[0]!))
  accesses.delete(agentId)
  await update($, scopes, (s) => {
    const rest = { ...s }
    if (rest[memory]?.agentId === agentId) delete rest[memory]
    return rest
  })
  try {
    await $.tool.call({ tool: "TaskStop", task_id: agentId })
  } catch {
    // already gone from the task list
  }
}

async function settle($: $, end: TurnEnd) {
  await update($, run, (r) => ({ ...r, inflight: undefined }))
  return end
}

const docs = ($: $) => documents((args, stdin) => gtd($, args, stdin))

function io($: $): Io {
  return {
    next: docs($).next,
    plain: () => gtd($, ["next"]),
    land: docs($).land,
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
    judge: () =>
      docs($).judge(async (doc, j) => {
        const env = judgeRunEnv({
          provider: await $.env.get("GTD_JUDGE_PROVIDER"),
          key: (await $.env.get("TYPESAFE_API_KEY")) || (await $.env.get("TYPESAFE_AI_KEY")),
        })
        if (env === undefined) return judgeInSession($, j)
        try {
          const r = await $.process.run(["gtd", "judge", "run"], {
            cwd: root,
            stdin: doc,
            env,
            timeoutMs: TEN_MINUTES,
          })
          return r.exitCode === 0 && r.stdout.trim() ? r.stdout : undefined
        } catch {
          return undefined
        }
      }),
    turn: async (t) => {
      const entry = (await read($, scopes))[t.memory]
      const name = (await personaSpec(t)).name
      const known = resumable(entry, name)
      if (t.resume && entry && !known) $.ui.log(restartLine(t.scope))
      if (t.resume && known) {
        setAccess(known, t.access)
        const end = send($, known, t.prompt)
        await update($, run, (r) => ({ ...r, inflight: { agentId: known, memory: t.memory } }))
        const ended = await end
        if (ended) return settle($, ended)
        await forget($, t.memory, known)
      }
      // No live conversation for this scope (fresh scope, or this session never
      // held it): start one, as the sh driver falls back to `--session-id`.
      const spawned = await $.agent.spawn({
        subagentType: await persona($, t),
        prompt: t.prompt,
        description: t.label || "gtd",
        model: subagentModel(t.model, {
          smart: await $.env.get("GTD_PLANNERMODEL"),
          base: await $.env.get("GTD_CODERMODEL"),
        }),
        cwd: root,
      })
      const id = spawned.agentId
      if (!id) return settle($, { ok: false, why: spawned.deny ?? "subagent spawn refused" })
      ours.add(id)
      setAccess(id, t.access)
      await update($, agents, (list) => [...list, id].slice(-200))
      await update($, scopes, (s) => ({ ...s, [t.memory]: { agentId: id, persona: name } }))
      await update($, run, (r) => ({ ...r, inflight: { agentId: id, memory: t.memory } }))
      return settle($, await turnEnd(id))
    },
    resume: async (memory, text) => {
      const id = (await read($, scopes))[memory]?.agentId
      const end = id ? await send($, id, text) : undefined
      if (end) return end
      if (id) await forget($, memory, id)
      return { ok: false, isLost: true, why: `no live subagent for ${memory}` }
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

async function start($: $, opening: Opening = {}) {
  if (isDriving || background.busy()) return
  isDriving = true
  closeUi()
  moveOn($)
  stopRequested = false
  await findRoot($)
  // Requests not yet handed to a rest outlive a restart.
  await update($, run, (r) => ({ isRunning: true, beat: 0, notes: r.notes }))
  void drive(io($), opening)
    .catch((err: unknown): Stop => ({ kind: "error", text: String(err) }))
    .then(async (stop) => {
      isDriving = false
      const at = { state: stop.state, head: await head($) }
      const isRepeat =
        stop.kind === "gate" && at.state === lastGate?.state && at.head === lastGate?.head
      lastGate = at
      const rest = restId(at.head, stop.state)
      await update($, run, (r) => ({ ...r, isRunning: false, stop, rest, isRepeat }))
      $.ui.status(undefined)
      $.ui.toast(headline(stop))
      await push($, stop)
      await wake($)
    })
}

// A rest that needs the person hands the session's model a prompt to help them
// through it; the model moves gtd on only through the mod's tools.
async function wake($: $) {
  const r = await read($, run)
  const stop = r.stop
  if (!stop || !r.rest) return
  const branch = stop.kind === "done" ? await shippable($) : undefined
  if (!wakes(stop, branch)) return
  const questions = stop.isJudge ? await openQuestions($) : undefined
  const text = wakePrompt({
    stop,
    rest: r.rest,
    notes: r.notes,
    isRepeat: r.isRepeat,
    questions,
    branch,
  })
  await update($, run, (x) => ({ ...x, notes: undefined }))
  // Not from inside the hook that started the run: a prompt submitted there
  // would wait on that hook's own turn.
  $.clock.after(0, () => void $.prompt.submit({ text }))
}

async function openQuestions($: $) {
  try {
    const j = readDocument<Judgment>("judge --json", await gtd($, ["judge", "--json"]))
    return judgeQuestions(j).filter((q) => typeof q !== "string")
  } catch {
    return undefined
  }
}

// The branch a finished process can open its pull request from, if any.
async function shippable($: $) {
  const branch = (
    await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: root })
  ).stdout.trim()
  if (["main", "master", "HEAD"].includes(branch)) return undefined
  const summary = await $.process.run(["gtd", "summary"], { cwd: root })
  return summary.exitCode === 0 ? branch : undefined
}

// A new process starts from the requirements written to the steering file an
// idle rest names; the opening beat captures them like a hand-edit.
async function begin($: $, requirements: string) {
  await findRoot($)
  const b = await docs($).next()
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

// `gtd ui` on request only: the session's model is the main way through a rest.
async function browse($: $) {
  const r = await read($, run)
  if (r.isRunning || r.stop?.kind !== "gate") return "gtd is not waiting at a step right now."
  if (r.stop.isJudge) return "This step has no browser view."
  if (r.url) return `Open in your browser: ${r.url}`
  closeUi()
  const token = ++gateToken
  await update($, run, (x) => ({ ...x, url: undefined, uiNote: undefined }))
  await Promise.race([serveUi($, token), $.clock.sleep(8000)])
  const now = await read($, run)
  if (now.url) {
    if (now.stop) await push($, now.stop, now.url)
    return `Open in your browser: ${now.url}`
  }
  return `The browser view did not start${now.uiNote ? `: ${now.uiNote}` : "."}`
}

// A gate is news even when nobody watches the terminal: a push reaches the
// phone over Remote Control, and the engine drops it while the person is here.
const repoName = () => root.split("/").pop() ?? "gtd"

async function push($: $, stop: Stop, url?: string) {
  await notify($, pushText(stop, repoName(), url))
}

async function notify($: $, message: string) {
  try {
    await $.tool.call({ tool: "PushNotification", message, status: "proactive" })
  } catch {
    // no push channel: the dialog and the band still say it
  }
}

const background = jobs()

// A job asked from the model's tool call waits for that turn to end; one asked
// from the command starts right after, off the hook, so the command answers in
// budget. Either way the slot is claimed now, with the job's own effect.
function startJob(
  $: $,
  job: JobName,
  isInTurn: boolean,
  work: () => Promise<Shipped>,
  then?: (outcome: Shipped) => Promise<void>,
) {
  const answer = background.start(job, work, true, async (outcome) => {
    if (then) await then(outcome)
    $.ui.status(undefined)
    for (const line of outcome.text.split("\n")) $.ui.log(line)
    $.ui.toast(jobHeadline(job, outcome))
    await notify($, jobPushText(job, outcome, repoName()))
    const text = jobPrompt(job, outcome)
    $.clock.after(0, () => void $.prompt.submit({ text }))
  })
  if (!isInTurn) $.clock.after(0, () => background.flush())
  return answer
}

async function throwNow($: $, target: string | undefined, isInTurn: boolean) {
  const refused = decideJob(await read($, run), "handoff")
  if (refused) return refused
  return startJob(
    $,
    "handoff",
    isInTurn,
    async () => {
      closeUi()
      moveOn($)
      const b = await docs($).next()
      $.ui.status("handing off…")
      const rest = {
        state: b.state,
        label: b.label,
        content: b.content,
        isIdle: isTrue(b.idle),
      }
      return throwTo(shipIo($), rest, target, new Date().toISOString())
    },
    async (thrown) => {
      if (!thrown.ok) return
      await update($, run, (r) => ({
        ...r,
        url: undefined,
        uiNote: undefined,
        stop: { kind: "stopped" as const, text: thrown.text },
      }))
    },
  )
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
  const b = await docs($).next()
  if (b.kind === "message") {
    const stop: Stop = { kind: "gate", text: b.content ?? "", state: b.state, label: b.label }
    if (b.judge) stop.isJudge = true
    if (b.file) stop.file = b.file
    if (b.mode) stop.mode = b.mode
    const rest = restId(await head($), b.state)
    await update($, run, (r) => ({ ...r, stop, rest, isRepeat: false }))
    void wake($)
  } else {
    await start($)
  }
  return caught.text
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
  // A timed-out agent may still be running: it keeps its tool limits until its
  // turn ends, where turn.complete drops them.
  return collectAnswer({
    ended: turnEnd(id),
    deadline: $.clock.sleep(TEN_MINUTES),
    read: () => $.fs.read(file),
    remove: () => $.process.run(["rm", "-f", file]),
  })
}

async function writer($: $, prompt: string) {
  const model = (await $.env.get("GTD_PLANNERMODEL")) ?? "opus"
  return delegate($, SHIPPER, prompt, model, "Your final answer, exactly as you would print it.")
}

// Where `gtd judge run` would pick its llm, a judge gate is put to a small
// model as that provider does, but as a subagent of this session. Any doubt leaves the
// gate to the person, which routes the workflow its cautious way.
async function judgeInSession($: $, j: Judgment) {
  try {
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
      if (background.busy()) $.ui.status(line.split("\n")[0]!)
    },
    today: () => new Date().toISOString().slice(0, 10),
  }
}

async function shipNow($: $, isDry: boolean, isInTurn: boolean) {
  const refused = decideJob(await read($, run), "ship")
  if (refused) return refused
  return startJob(
    $,
    "ship",
    isInTurn,
    async () => {
      $.ui.status(isDry ? "previewing the pull request…" : "opening the pull request…")
      return ship(shipIo($), isDry, await $.env.get("GTD_SHIP_MODE"))
    },
    async (shipped) => {
      // a failed ship leaves the run as it was; a dry run changes nothing
      if (shipped.ok && !isDry) await dismiss($)
    },
  )
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

// The one way on from a rest, for the model's tool and the band's Continue
// alike; a string is why it did not move.
// `isInTurn`: asked from the model's own turn. Its subagents would then count
// as that turn's background work and keep it open, so the loop starts once the
// turn has ended; until then the continue waits in the run state.
async function proceed(
  $: $,
  rest?: string,
  verdicts?: unknown,
  isInTurn = false,
): Promise<string | undefined> {
  const r = await read($, run)
  const go = await decideContinue(r, rest, verdicts, {
    current: () => currentRest($, r.stop?.state),
    validate: () => validateRest($),
    busy: background.busy(),
    judgment: async () => {
      const doc = await gtd($, ["judge", "--json"]).catch(() => undefined)
      return doc === undefined ? undefined : readDocument<Judgment>("judge --json", doc)
    },
  })
  if (go.refuse !== undefined) return go.refuse
  const opening = r.stop?.isJudge ? { isAnswered: true, verdict: go.verdict } : {}
  if (isInTurn) {
    await update($, run, (x) => ({ ...x, pending: { rest: r.rest ?? "", ...opening } }))
    return undefined
  }
  await leaveRest($)
  await start($, opening)
  return undefined
}

// The rest's own `gtd validate` script, run.
async function validateRest($: $) {
  const script = await gtd($, ["validate"])
  if (script.trim().startsWith("nothing to validate")) return { ok: true, out: "" }
  const v = await $.process.run(["sh", "-c", script], { cwd: root, timeoutMs: TEN_MINUTES })
  return { ok: v.exitCode === 0, out: `${v.stdout}${v.stderr}`.trim() }
}

async function tellModel($: $, text: string, stops: number) {
  if (stops === stopCount) await $.prompt.submit({ text })
}

async function leaveRest($: $) {
  moveOn($)
  closeUi()
  await update($, run, (x) => ({
    ...x,
    stop: undefined,
    rest: undefined,
    pending: undefined,
    url: undefined,
    uiNote: undefined,
  }))
}

// The rest gtd is at now: HEAD and, when the stop named one, its state.
// Undefined when gtd cannot say, which checks nothing.
async function currentRest($: $, state: string | undefined) {
  try {
    const now = state === undefined ? undefined : (await docs($).next()).state
    return restId(await head($), now)
  } catch {
    return undefined
  }
}

// A continue the model asked for, once its turn is over: only if gtd still
// waits where the person answered, its file still validates (it can change
// outside this session, or across a reload), and no stop came in meanwhile.
async function launchPending($: $) {
  const stops = stopCount
  const r = await read($, run)
  const pending = r.pending
  if (!pending) return
  await update($, run, (x) => ({ ...x, pending: undefined }))
  const now = await currentRest($, r.stop?.state)
  if (now !== undefined && now !== pending.rest) {
    $.ui.toast("gtd moved on before it could continue: nothing was landed")
    return
  }
  if (r.stop?.kind === "gate" && !r.stop.isJudge) {
    const v = await validateRest($)
    if (!v.ok) {
      const text = `gtd did not continue: the step's file no longer validates.\n${v.out}\nFix it with the person, then call continue again with rest "${pending.rest}".`
      if (stops === stopCount) $.clock.after(0, () => void tellModel($, text, stops))
      return
    }
  }
  // Nothing awaited between this check and `start`'s own reset of the stop
  // flag, so a stop cannot slip in between; `start` also clears the rest.
  if (stops !== stopCount) return
  await start($, pending.isAnswered ? { isAnswered: true, verdict: pending.verdict } : {})
}

async function note($: $, text: string) {
  const r = await read($, run)
  if (!r.isRunning && !r.stop) return "No gtd process is underway here."
  await update($, run, (x) => ({ ...x, notes: [...(x.notes ?? []), text] }))
  return "Noted for the next step that waits on the person."
}

async function bandContinue($: $) {
  const refused = await proceed($)
  if (!refused) return
  $.ui.toast(refused.split("\n")[0]!)
  for (const line of refused.split("\n")) $.ui.log(line)
}

async function dismiss($: $) {
  moveOn($)
  closeUi()
  await update($, run, (r) => ({
    ...r,
    stop: undefined,
    rest: undefined,
    url: undefined,
    uiNote: undefined,
  }))
}

const DROPPED = "gtd subagent notice"

async function refreshBand($: $) {
  if ((await read($, run)).isRunning) $.ui.invalidate("ui.render")
}

// A continue still waiting for the model's turn to end is dropped too.
async function stopNow($: $) {
  stopRequested = true
  stopCount++
  if (!(await read($, run)).pending) return "Stopping after the current beat."
  await update($, run, (x) => ({ ...x, pending: undefined }))
  return "Cancelled the pending continue; gtd stays where it is."
}

// `/gtd [verb] …`; anything that is not a verb is a new process's requirements.
async function command($: $, arg: string): Promise<string | undefined> {
  if (arg === "stop") return stopNow($)
  const busy = decideCommand(arg, background.busy())
  if (busy) return busy
  const problem = await preflight($)
  if (problem) return problem
  const [verb = "", ...rest] = arg.split(/\s+/)
  switch (verb) {
    case "status":
      return gtd($, ["next"])
    case "throw":
      return throwNow($, rest[0], false)
    case "ui":
      return browse($)
    case "catch":
      return rest[0]
        ? catchNow($, rest[0])
        : "Name the pull request or branch: /gtd catch <number|branch>."
    case "ship":
      return shipNow($, rest[0] === "-n" || rest[0] === "--dry-run", false)
    case "":
      return resume($)
    default:
      return doorFor(await doors(shipIo($)), verb, rest) ? enterNow($, verb, rest) : begin($, arg)
  }
}

async function resume($: $) {
  const b = await docs($).next()
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
    const rest = restId(await head($), was.state)
    await update($, run, (r) => ({ ...r, stop, rest }))
    $.ui.status(undefined)
    $.ui.toast(headline(stop))
    await wake($)
    return
  }
  await start($, next === "land" ? { landTurn: inflight?.memory } : {})
}

// Whether an agent is one of gtd's workers or spawned (at any depth) by one;
// any other agent works for the session's model and shares its limits.
const lineage = new Map<string, boolean>()
async function isOurs($: $, id: string) {
  if (ours.has(id)) return true
  const known = lineage.get(id)
  if (known !== undefined) return known
  const byId = new Map((await $.agent.list()).map((a) => [a.id, a]))
  let parent = byId.get(id)?.parentId
  for (let hops = 0; parent && hops < 16; hops++) {
    if (ours.has(parent)) break
    parent = byId.get(parent)?.parentId
  }
  const isWorker = parent !== undefined && ours.has(parent)
  lineage.set(id, isWorker)
  return isWorker
}

// What a subagent this mod spawned may not do: write outside its step's
// access, or, answering into a file, anything but that.
function subagentDenial(agentId: string, e: Record<string, unknown>) {
  if (!ours.has(agentId)) return undefined
  const access = accesses.get(agentId)
  const denial = access && accessDenial(String(e.tool), e, access, root)
  if (denial) return denial
  const delegated = delegates.get(agentId)
  if (!delegated) return undefined
  if (e.tool === "Write" && e.file_path !== delegated.file) {
    return `Write only your answer, to ${delegated.file}.`
  }
  if (e.tool === "Bash" && !delegated.mayRun?.test(String(e.command).trim())) {
    return "Only read-only git commands, without shell syntax, are allowed here."
  }
  return undefined
}

// What the main session may write now (see mainDenial).
async function phase($: $) {
  const r = await read($, run)
  const stop = r.stop
  const atQa = stop?.kind === "gate" && !stop.isJudge
  // A continue waiting for the turn to end is as good as running: the file
  // it validated must not change before it lands.
  const isRunning = r.isRunning || r.pending !== undefined
  return { isRunning, mode: atQa ? stop.mode : undefined, file: stop?.file }
}

// A tool's answer. For `continue`, any text is a refusal the model reads as an
// error; the other tools report what happened either way.
function answer(text: string | undefined, isReport = false) {
  if (text === undefined) {
    return { result: "gtd continues as soon as this turn ends: end your turn now." }
  }
  return isReport ? { result: text } : { deny: text }
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    // The band's elapsed time ticks while a step runs.
    $.clock.every(10_000, () => void refreshBand($))
    for (const id of await read($, agents)) ours.add(id)
    // A reload drops the loop mid-beat; gtd keeps its state in git, so pick it
    // up again. A rest needs nothing: the model already holds its prompt.
    const was = await read($, run)
    if (was.isRunning) void resumeAfterReload($, was)
    else void findRoot($).then(() => launchPending($))
    for (const tool of TOOLS) await $.tool.register(tool)
    await $.command.register({
      name: "gtd",
      description: "Drive gtd until it rests on you; pass requirements to start a new process",
      argumentHint:
        "[requirements | <door> [args] | stop | status | ui | ship [-n] | throw [@user] | catch <pr|branch>]",
      immediate: true,
    })
    return next(e)
  })

  on("command.run", { command: "gtd" }, async ($, e) => {
    const text = await command($, e.args.trim())
    return text ? { text } : {}
  }).catch(($, e, next) => ({ text: next.error.message }))

  on("turn.complete", ($, e, next) => {
    if (!e.agentId) {
      background.flush()
      void launchPending($)
    }
    if (e.agentId && ours.has(e.agentId)) {
      const end: TurnEnd =
        e.reason === "answer" ? { ok: true } : { ok: false, why: `agent turn ended: ${e.reason}` }
      delegates.delete(e.agentId)
      const resolve = waiting.get(e.agentId)
      waiting.delete(e.agentId)
      if (resolve) resolve(end)
      else ended.set(e.agentId, end)
    }
    return next(e)
  })

  // The loop lands a turn when it ends; work left running in the background
  // would still be writing the tree gtd is committing.
  on("tool.call", async ($, e, next) => {
    const isWorker = e.agentId !== undefined && (await isOurs($, e.agentId))
    const denial = isWorker
      ? subagentDenial(e.agentId!, e)
      : mainDenial(String(e.tool), e, await phase($), root)
    if (denial) return { deny: denial }
    if (!e.agentId || !ours.has(e.agentId)) return next(e)
    if (e.tool === "Bash") {
      return next({ ...e, run_in_background: false, timeout: e.timeout ?? TEN_MINUTES })
    }
    if (e.tool === "Agent") return next({ ...e, run_in_background: false })
    return next(e)
  })

  // A subagent's hand-back arrives as a prompt to the main session, whose model
  // would then act on it. gtd reads the turn's result from git instead.
  on("prompt.submit", async ($, e, next) => {
    if (!e.origin || e.origin.kind === "composer" || e.origin.kind === "bridge") {
      const pasted = pastedCommand(e.text)
      if (!pasted) return next(e)
      // Off the hook: preflight may install gtd's runtime and outlast its budget.
      const say = (text: string) => {
        for (const line of text.split("\n")) $.ui.log(line)
        $.ui.toast(text.split("\n")[0]!)
      }
      if ("lost" in pasted) say(pasted.lost)
      else {
        $.clock.after(0, () => {
          void command($, pasted.arg)
            .then((text) => text && say(text))
            .catch((err) => say(err instanceof Error ? err.message : String(err)))
        })
      }
      return { drop: "gtd took the command" }
    }
    if ([...ours].some((id) => e.text.includes(`from="${id}"`))) {
      return { drop: DROPPED }
    }
    return next(e)
  })

  on("tool.call", { tool: "mcp__gtd__continue" }, async ($, e) =>
    answer(await proceed($, String(e.rest ?? ""), e.verdicts, true)),
  )
  on("tool.call", { tool: "mcp__gtd__note" }, async ($, e) =>
    answer(await note($, String(e.text ?? "")), true),
  )
  on("tool.call", { tool: "mcp__gtd__handoff" }, async ($, e) =>
    answer(await throwNow($, typeof e.to === "string" && e.to ? e.to : undefined, true), true),
  )
  on("tool.call", { tool: "mcp__gtd__ship" }, async ($, e) =>
    answer(await shipNow($, e.dryRun === true, true), true),
  )
  on("tool.call", { tool: "mcp__gtd__browser" }, async ($) => answer(await browse($), true))

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
          <Button key="go" label="Continue" variant="primary" onPress={() => bandContinue($)} />
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => dismiss($)} />
        </Box>
        {ui && <Text dimColor>{ui}</Text>}
        {detail && <Text dimColor>{detail}</Text>}
      </Box>
    )
  })
}
