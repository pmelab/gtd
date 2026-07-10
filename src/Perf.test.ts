import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { gatherEvents } from "./Events.js"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { buildPrompt } from "./Prompt.js"
import { DEFAULT_PAYLOAD, resolve } from "./Machine.js"

// Performance smokes (non-blocking budgets, sized generously to avoid CI
// flake): gatherEvents scans the FULL commit history on every invocation, so a
// long-lived repo must not make each gtd run crawl; prompt assembly must cope
// with a five-digit-line review diff.

let repoDir: string
let savedCwd: string

const git = (...args: string[]): void => {
  execFileSync("git", args, { cwd: repoDir, stdio: "pipe" })
}

const cleanup = (): void => {
  process.chdir(savedCwd)
  rmSync(repoDir, { recursive: true, force: true })
}

describe("performance smoke", { timeout: 180_000 }, () => {
  afterEach(cleanup)

  it("gatherEvents stays under 5s on a 300-commit history", async () => {
    repoDir = mkdtempSync(join(tmpdir(), "gtd-perf-"))
    git("init", "-q")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@test.com")
    git("config", "commit.gpgsign", "false")
    writeFileSync(join(repoDir, "README.md"), "# perf\n")
    git("add", "-A")
    git("commit", "-q", "-m", "chore: init")
    git("branch", "-M", "main")
    // Build the 300-commit history with a single `git fast-import` stream —
    // one spawn instead of 300, keeping the suite's setup cost negligible.
    // A commit with no file commands keeps its parent's tree (empty commits).
    const ident = "T <t@t> 1700000000 +0000"
    let stream = ""
    for (let i = 0; i < 300; i++) {
      const msg = `feat: change ${i}\n`
      stream += `commit refs/heads/main\nauthor ${ident}\ncommitter ${ident}\ndata ${Buffer.byteLength(msg)}\n${msg}`
      if (i === 0) stream += "from refs/heads/main^0\n"
      stream += "\n"
    }
    execFileSync("git", ["fast-import", "--quiet"], { cwd: repoDir, input: stream })
    // fast-import moves the ref without touching the working tree; re-align.
    git("reset", "-q", "--hard", "main")
    savedCwd = process.cwd()
    process.chdir(repoDir)

    const start = performance.now()
    const events = await Effect.runPromise(
      gatherEvents("none").pipe(
        Effect.provide(GitService.Live),
        Effect.provide(NodeContext.layer),
        Effect.provide(
          Layer.succeed(ConfigService, {
            testCommand: "true",
            resolveModel: () => "claude-opus-4-8",
            agenticReview: true,
            squash: true,
            fixAttemptCap: 3,
            reviewThreshold: 3,
          }),
        ),
        Effect.provide(Cwd.layer(repoDir)),
      ),
    )
    const elapsed = performance.now() - start

    expect(events.length).toBeGreaterThan(300)
    expect(elapsed).toBeLessThan(5000)
  })

  it("prompt assembly copes with a 10k-line review diff under 2s", () => {
    // Pure — no repo needed, but afterEach expects one to clean up.
    repoDir = mkdtempSync(join(tmpdir(), "gtd-perf-"))
    savedCwd = process.cwd()

    const bigDiff =
      "diff --git a/big.ts b/big.ts\n" +
      Array.from({ length: 10_000 }, (_, i) => `+const line${i} = ${i}`).join("\n")
    const result = resolve([
      {
        type: "RESOLVE",
        payload: {
          ...DEFAULT_PAYLOAD,
          invoker: "none",
          lastCommitSubject: "feat: shipped",
          reviewBase: "abc123",
          refDiff: bigDiff,
        },
      },
    ])

    const start = performance.now()
    const prompt = buildPrompt(result)
    const elapsed = performance.now() - start

    expect(result.state).toBe("review")
    expect(prompt).toContain("const line9999 = 9999")
    expect(elapsed).toBeLessThan(2000)
  })
})
