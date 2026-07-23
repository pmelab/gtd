import { QuickPickleWorld, setWorldConstructor } from "quickpickle"
import type { TestContext } from "vitest"
import type { InfoConstructor } from "quickpickle"
import { Effect, Exit, Cause } from "effect"
import { execSync, execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCb)
import { existsSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { makeProgram } from "../../../src/program.js"
import { inMemoryLayers } from "./inmem/layers.js"
import { InMemRepo } from "./inmem/Repo.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

export type Tier = "live" | "inmem"

export class GtdWorld extends QuickPickleWorld {
  constructor(context: TestContext, info: InfoConstructor) {
    super(context, info)
  }

  repoDir!: string
  /** In-memory repo for the `inmem` tier. When set, file/git ops use this instead of repoDir. */
  repo: InMemRepo | undefined = undefined
  /** Which execution tier is active for this scenario. Set by the Before hook. */
  tier: Tier = "inmem"

  lastResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  }
  savedCommitCount: number | undefined = undefined
  /** Path to a stub agent script for `gtd-loop` scenarios (@live only). */
  stubAgentPath: string | undefined = undefined

  /** Environment variables the in-memory tier's `EnvVars` layer exposes (`it.vars`'s highest-precedence `GTD_VAR_` layer) — never mutates the real `process.env`. Set by `Given an environment variable "..." set to "..."`. */
  envVars: Record<string, string> = {}

  /** Dispatch: routes to the live or in-process implementation based on this.tier. */
  async runGtd(...args: string[]): Promise<void> {
    if (this.tier === "inmem") {
      await this.runGtdInMem(...args)
    } else {
      await this.runGtdLive(...args)
    }
  }

  /** Async execFile implementation — used for the live tier. */
  // fallow-ignore-next-line complexity
  async runGtdLive(...args: string[]): Promise<void> {
    const verbose = process.env["GTD_E2E_VERBOSE"] === "1"
    try {
      const { stdout, stderr } = await execFile(process.execPath, [GTD_BIN, ...args], {
        cwd: this.repoDir,
        env: { ...process.env, NODE_OPTIONS: undefined },
        encoding: "utf-8",
        timeout: 30_000,
      })
      if (verbose) {
        process.stderr.write(stdout)
        process.stderr.write(stderr)
      }
      this.lastResult = { exitCode: 0, stdout, stderr }
    } catch (err: unknown) {
      const e = err as { code?: unknown; stdout?: string; stderr?: string }
      const exitCode = typeof e.code === "number" ? e.code : 1
      const stdout = e.stdout ?? ""
      const stderr = e.stderr ?? ""
      if (verbose) {
        process.stderr.write(stdout)
        process.stderr.write(stderr)
      }
      this.lastResult = { exitCode, stdout, stderr }
    }
  }

  /** In-process implementation — runs the exported program Effect with in-memory layers. */
  async runGtdInMem(...args: string[]): Promise<void> {
    const repo = this.repo!
    let stdout = ""
    const write = (chunk: string) => {
      stdout += chunk
    }

    // Compose argv: ["node", "gtd.js", ...args]
    const argv = ["node", "gtd.js", ...args]

    const program = makeProgram({ argv, write }).pipe(
      Effect.provide(inMemoryLayers(repo, this.envVars)),
    )

    const exit = await Effect.runPromiseExit(program)
    if (Exit.isSuccess(exit)) {
      this.lastResult = { exitCode: 0, stdout, stderr: "" }
    } else {
      // Extract the underlying error message from the Cause
      const squashed = Cause.squash(exit.cause)
      const message = squashed instanceof Error ? squashed.message : String(squashed)
      this.lastResult = { exitCode: 1, stdout, stderr: `gtd: ${message}\n` }
    }
  }

  // ── Observation helpers — branch on tier ──────────────────────────────────

  // fallow-ignore-next-line complexity
  repoFileExists(path: string): boolean {
    if (this.repo !== undefined) {
      const worktree = (this.repo as unknown as { worktree: Map<string, string> })["worktree"]
      if (worktree.has(path)) return true
      // Check for directory prefix
      const prefix = path.endsWith("/") ? path : `${path}/`
      for (const key of worktree.keys()) {
        if (key.startsWith(prefix)) return true
      }
      return false
    }
    return existsSync(join(this.repoDir, path))
  }

  gitLog(): string {
    if (this.repo !== undefined) {
      const history = this.repo.commitHistory()
      // Render in oneline format: "<hash_short> <message>" newest→oldest
      return (
        history
          .slice()
          .reverse()
          .map((c) => `${c.hash.slice(0, 7)} ${c.message}`)
          .join("\n") + "\n"
      )
    }
    return execSync("git log --oneline", {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
  }

  lastCommitPrefix(): string {
    if (this.repo !== undefined) {
      return this.lastCommitSubject().slice(0, 2)
    }
    return execSync('git log -1 --format="%s"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
      .trim()
      .slice(0, 2)
  }

  lastCommitSubject(): string {
    if (this.repo !== undefined) {
      const subject = this.repo.lastCommitSubject()
      if (subject === null) throw new Error("No commits in in-memory repo")
      return subject
    }
    return execSync('git log -1 --format="%s"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
  }

  lastCommitBody(): string {
    if (this.repo !== undefined) {
      // InMemRepo stores only the full message; extract body (lines after first)
      const history = this.repo.commitHistory()
      if (history.length === 0) throw new Error("No commits in in-memory repo")
      const last = history[history.length - 1]!
      const lines = last.message.split("\n")
      return lines.slice(1).join("\n").trim()
    }
    return execSync('git log -1 --format="%b"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
  }

  commitCount(): number {
    if (this.repo !== undefined) {
      return this.repo.commitHistory().length
    }
    return parseInt(
      execSync("git rev-list --count HEAD", {
        cwd: this.repoDir,
        encoding: "utf-8",
      }).trim(),
      10,
    )
  }

  /** Porcelain status with untracked files listed individually. */
  gitStatus(): string {
    if (this.repo !== undefined) {
      return this.repo.statusPorcelain()
    }
    return execSync("git status --porcelain -uall", {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
  }

  /** Whether a repo-local ref (e.g. `refs/gtd/review-head`) resolves to a commit. */
  gitRefExists(ref: string): boolean {
    if (this.repo !== undefined) {
      return this.repo.resolveRef(ref) !== null
    }
    try {
      execSync(`git rev-parse --verify --quiet ${ref}`, {
        cwd: this.repoDir,
        encoding: "utf-8",
        stdio: "pipe",
      })
      return true
    } catch {
      return false
    }
  }

  /** Plain working-tree deletion (no git involvement — what an editor's delete does). */
  deleteWorktreeFile(path: string): void {
    if (this.repo !== undefined) {
      this.repo.deleteFile(path)
      return
    }
    unlinkSync(join(this.repoDir, path))
  }

  execInRepo(cmd: string, args: string[] = []): string {
    return execSync([cmd, ...args].join(" "), {
      cwd: this.repoDir,
      encoding: "utf-8",
      timeout: 120_000,
    })
  }
}

setWorldConstructor(GtdWorld)
