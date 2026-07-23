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
    idle: { actor: "human", message: "i", initial: true, on: [["* **", "building"]] },
    building: { actor: "agent", prompt: "b", on: [["* **", "gate"]] },
    checkpoint: { actor: "human", message: "c", reviewBase: true, on: [["* **", "gate"]] },
    gate: { actor: "human", message: "g", reviewWindow: true, on: [["* **", "idle"]] },
  },
}

let repoDir: string

const gitExec = (...args: string[]): string =>
  execSync(`git ${args.join(" ")}`, { cwd: repoDir, encoding: "utf8", stdio: "pipe" }).trim()

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
const refExists = (ref: string): boolean => {
  try {
    gitExec("rev-parse", "--verify", "--quiet", ref)
    return true
  } catch {
    return false
  }
}

const run = <A>(eff: Effect.Effect<A, Error, GitService | ConfigService>): Promise<A> =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(GitService.Live),
      Effect.provide(Layer.succeed(ConfigService, { workflow: def, workflowVars: {}, rcVars: {} })),
      Effect.provide(Cwd.layer(repoDir)),
      Effect.provide(NodeContext.layer),
    ),
  )

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "gtd-review-window-"))
  gitExec("init")
  gitExec("config", "user.email", '"t@t.com"')
  gitExec("config", "user.name", '"T"')
  commit("chore: initial commit", { "readme.txt": "hello" })
})

afterEach(() => {
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
