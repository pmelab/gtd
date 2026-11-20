import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { workspaceRouter, type Retrospective } from "./Router.js"

const git = (cwd: string, args: readonly string[], env: Record<string, string> = {}): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

let clock = Date.parse("2026-01-01T10:00:00Z")
const commit = (
  dir: string,
  subject: string,
  trailers: readonly string[] = [],
  files: Record<string, string> = {},
): string => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  git(dir, ["add", "-A"])
  clock += 90_000
  const date = new Date(clock).toISOString()
  git(dir, ["commit", "-q", "--allow-empty", "-m", `${subject}\n\n${trailers.join("\n")}`], {
    GIT_COMMITTER_DATE: date,
    GIT_AUTHOR_DATE: date,
  })
  return git(dir, ["rev-parse", "HEAD"]).trim()
}

const fixture = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-retro-"))
  git(dir, ["init", "-q", "-b", "feat"])
  git(dir, ["config", "user.email", "a@b.c"])
  git(dir, ["config", "user.name", "n"])
  // A finished process, kept under refs/gtd/history.
  const entry = commit(dir, "gtd(human): flow.a → flow.b", [], {
    "TODO.md": "Old job\n",
  })
  const tip = commit(dir, "gtd(check): flow.b → done", ["Gtd-Branch: feat", "Gtd-Exit: 0"])
  git(dir, ["update-ref", `refs/gtd/history/${entry}`, tip])
  // The live process.
  commit(dir, "gtd(human): design.a → design.b", [], {
    "TODO.md": "Build it\n",
  })
  commit(dir, "gtd(agent): design.b → design.c", ["Gtd-Cost: 0.5 opus"])
  clock += 600_000
  commit(dir, "gtd(check): design.c → design.d", ["Gtd-Exit: 2"])
  commit(dir, "gtd(check): design.d → design.e")
  commit(dir, "gtd(judge): design.e → design.b", ['Gtd-Judge: {"id":"q1","answer":"no","p":0.9}'])
  commit(
    dir,
    "gtd(human): design.b → impl.a",
    ['Gtd-Approved: {"step":"design.b#1","name":"Ada","email":"a@b.c"}'],
    {
      ".gtd/plan.md": "# 🔘 Pick\n\n- [ ] one\n- [x] two\n\n- [x] ✏️ mine\n\n[^1]: a note\n",
    },
  )
  return dir
}

const ask = async (dir: string, branch = "feat"): Promise<Retrospective> => {
  const ctx = {
    projects: () => [
      {
        id: "p",
        name: "p",
        worktrees: [{ path: dir, branch, head: "h", main: false, gate: "/g" }],
      },
    ],
    git: async (cwd: string, args: readonly string[]) => git(cwd, args),
  }
  const caller = workspaceRouter.createCaller(ctx as never)
  return caller.retrospective({ project: "p", worktree: dir, head: "" })
}

describe("retrospective", () => {
  it("lists the newest process first with its steps oldest first, and keeps the finished one", async () => {
    const { processes } = await ask(fixture())
    expect(processes.map((p) => p.steps.map((s) => s.to))).toEqual([
      ["design.b", "design.c", "design.d", "design.e", "design.b", "impl.a"],
      ["flow.b", "done"],
    ])
    expect(processes[1]!.finished).toBe(true)
    expect(processes[0]!.steps[0]!.todo).toBe("Build it")
    expect(processes[0]!.steps.map((s) => s.gap)).toEqual([undefined, 90, 690, 90, 90, 90])
  })

  it("reads costs, exit codes, verdicts and human input from git", async () => {
    const { processes, total, byModel } = await ask(fixture())
    const steps = processes[0]!.steps
    expect(steps[1]!.costs).toEqual([{ cost: 0.5, model: "opus" }])
    expect(steps.map((s) => s.exit)).toEqual([
      undefined,
      undefined,
      2,
      undefined,
      undefined,
      undefined,
    ])
    expect(steps[4]!.verdicts).toEqual([{ id: "q1", answer: "no", p: 0.9, sentBack: true }])
    expect(steps[5]!.approvedBy).toBe("Ada")
    expect(steps[5]!.ticked).toEqual(["two"])
    expect(steps[5]!.written).toEqual(["mine"])
    expect(steps[5]!.notes).toEqual(["a note"])
    expect(total).toBe(0.5)
    expect(byModel).toEqual({ opus: 0.5 })
  })

  it("links a finished process to the worktree running on gtd/<branch>", async () => {
    const { processes } = await ask(fixture(), "gtd/feat")
    expect(processes.map((p) => p.finished)).toEqual([false, true])
  })

  it("keeps a stopped process that has no landing, by ancestry", async () => {
    const dir = fixture()
    const entry = commit(dir, "gtd(human): stop.a → stop.b", [], { "TODO.md": "Stopped\n" })
    git(dir, ["update-ref", `refs/gtd/history/${entry}`, entry])
    const { processes } = await ask(dir, "gtd/feat")
    expect(processes.map((p) => p.entry)).toContain(entry)
  })

  it("marks a process closed by an unpin as finished", async () => {
    const dir = fixture()
    const entry = commit(dir, "gtd(human): pinned.a → pinned.b", [], { "TODO.md": "Pinned\n" })
    commit(dir, "gtd(check): pinned.b → done")
    const tip = commit(dir, "gtd(check): gtd:unpin → idle", [
      "Gtd-Pin: remove",
      "Gtd-Branch: feat",
      "Gtd-Format: 5",
    ])
    git(dir, ["update-ref", `refs/gtd/history/${entry}`, tip])
    const { processes } = await ask(dir, "gtd/feat")
    expect(processes.find((p) => p.entry === entry)?.finished).toBe(true)
  })

  it("refuses an unknown worktree", async () => {
    const ctx = { projects: () => [], git: async () => "" }
    await expect(
      workspaceRouter
        .createCaller(ctx as never)
        .retrospective({ project: "p", worktree: "/nowhere", head: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
