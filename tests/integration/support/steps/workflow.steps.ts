import { Given, When } from "@cucumber/cucumber"
import { writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"
import { createTestProject } from "../../helpers/project-setup.js"

Given("a test project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
})

// File mutation steps

Given(
  "{string} has appended blockquote {string}",
  function (this: GtdWorld, file: string, text: string) {
    const filePath = join(this.repoDir, file)
    const content = readFileSync(filePath, "utf-8")
    writeFileSync(filePath, content + "\n" + text + "\n")
  },
)

Given("{string} has an appended newline", function (this: GtdWorld, file: string) {
  const filePath = join(this.repoDir, file)
  const content = readFileSync(filePath, "utf-8")
  writeFileSync(filePath, content + "\n")
})

Given("{string} has prepended {string}", function (this: GtdWorld, file: string, text: string) {
  const filePath = join(this.repoDir, file)
  const content = readFileSync(filePath, "utf-8")
  writeFileSync(filePath, text + "\n" + content)
})

Given("{string} has appended {string}", function (this: GtdWorld, file: string, text: string) {
  const filePath = join(this.repoDir, file)
  const content = readFileSync(filePath, "utf-8")
  writeFileSync(filePath, content + text + "\n")
})

// Generic git commit steps

Given(
  "a commit {string} that adds {string} with:",
  function (this: GtdWorld, message: string, filePath: string, content: string) {
    const fullPath = join(this.repoDir, filePath)
    mkdirSync(join(fullPath, ".."), { recursive: true })
    writeFileSync(fullPath, content.endsWith("\n") ? content : content + "\n")
    execFileSync("git", ["add", filePath], { cwd: this.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: this.repoDir, stdio: "pipe" })
  },
)

Given(
  "a commit {string} that updates {string} with:",
  function (this: GtdWorld, message: string, filePath: string, content: string) {
    const fullPath = join(this.repoDir, filePath)
    writeFileSync(fullPath, content.endsWith("\n") ? content : content + "\n")
    execFileSync("git", ["add", filePath], { cwd: this.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: this.repoDir, stdio: "pipe" })
  },
)

Given(
  "a commit {string} that removes {string}",
  function (this: GtdWorld, message: string, filePath: string) {
    execFileSync("git", ["rm", "-q", filePath], { cwd: this.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: this.repoDir, stdio: "pipe" })
  },
)

Given(
  "a staged file {string} with:",
  function (this: GtdWorld, filePath: string, content: string) {
    const fullPath = join(this.repoDir, filePath)
    mkdirSync(join(fullPath, ".."), { recursive: true })
    writeFileSync(fullPath, content.endsWith("\n") ? content : content + "\n")
    execFileSync("git", ["add", filePath], { cwd: this.repoDir, stdio: "pipe" })
  },
)

Given(
  "an untracked file {string} with:",
  function (this: GtdWorld, filePath: string, content: string) {
    const fullPath = join(this.repoDir, filePath)
    mkdirSync(join(fullPath, ".."), { recursive: true })
    writeFileSync(fullPath, content.endsWith("\n") ? content : content + "\n")
    // Intentionally NOT staging — file remains untracked
  },
)

Given("a commit {string}", function (this: GtdWorld, message: string) {
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: this.repoDir,
    encoding: "utf-8",
    stdio: "pipe",
  })
  if (!status.trim()) {
    throw new Error(`Nothing staged to commit for "${message}"`)
  }
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: this.repoDir, stdio: "pipe" })
})

When("I run gtd", function (this: GtdWorld) {
  this.runGtd()
})
