import { Given } from "quickpickle"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"
import { CONFIG_SCAFFOLD } from "../../../../src/install/index.js"
import { createPlainDirectory, createTestProjectWithSubdir } from "../../helpers/project-setup.js"

// @live only: the in-memory tier has no directories above the repository.
Given(
  "a test project nested under a directory with a file {string} containing:",
  (world: GtdWorld, name: string, content: string) => {
    if (world.tier !== "live") {
      throw new Error("this step writes above the repository and requires an @live scenario")
    }
    const outer = mkdtempSync(join(tmpdir(), "gtd-ancestor-"))
    writeFileSync(join(outer, name), content.endsWith("\n") ? content : content + "\n")
    const repo = join(outer, "repo")
    mkdirSync(repo)
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" })
    git("init", "-q")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@test.com")
    git("config", "commit.gpgsign", "false")
    writeFileSync(join(repo, "README.md"), "# test project\n")
    git("add", "-A")
    git("commit", "-q", "-m", "chore: initial commit")
    world.repoDir = repo
    world.extraCleanupDir = outer
  },
)

// A plain directory that is NOT a git repository. @live only, because the
// location guards shell out to real `git rev-parse --show-toplevel`.
Given("a plain directory that is not a git repository", (world: GtdWorld) => {
  if (world.tier !== "live") {
    throw new Error("this step runs gtd outside a git repo and requires an @live scenario")
  }
  world.repoDir = createPlainDirectory()
})

// A git repo with gtd run from a SUBDIRECTORY of it. `extraCleanupDir` holds
// the repo root so the After hook removes it all.
Given("a subdirectory of a test project", (world: GtdWorld) => {
  if (world.tier !== "live") {
    throw new Error("this step runs gtd from a repo subdirectory and requires an @live scenario")
  }
  const { repo, sub } = createTestProjectWithSubdir()
  world.repoDir = sub
  world.extraCleanupDir = repo
})

// Commits after writing so the tree stays clean — an untracked config would
// otherwise route gtd to the commit-the-uncommitted-changes leaf before the
// state under test is reached.
Given(
  "a gtd config file at {string} with:",
  // fallow-ignore-next-line complexity
  (world: GtdWorld, rel: string, content: string) => {
    const normalized = content.endsWith("\n") ? content : content + "\n"
    if (world.tier === "inmem") {
      world.repo!.writeFile(rel, normalized)
      world.repo!.commitAllWithPrefix(`chore: add ${rel}`)
    } else {
      const full = join(world.repoDir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, normalized)
      execFileSync("git", ["add", rel], { cwd: world.repoDir, stdio: "pipe" })
      execFileSync("git", ["commit", "-q", "-m", `chore: add ${rel}`], {
        cwd: world.repoDir,
        stdio: "pipe",
      })
    }
  },
)

// What `gtd install` leaves behind: a `gtd.config.ts` running the shipped
// workflows. One clean commit at the default entry's first step.
const scaffoldUnifiedWorkflow = (world: GtdWorld): void => {
  const files = { "gtd.config.ts": CONFIG_SCAFFOLD }
  if (world.tier === "inmem") {
    for (const [path, content] of Object.entries(files)) world.repo!.writeFile(path, content)
    world.repo!.commitAllWithPrefix("chore: init gtd workflow")
  } else {
    for (const [path, content] of Object.entries(files)) {
      writeFileSync(join(world.repoDir, path), content)
    }
    execFileSync("git", ["add", ...Object.keys(files)], { cwd: world.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", "chore: init gtd workflow"], {
      cwd: world.repoDir,
      stdio: "pipe",
    })
  }
}

Given("the workflow gtd install scaffolds", (world: GtdWorld) => scaffoldUnifiedWorkflow(world))

// Appends to a committed file and commits again — e.g. a `config` export below
// the workflows an earlier step wrote.
Given("the file {string} ends with:", (world: GtdWorld, path: string, content: string) => {
  const tail = `\n${content.endsWith("\n") ? content : content + "\n"}`
  if (world.tier === "inmem") {
    const before = world.repo!.readFile(path)
    if (before === undefined) throw new Error(`${path} does not exist`)
    world.repo!.writeFile(path, before + tail)
    world.repo!.commitAllWithPrefix(`chore: extend ${path}`)
  } else {
    const full = join(world.repoDir, path)
    writeFileSync(full, readFileSync(full, "utf8") + tail)
    execFileSync("git", ["add", path], { cwd: world.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", `chore: extend ${path}`], {
      cwd: world.repoDir,
      stdio: "pipe",
    })
  }
})

// Sets an environment variable the in-memory tier's `EnvVars` layer exposes —
// exactly the `GTD_<UPPERCASE-name>` highest-precedence layer of the merged
// `it.vars` (see src/edge/Edge.ts's `resolveVars`). Never touches the real
// `process.env`: `world.envVars` flows straight into `testLayers`.
Given(
  "an environment variable {string} set to {string}",
  (world: GtdWorld, name: string, value: string) => {
    world.envVars[name] = value
  },
)

// Removes it from both tiers: the in-memory layer and the live tier's
// inherited environment, so a scenario never depends on what was exported.
Given("the environment variable {string} is unset", (world: GtdWorld, name: string) => {
  delete world.envVars[name]
  world.unsetEnvVars.push(name)
})
