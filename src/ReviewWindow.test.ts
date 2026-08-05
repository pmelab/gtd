import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { computeProcessRun } from "./Edge.js"
import {
  closeReviewWindow,
  LEGACY_REVIEW_BASE_REF,
  LEGACY_REVIEW_HEAD_REF,
  openReviewWindow,
  reviewBaseHash,
  REVIEW_BASE_REF,
  REVIEW_HEAD_REF,
} from "./ReviewWindow.js"
import type { WorkflowDefinition } from "./PatternMachine.js"

/**
 * Live-git coverage for the review checkout window: the mixed-reset open/close
 * round trip and the `reviewBase` base-narrowing, exercised against a REAL git
 * repository (the @inmem `review-window.feature` covers the same lifecycle
 * through the program edge; this file proves the actual git plumbing).
 */

// A workflow: idle → building → gate (a reviewWindow rest), with an optional
// `checkpoint` reviewBase state between two building turns.
const def: WorkflowDefinition = {
  states: {
    idle: { actor: "human", message: "i", on: [["* **", "building"]] },
    building: { actor: "agent", prompt: "b", on: [["* **", "gate"]] },
    checkpoint: { actor: "human", message: "c", reviewBase: true, on: [["* **", "gate"]] },
    gate: { actor: "human", message: "g", reviewWindow: true, on: [["* **", "idle"]] },
  },
  entries: { default: "idle" },
}

let repoDir: string

const gitIn = (dir: string, ...args: string[]): string =>
  execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim()

const gitExec = (...args: string[]): string => gitIn(repoDir, ...args)

const commit = (message: string, files: Record<string, string> = {}): void => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repoDir, dirname(path)), { recursive: true })
    writeFileSync(join(repoDir, path), content)
  }
  gitExec("add", "-A")
  // `-m` via execSync needs the message quoted; keep messages free of quotes.
  gitExec("commit", "--allow-empty", "-m", `"${message}"`)
}

const headSubject = (): string => gitExec("log", "-1", "--format=%s")
const status = (): string => gitExec("status", "--porcelain", "-uall")
const refExistsIn = (dir: string, ref: string): boolean => {
  try {
    gitIn(dir, "rev-parse", "--verify", "--quiet", ref)
    return true
  } catch {
    return false
  }
}
const refExists = (ref: string): boolean => refExistsIn(repoDir, ref)

const runIn = <A>(
  dir: string,
  eff: Effect.Effect<A, Error, GitService | ConfigService>,
): Promise<A> =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(GitService.Live),
      Effect.provide(
        Layer.succeed(ConfigService, {
          load: Effect.succeed({
            workflow: def,
            workflowVars: {},
            rcVars: {},
            machineTree: { key: "unified", machine: "unified", states: [], children: [] },
          }),
        }),
      ),
      Effect.provide(Cwd.layer(dir)),
      Effect.provide(NodeContext.layer),
    ),
  )

const run = <A>(eff: Effect.Effect<A, Error, GitService | ConfigService>): Promise<A> =>
  runIn(repoDir, eff)

/**
 * A LINKED worktree of `repoDir` (`git worktree add`) on its own branch, with
 * one non-gtd commit of its own on top of the shared base — the sibling
 * worktree of issue #118. Sharing one `.git`, it shares the ref store too, so
 * only a per-worktree ref namespace keeps the two windows apart.
 */
let siblingDir: string | undefined

const addSiblingWorktree = (base: string): string => {
  siblingDir = `${repoDir}-sibling`
  gitExec("worktree", "add", "-q", "-b", "sibling", siblingDir, base)
  gitIn(siblingDir, "commit", "--allow-empty", "-m", '"feat: sibling work"')
  return siblingDir
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "gtd-review-window-"))
  gitExec("init")
  gitExec("config", "user.email", '"t@t.com"')
  gitExec("config", "user.name", '"T"')
  // Never depend on the developer's own signing setup for a throwaway repo.
  gitExec("config", "commit.gpgsign", "false")
  commit("chore: initial commit", { "readme.txt": "hello" })
})

afterEach(() => {
  if (siblingDir !== undefined) rmSync(siblingDir, { recursive: true, force: true })
  siblingDir = undefined
  rmSync(repoDir, { recursive: true, force: true })
})

describe("openReviewWindow / closeReviewWindow — base = process start", () => {
  it("rewinds HEAD to the cycle boundary, surfaces the diff, and restores on close", async () => {
    commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
    commit("gtd(human): gate", { "src/other.ts": "export const x = 1\n" })
    const realHead = gitExec("rev-parse", "HEAD")

    const opened = await run(openReviewWindow)
    expect(opened.opened).toBe(true)
    // HEAD rewound to the process boundary (the non-gtd initial commit).
    expect(headSubject()).toBe("chore: initial commit")
    expect(refExists(REVIEW_HEAD_REF)).toBe(true)
    expect(refExists(REVIEW_BASE_REF)).toBe(true)
    // The whole cycle diff is now uncommitted.
    expect(status()).toContain("src/calc.ts")
    expect(status()).toContain("src/other.ts")

    const closed = await run(closeReviewWindow)
    expect(closed.closed).toBe(true)
    expect(gitExec("rev-parse", "HEAD")).toBe(realHead)
    expect(headSubject()).toBe("gtd(human): gate")
    expect(refExists(REVIEW_HEAD_REF)).toBe(false)
    expect(refExists(REVIEW_BASE_REF)).toBe(false)
    // The working tree is clean again — the surfaced diff was re-committed.
    expect(status()).toBe("")
  })

  it("is a no-op when resting anywhere but a reviewWindow state", async () => {
    commit("gtd(agent): building", { "src/calc.ts": "x\n" })
    const opened = await run(openReviewWindow)
    expect(opened.opened).toBe(false)
    expect(refExists(REVIEW_HEAD_REF)).toBe(false)
  })
})

describe("reviewBase — narrowing the diff base", () => {
  it("opens against the most-recent in-process reviewBase commit", async () => {
    commit("gtd(agent): building", { "src/a.ts": "a\n" })
    commit("gtd(human): checkpoint")
    const checkpoint = gitExec("rev-parse", "HEAD")
    commit("gtd(agent): building", { "src/b.ts": "b\n" })
    commit("gtd(human): gate")

    const base = await run(
      Effect.gen(function* () {
        const git = yield* GitService
        const run = yield* computeProcessRun(git, def)
        return yield* reviewBaseHash(git, def, run)
      }),
    )
    expect(base).toBe(checkpoint)

    await run(openReviewWindow)
    // HEAD rewound to the checkpoint, so only work AFTER it surfaces.
    expect(headSubject()).toBe("gtd(human): checkpoint")
    expect(status()).toContain("src/b.ts")
    expect(status()).not.toContain("src/a.ts")
  })
})

describe("closeReviewWindow — safety", () => {
  it("is a no-op when no window is open", async () => {
    const closed = await run(closeReviewWindow)
    expect(closed.closed).toBe(false)
  })
})

describe("linked worktrees — per-worktree window refs (issue #118)", () => {
  it("keeps a sibling worktree out of another worktree's open window", async () => {
    const base = gitExec("rev-parse", "HEAD")
    commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
    commit("gtd(human): gate")
    const sibling = addSiblingWorktree(base)
    const siblingHead = gitIn(sibling, "rev-parse", "HEAD")

    const opened = await run(openReviewWindow)
    expect(opened.opened).toBe(true)
    // The window's refs live in the per-worktree namespace, so the sibling
    // sharing this `.git` cannot even see them…
    expect(refExists(REVIEW_HEAD_REF)).toBe(true)
    expect(refExistsIn(sibling, REVIEW_HEAD_REF)).toBe(false)

    // …and its own gtd invocations close nothing: pre-7.2 this reset the
    // sibling's branch onto THIS worktree's saved head.
    const closed = await runIn(sibling, closeReviewWindow)
    expect(closed.closed).toBe(false)
    expect(gitIn(sibling, "rev-parse", "HEAD")).toBe(siblingHead)

    // This worktree's window survived the sibling's invocation untouched.
    expect(headSubject()).toBe("chore: initial commit")
    expect(refExists(REVIEW_HEAD_REF)).toBe(true)
    const restored = await run(closeReviewWindow)
    expect(restored.closed).toBe(true)
    expect(headSubject()).toBe("gtd(human): gate")
  })
})

describe("closeReviewWindow — the legacy shared refs (gtd ≤ 7.1)", () => {
  // A window an older gtd left open across the upgrade: HEAD rewound to the
  // base, the real head parked under the SHARED refs.
  const openLegacyWindow = (dir: string, base: string, head: string): void => {
    gitIn(dir, "update-ref", LEGACY_REVIEW_BASE_REF, base)
    gitIn(dir, "update-ref", LEGACY_REVIEW_HEAD_REF, head)
    gitIn(dir, "reset", "--mixed", base)
  }

  it("finishes a window left behind by an older gtd in this worktree", async () => {
    const base = gitExec("rev-parse", "HEAD")
    commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
    commit("gtd(human): gate")
    const realHead = gitExec("rev-parse", "HEAD")
    openLegacyWindow(repoDir, base, realHead)

    const closed = await run(closeReviewWindow)
    expect(closed.closed).toBe(true)
    expect(gitExec("rev-parse", "HEAD")).toBe(realHead)
    expect(refExists(LEGACY_REVIEW_HEAD_REF)).toBe(false)
    expect(refExists(LEGACY_REVIEW_BASE_REF)).toBe(false)
    expect(status()).toBe("")
  })

  it("refuses a shared-ref window that belongs to another worktree, leaving the branch alone", async () => {
    const base = gitExec("rev-parse", "HEAD")
    commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
    commit("gtd(human): gate")
    const realHead = gitExec("rev-parse", "HEAD")
    const sibling = addSiblingWorktree(base)
    const siblingHead = gitIn(sibling, "rev-parse", "HEAD")
    openLegacyWindow(repoDir, base, realHead)

    await expect(runIn(sibling, closeReviewWindow)).rejects.toThrow(
      /does not belong to this worktree/,
    )
    // Nothing moved, nothing was deleted — the owning worktree can still
    // recover with the commands the message spells out.
    expect(gitIn(sibling, "rev-parse", "HEAD")).toBe(siblingHead)
    expect(refExists(LEGACY_REVIEW_HEAD_REF)).toBe(true)
    expect(refExists(LEGACY_REVIEW_BASE_REF)).toBe(true)
  })
})
