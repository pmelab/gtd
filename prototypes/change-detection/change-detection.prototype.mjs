// PROTOTYPE — throwaway, never merged. Answers pmelab/gtd#592:
// how does a workspace server learn that a worktree's gtd state may have changed?
//
// Run: node prototypes/change-detection/change-detection.prototype.mjs   (N=40 for more worktrees)
//
// Three detectors run side by side over temp projects with linked worktrees. Each one only
// produces a *signal* ("something in project P may have changed"); every signal leads to the
// same recheck: one `git worktree list --porcelain` per project, diffed against the detector's
// last snapshot. So the detectors differ only in signal coverage, latency, noise and recovery.
//
//   hook  — a reference-transaction hook appends to an event log; the server tails the log.
//   watch — fs.watch on the common git dir: refs/ (recursive), the dir itself (HEAD,
//           packed-refs, reftable, worktrees/) and each worktrees/<n>/ (per-worktree HEAD).
//   poll  — no signal at all: recheck every project every POLL_MS.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const pexec = promisify(execFile)
const N = Number(process.env.N ?? 20) // worktrees in total, split over two projects
const DEBOUNCE = 50
const POLL_MS = 1000
const SETTLE = Math.max(POLL_MS + 400, 800)

const root = fs.mkdtempSync(path.join(os.tmpdir(), "PROTOTYPE-change-detection-"))
const LOG = path.join(root, "events.log")
fs.writeFileSync(LOG, "")
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "p",
  GIT_AUTHOR_EMAIL: "p@example.com",
  GIT_COMMITTER_NAME: "p",
  GIT_COMMITTER_EMAIL: "p@example.com",
}
const git = async (cwd, ...a) => (await pexec("git", a, { cwd, env, maxBuffer: 1e8 })).stdout.trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => performance.now()

// ---------- setup ----------

async function mkProject(name, { trackedHooksPath = false } = {}) {
  const dir = path.join(root, name)
  const main = path.join(dir, "main")
  fs.mkdirSync(main, { recursive: true })
  await git(main, "init", "-q", "-b", "main")
  fs.writeFileSync(path.join(main, "f"), "0\n")
  await git(main, "add", "f")
  await git(main, "commit", "-qm", "init")
  await git(dir, "clone", "-q", "--bare", main, "origin.git")
  await git(main, "remote", "add", "origin", path.join(dir, "origin.git"))
  await git(main, "fetch", "-q", "origin")
  let hook = true
  if (trackedHooksPath) {
    // husky-style: core.hooksPath points at a TRACKED dir. bench refuses to write a hook there
    // (it would show up as a change in the user's repo), so this project gets no hook.
    fs.mkdirSync(path.join(main, ".husky"))
    fs.writeFileSync(path.join(main, ".husky", "pre-commit"), "#!/bin/sh\n", { mode: 0o755 })
    await git(main, "add", ".husky")
    await git(main, "commit", "-qm", "husky")
    await git(main, "config", "core.hooksPath", ".husky")
    hook = false
  } else {
    fs.writeFileSync(
      path.join(main, ".git", "hooks", "reference-transaction"),
      `#!/bin/sh\n[ "$1" = committed ] || exit 0\nprintf '%s\\n' '${name}' >> '${LOG}'\n`,
      { mode: 0o755 },
    )
  }
  const wts = []
  for (let i = 0; i < N / 2; i++) {
    const w = path.join(dir, "wt", `w${i}`)
    await git(main, "worktree", "add", "-q", "-b", `feat/w${i}`, w)
    wts.push(w)
  }
  return { name, dir, main, common: path.join(main, ".git"), wts, hook }
}

async function snapshot(p) {
  const out = await git(p.main, "worktree", "list", "--porcelain")
  const m = {}
  let cur
  for (const l of out.split("\n")) {
    if (l.startsWith("worktree ")) m[(cur = l.slice(9))] = ""
    else if (l.startsWith("HEAD ")) m[cur] += l.slice(5)
    else if (l.startsWith("branch ")) m[cur] += " " + l.slice(7)
    else if (l === "detached") m[cur] += " detached"
  }
  return m
}

// ---------- detectors ----------

class Detector {
  constructor(name, projects) {
    Object.assign(this, { name, projects, snap: {}, hits: [], signals: 0, timers: {}, recheckMs: [] })
  }
  async recheck(p) {
    const t = now()
    const s = await snapshot(p)
    this.recheckMs.push(now() - t)
    const at = now()
    for (const [w, v] of Object.entries(s))
      if (this.snap[w] !== v) {
        if (w in this.snap || this.started) this.hits.push({ w, t: at })
        this.snap[w] = v
      }
    for (const w of Object.keys(this.snap))
      if (w.startsWith(p.dir + path.sep) && !(w in s)) {
        delete this.snap[w]
        this.hits.push({ w, t: at })
      }
  }
  // One recheck per project at a time: an older recheck finishing after a newer one would
  // write a stale snapshot back, and no later signal would correct it.
  serial(p) {
    if (this.running?.[p.name]) return void ((this.pending ??= {})[p.name] = true)
    ;(this.running ??= {})[p.name] = true
    this.recheck(p).finally(() => {
      this.running[p.name] = false
      if (this.pending?.[p.name]) {
        this.pending[p.name] = false
        this.serial(p)
      }
    })
  }
  signal(p) {
    this.lastSignal = now()
    this.signals++
    clearTimeout(this.timers[p.name])
    this.timers[p.name] = setTimeout(() => this.serial(p), DEBOUNCE)
  }
  async start({ scan = true } = {}) {
    this.arm()
    if (scan) for (const p of this.projects) await this.recheck(p)
    this.started = true
  }
  stop() {
    this.disarm()
    for (const t of Object.values(this.timers)) clearTimeout(t)
    this.started = false
  }
}

class HookDetector extends Detector {
  offset = 0
  arm() {
    const read = () => {
      const buf = fs.readFileSync(LOG)
      const chunk = buf.subarray(this.offset).toString()
      const end = chunk.lastIndexOf("\n") + 1
      this.offset += Buffer.byteLength(chunk.slice(0, end))
      for (const name of chunk.slice(0, end).split("\n").filter(Boolean)) {
        const p = this.projects.find((q) => q.name === name)
        if (p) this.signal(p)
      }
    }
    this.w = fs.watch(LOG, read)
    read() // replay what was appended while stopped (the saved offset)
  }
  disarm() {
    this.w.close()
  }
}

class WatchDetector extends Detector {
  watchers = []
  arm() {
    for (const p of this.projects) this.armProject(p)
  }
  armProject(p) {
    const add = (dir, opts, fn) => {
      try {
        const w = fs.watch(dir, opts, fn)
        w.on("error", () => {})
        this.watchers.push(w)
        ;(p.wt ??= []).push(w)
      } catch {}
    }
    add(p.common, {}, (_e, f) => {
      if (f === "HEAD" || f === "packed-refs" || f?.startsWith("reftable")) this.signal(p)
    })
    // Node's {recursive: true} on Linux is a JS emulation that dropped the tail of a burst
    // (RECURSIVE=1 brings it back for comparison). Plain inotify watchers per directory,
    // re-walked when a directory appears, did not.
    if (process.env.RECURSIVE)
      add(path.join(p.common, "refs"), { recursive: true }, (_e, f) => {
        if (!f?.startsWith("remotes")) this.signal(p)
      })
    else {
      const seen = new Set()
      const walk = (dir) => {
        if (seen.has(dir) || path.basename(dir) === "remotes") return
        seen.add(dir)
        add(dir, {}, () => {
          walk(dir)
          this.signal(p)
        })
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(dir, e.name))
      }
      walk(path.join(p.common, "refs"))
    }
    const wtDir = path.join(p.common, "worktrees")
    const armWorktrees = () => {
      for (const w of p.perWt ?? []) w.close()
      p.perWt = []
      for (const n of fs.existsSync(wtDir) ? fs.readdirSync(wtDir) : []) {
        try {
          const w = fs.watch(path.join(wtDir, n), {}, (_e, f) => {
            if (f === "HEAD" || f?.startsWith("refs")) this.signal(p)
          })
          w.on("error", () => {})
          p.perWt.push(w)
        } catch {}
      }
    }
    armWorktrees()
    if (fs.existsSync(wtDir))
      add(wtDir, {}, () => {
        armWorktrees()
        this.signal(p)
      })
  }
  disarm() {
    for (const w of this.watchers) w.close()
    for (const p of this.projects) for (const w of p.perWt ?? []) w.close()
    this.watchers = []
  }
  watchCount() {
    return this.watchers.length + this.projects.reduce((n, p) => n + (p.perWt?.length ?? 0), 0)
  }
}

class PollDetector extends Detector {
  arm() {
    this.iv = setInterval(() => {
      for (const p of this.projects) this.serial(p)
    }, POLL_MS)
  }
  disarm() {
    clearInterval(this.iv)
  }
}

// ---------- scenarios ----------

const A = await mkProject("alpha")
const B = await mkProject("beta", { trackedHooksPath: true })
const projects = [A, B]
const detectors = [new HookDetector("hook", projects), new WatchDetector("watch", projects), new PollDetector("poll", projects)]
for (const d of detectors) await d.start()

let n = 0
const commit = async (w, msg = "c") => {
  fs.writeFileSync(path.join(w, "f"), `${++n}\n`)
  await git(w, "commit", "-qam", msg)
}
const truth = async () => Object.assign({}, ...(await Promise.all(projects.map(snapshot))))

const rows = []
async function scenario(label, op, { restart = false, note = "" } = {}) {
  const before = await truth()
  const sig0 = detectors.map((d) => d.signals)
  const t0 = now()
  if (restart) for (const d of detectors) d.stop()
  await op()
  const tEnd = now()
  if (restart) {
    // hook: replays its log from the saved offset, no rescan. watch/poll: nothing to replay,
    // so they get the startup rescan any restart needs anyway.
    await detectors[0].start({ scan: false })
    await detectors[1].start()
    await detectors[2].start()
  }
  await sleep(SETTLE)
  const after = await truth()
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((w) => before[w] !== after[w])
  const cells = detectors.map((d, i) => {
    const got = changed.filter((w) => d.snap[w] === after[w] && d.hits.some((h) => h.w === w && h.t >= t0))
    const lat = changed
      .map((w) => d.hits.find((h) => h.w === w && h.t >= t0))
      .filter(Boolean)
      .map((h) => Math.max(0, h.t - tEnd))
    const missed = changed.length - got.length
    return {
      ok: missed === 0,
      text: `${missed ? `**missed ${missed}**` : "ok"}${lat.length ? ` · ${Math.round(Math.max(...lat))} ms` : ""} · ${d.signals - sig0[i]} sig`,
    }
  })
  if (process.env.DEBUG && changed.some((w) => detectors[1].snap[w] !== after[w]))
    console.error("DEBUG watch", { tEnd: Math.round(tEnd), lastSignal: Math.round(detectors[1].lastSignal), stale: changed.filter((w) => detectors[1].snap[w] !== after[w]).map((w) => [path.relative(root, w), detectors[1].snap[w]?.slice(0, 8), after[w].slice(0, 8)]) })
  rows.push([label, changed.length, ...cells.map((c) => c.text), note])
  console.error(`${label}: ${cells.map((c, i) => `${detectors[i].name}=${c.text}`).join("  ")}`)
}

const [w0, w1, w2, w3, w4, w5, w6, w7, w8] = A.wts

await scenario("commit in a worktree", () => commit(w0))
await scenario("gtd-style landing: commit-tree + update-ref", async () => {
  fs.writeFileSync(path.join(w1, "g"), "x\n")
  await git(w1, "add", "g")
  const tree = await git(w1, "write-tree")
  const c = await git(w1, "commit-tree", tree, "-p", "HEAD", "-m", "landing")
  await git(w1, "update-ref", "refs/heads/feat/w1", c)
})
await scenario("switch to a new branch", () => git(w2, "switch", "-q", "-c", "other"))
await scenario("new nested branch dir (a/b/c)", () => git(w6, "switch", "-q", "-c", "a/b/c/d"))
await scenario("reset --hard HEAD~1", () => git(w0, "reset", "-q", "--hard", "HEAD~1"))
await scenario("detach, then commit", async () => {
  await git(w4, "checkout", "-q", "--detach")
  await commit(w4)
})
await scenario("branch moved from ANOTHER worktree (update-ref in main)", async () => {
  const c = await git(A.main, "commit-tree", (await git(A.main, "rev-parse", "HEAD^{tree}")), "-p", "HEAD", "-m", "x")
  await git(A.main, "update-ref", "refs/heads/feat/w5", c)
}, { note: "bench's hook names the worktree that RAN git (main), not w5: rows stay stale unless the server rechecks the whole project" })
await scenario("pack-refs --all (no state change)", () => git(A.main, "pack-refs", "--all"))
await scenario("commit after refs are packed", () => commit(w3))
await scenario("fetch updates remote refs only", async () => {
  const tmp = path.join(root, "pusher")
  await git(root, "clone", "-q", path.join(A.dir, "origin.git"), tmp)
  await commit(tmp)
  await git(tmp, "push", "-q", "origin", "main")
  await git(A.main, "fetch", "-q", "origin")
})
await scenario("gc (objects + refs)", () => git(A.main, "gc", "-q"))
await scenario("worktree add", () => git(A.main, "worktree", "add", "-q", "-b", "feat/new", path.join(A.dir, "wt", "new")))
await scenario("worktree remove", () => git(A.main, "worktree", "remove", path.join(A.dir, "wt", "new")))
await scenario("commit with -c core.hooksPath=/dev/null", async () => {
  fs.writeFileSync(path.join(w7, "f"), `${++n}\n`)
  await git(w7, "-c", "core.hooksPath=/dev/null", "commit", "-qam", "nohook")
})
await scenario("commit in a project with a tracked core.hooksPath (husky)", () => commit(B.wts[0]))
await scenario("edit a file, no commit (dirty tree)", async () => {
  fs.writeFileSync(path.join(w8, "f"), "dirty\n")
}, { note: "invisible to all three: no ref moves. gtd next turns a message rest into a capture on a dirty tree" })
await scenario("server down: 2 commits, then restart", async () => {
  await commit(w7)
  await commit(w8)
}, { restart: true, note: "hook replays its log from the saved offset; watch/poll need the startup rescan" })
await scenario(`burst: 5 commits in each of ${A.wts.length + B.wts.length} worktrees, all at once`, () =>
  Promise.all([...A.wts, ...B.wts].map(async (w) => {
    await git(w, "reset", "-q", "--hard")
    for (let i = 0; i < 5; i++) await commit(w)
  })),
)

const watchCount = detectors[1].watchCount()
for (const d of detectors) d.stop()
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
const out = [
  `# Change detection prototype — results`,
  ``,
  `${new Date().toISOString()} · ${os.platform()} ${os.release()} · node ${process.version} · ${(await git(root, "--version"))} · ${N} worktrees in 2 projects · debounce ${DEBOUNCE} ms · poll every ${POLL_MS} ms`,
  ``,
  `Each cell: missed worktrees (vs. \`git worktree list\` truth) · worst latency after the op returned · signals raised.`,
  ``,
  `| scenario | changed | hook | watch | poll | note |`,
  `| --- | --- | --- | --- | --- | --- |`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
  ``,
  `- recheck cost (\`git worktree list --porcelain\`, one project of ${N / 2} worktrees): avg ${avg(detectors[2].recheckMs)} ms over ${detectors[2].recheckMs.length} runs`,
  `- poll cost: ${projects.length} rechecks per ${POLL_MS} ms, whether or not anything changed`,
  `- watch: ${watchCount} fs.watch handles at the end (per project: the git dir, worktrees/, each refs/ directory; plus 1 per worktree)`,
]
console.log(out.join("\n"))
fs.rmSync(root, { recursive: true, force: true })
process.exit(0)
