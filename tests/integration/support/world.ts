import { World, setWorldConstructor } from "@cucumber/cucumber"
import { execSync, spawnSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
const GTD_BIN = join(PROJECT_ROOT, "scripts/gtd.js")

export class GtdWorld extends World {
  repoDir!: string
  lastResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  }
  savedCommitCount: number | undefined = undefined

  /** Directory the next `runGtd` uses as cwd; defaults to the repo root. */
  runCwd: string | undefined = undefined

  runGtd(...args: string[]) {
    const verbose = process.env["GTD_E2E_VERBOSE"] === "1"
    const result = spawnSync(process.execPath, [GTD_BIN, ...args], {
      cwd: this.runCwd ?? this.repoDir,
      env: { ...process.env },
      encoding: "utf-8",
      timeout: 30_000,
    })
    const stdout = result.stdout ?? ""
    const stderr = result.stderr ?? ""
    const exitCode = result.status ?? 1
    if (verbose) {
      process.stderr.write(stdout)
      process.stderr.write(stderr)
    }
    this.lastResult = { exitCode, stdout, stderr }
  }

  repoFile(path: string): string {
    return readFileSync(join(this.repoDir, path), "utf-8")
  }

  repoFileExists(path: string): boolean {
    return existsSync(join(this.repoDir, path))
  }

  gitLog(): string {
    return execSync("git log --oneline", {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
  }

  lastCommitPrefix(): string {
    return execSync('git log -1 --format="%s"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
      .trim()
      .slice(0, 2)
  }

  lastCommitSubject(): string {
    return execSync('git log -1 --format="%s"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
  }

  lastCommitBody(): string {
    return execSync('git log -1 --format="%b"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
  }

  commitCount(): number {
    return parseInt(
      execSync("git rev-list --count HEAD", {
        cwd: this.repoDir,
        encoding: "utf-8",
      }).trim(),
      10,
    )
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
