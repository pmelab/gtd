import { BeforeAll, Before, After } from "@cucumber/cucumber"
import { execSync } from "node:child_process"
import { rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { GtdWorld } from "./world.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")

BeforeAll(function () {
  execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "inherit" })
})

After(function (this: GtdWorld) {
  if (this.repoDir) {
    if (process.env["KEEP_TEST_REPO"] === "1") {
      process.stderr.write(`Test repo preserved at: ${this.repoDir}\n`)
    } else {
      rmSync(this.repoDir, { recursive: true, force: true })
    }
  }
})

Before({ tags: "@sandbox" }, function (this: GtdWorld) {
  this.sandboxDir = mkdtempSync(join(tmpdir(), "gtd-sandbox-"))
  this.outsideDir = mkdtempSync(join(tmpdir(), "gtd-outside-"))
})

After({ tags: "@sandbox" }, function (this: GtdWorld) {
  if (this.sandboxDir) rmSync(this.sandboxDir, { recursive: true, force: true })
  if (this.outsideDir) rmSync(this.outsideDir, { recursive: true, force: true })
})
