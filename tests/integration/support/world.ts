import { World, setWorldConstructor } from "@cucumber/cucumber"
import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.js")

export class GtdWorld extends World {
  repoDir!: string
  sandboxDir?: string
  outsideDir?: string
  lastResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  }

  runGtd(...args: string[]) {
    const cmd = [process.execPath, GTD_BIN, ...args].join(" ")
    const verbose = process.env["GTD_E2E_VERBOSE"] === "1"
    try {
      const stdout = execSync(cmd, {
        cwd: this.repoDir,
        env: { ...process.env, GTD_TEST_CMD: "npm test", CLAUDECODE: "" },
        encoding: "utf-8",
        timeout: 300_000,
        stdio: ["pipe", "pipe", "pipe"],
      })
      if (verbose) process.stderr.write(stdout)
      this.lastResult = { exitCode: 0, stdout, stderr: "" }
    } catch (err: unknown) {
      const e = err as { status: number; stdout: string; stderr: string }
      if (verbose) {
        process.stderr.write(e.stdout ?? "")
        process.stderr.write(e.stderr ?? "")
      }
      this.lastResult = {
        exitCode: e.status ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
      }
    }
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

  execInRepo(cmd: string, args: string[] = []): string {
    return execSync([cmd, ...args].join(" "), {
      cwd: this.repoDir,
      encoding: "utf-8",
      timeout: 120_000,
    })
  }
}

setWorldConstructor(GtdWorld)
