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

// Commits after writing so the tree stays clean — an untracked config would
// otherwise route gtd to the commit-the-uncommitted-changes leaf before the
// state under test is reached.
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

// Materializes the bundled unified workflow into `.gtdrc.json` (via
// `renderInitConfig`) and commits it. The workflow is gtd's BUILT-IN default,
// so a scenario need not configure it — but pinning it explicitly (and
// committing to keep the tree clean, resting at the template's initial state)
// keeps a scenario's assertions stable against the exact shape it was written
// for. `renderInitConfig` is modes-free, so the steering-file gates stay
// hermetic (no shelling out to Prettier). This is NOT what `gtd init` writes
// (init seeds only vars/modes — see init.feature).
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
// exactly the `GTD_<UPPERCASE-name>` highest-precedence layer of the merged
// `it.vars` (see src/Edge.ts's `resolveVars`). Never touches the real
// `process.env`: `world.envVars` flows straight into `testLayers`.
Given(
  "an environment variable {string} set to {string}",
  (world: GtdWorld, name: string, value: string) => {
    world.envVars[name] = value
  },
)
