import { Given } from "quickpickle"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"
import { renderInitConfig } from "../../../../src/workflows/templates.js"
import {
  createPlainDirectory,
  createTestProjectUnderConfiguredAncestor,
  createTestProjectWithSubdir,
} from "../../helpers/project-setup.js"

// A test project whose PARENT directory already carries a `.gtdrc.json` —
// modelling a global/ancestor config (e.g. `~/.gtdrc`) above the repo. @live
// only, because the guard under test (`gtd init`'s `configPresentAt`) reads the
// real filesystem via cosmiconfig; the point is that an ancestor config must
// NOT count as "this repo already has a config".
Given(
  "a test project nested under a directory that already has a gtd config",
  (world: GtdWorld) => {
    if (world.tier !== "live") {
      throw new Error("this step models a real ancestor config and requires an @live scenario")
    }
    const { outer, repo } = createTestProjectUnderConfiguredAncestor()
    world.repoDir = repo
    world.extraCleanupDir = outer
  },
)

// A plain directory that is NOT a git repository — models scaffolding a shared
// config in a parent directory. @live only, because `gtd init`'s location guard
// (`assertInitLocation`) shells out to real `git rev-parse --show-toplevel`.
Given("a plain directory that is not a git repository", (world: GtdWorld) => {
  if (world.tier !== "live") {
    throw new Error("this step runs gtd outside a git repo and requires an @live scenario")
  }
  world.repoDir = createPlainDirectory()
})

// A git repo with gtd run from a SUBDIRECTORY of it — models the placement
// `gtd init` must refuse (config below the root is never found by the upward
// walk). `extraCleanupDir` holds the repo root so the After hook removes it all.
Given("a subdirectory of a test project", (world: GtdWorld) => {
  if (world.tier !== "live") {
    throw new Error("this step runs gtd from a repo subdirectory and requires an @live scenario")
  }
  const { repo, sub } = createTestProjectWithSubdir()
  world.repoDir = sub
  world.extraCleanupDir = repo
})

// Writes a gtd config file inside the test repo and commits it. `pathOrDir` is
// resolved relative to repoDir. A trailing "/" (or ".") means "write `.gtdrc`
// into that directory"; otherwise it is treated as the literal config
// filename/path. The docstring body (YAML or JSON) is written verbatim, so the
// scenario text shows the exact config under test. Committing keeps the working
// tree clean — an untracked config would otherwise route gtd to the
// commit-the-uncommitted-changes leaf before the state under test is reached.
Given(
  "a gtd config file at {string} with:",
  // fallow-ignore-next-line complexity
  (world: GtdWorld, pathOrDir: string, content: string) => {
    const rel = pathOrDir === "." || pathOrDir.endsWith("/") ? join(pathOrDir, ".gtdrc") : pathOrDir
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

// Scaffolds the bundled unified workflow template into `.gtdrc.json` and
// commits it — exactly what `gtd init` writes (via the same `renderInitConfig`),
// minus the "leave it uncommitted" part: committing keeps the working tree
// clean so the machine starts at the template's initial state. gtd ships one
// template and no default fallback, so a scenario exercising its shape sets it
// up explicitly here.
const scaffoldUnifiedWorkflow = (world: GtdWorld): void => {
  const content = renderInitConfig()
  if (world.tier === "inmem") {
    world.repo!.writeFile(".gtdrc.json", content)
    world.repo!.commitAllWithPrefix("chore: init gtd workflow")
  } else {
    writeFileSync(join(world.repoDir, ".gtdrc.json"), content)
    execFileSync("git", ["add", ".gtdrc.json"], { cwd: world.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", "chore: init gtd workflow"], {
      cwd: world.repoDir,
      stdio: "pipe",
    })
  }
}

Given("the workflow", (world: GtdWorld) => scaffoldUnifiedWorkflow(world))

// Sets an environment variable the in-memory tier's `EnvVars` layer exposes —
// exactly the `GTD_VAR_`-prefixed highest-precedence layer of the merged
// `it.vars` (see src/Edge.ts's `resolveVars`). Never touches the real
// `process.env`: `world.envVars` flows straight into `inMemoryLayers`.
Given(
  "an environment variable {string} set to {string}",
  (world: GtdWorld, name: string, value: string) => {
    world.envVars[name] = value
  },
)
