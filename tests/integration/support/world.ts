import { World, setWorldConstructor } from "@cucumber/cucumber"
import { execSync, spawnSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.js")

export class GtdWorld extends World {
  repoDir!: string
  lastResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  }

  runGtd(...args: string[]) {
    const verbose = process.env["GTD_E2E_VERBOSE"] === "1"
    const result = spawnSync(process.execPath, [GTD_BIN, ...args], {
      cwd: this.repoDir,
      env: { ...process.env, GTD_TEST_CMD: "npm test", CLAUDECODE: "" },
      encoding: "utf-8",
      timeout: 300_000,
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

  execInRepo(cmd: string, args: string[] = []): string {
    return execSync([cmd, ...args].join(" "), {
      cwd: this.repoDir,
      encoding: "utf-8",
      timeout: 120_000,
    })
  }
}

setWorldConstructor(GtdWorld)
