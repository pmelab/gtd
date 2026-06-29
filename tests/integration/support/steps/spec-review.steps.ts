import { Given } from "@cucumber/cucumber"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"

// Creates the committed-unreviewed package state: the spec .md file is
// committed inside .gtd/<pkg>/ but COMMIT_MSG.md is absent (it was consumed
// by the execute commit). This is the signal that a package has been executed
// and is awaiting spec review. The docstring is the spec body (acceptance
// criteria with `- [ ]` checkboxes).
Given(
  "a committed-unreviewed package {string} with spec:",
  function (this: GtdWorld, pkg: string, spec: string) {
    const specFile = join(pkg, "01-task.md")
    const full = join(this.repoDir, specFile)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, spec.endsWith("\n") ? spec : spec + "\n")
    execFileSync("git", ["add", specFile], { cwd: this.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", `plan(gtd): decompose`], {
      cwd: this.repoDir,
      stdio: "pipe",
    })
  },
)

// Creates a history-marker commit representing one completed spec-review fix
// cycle. The `Gtd-Spec-Review:` trailer lets the cycle counter find it.
// --allow-empty keeps the working tree clean so it doesn't affect diff content.
Given(
  "a prior spec review fix commit {string}",
  function (this: GtdWorld, n: string) {
    execFileSync(
      "git",
      [
        "commit",
        "--allow-empty",
        "-m",
        `fix(gtd): spec review fix ${n}`,
        "-m",
        `Gtd-Spec-Review: ${n}`,
      ],
      { cwd: this.repoDir, stdio: "pipe" },
    )
  },
)
