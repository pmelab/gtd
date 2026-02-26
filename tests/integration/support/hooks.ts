import { BeforeAll, After } from "@cucumber/cucumber"
import { execSync } from "node:child_process"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
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

