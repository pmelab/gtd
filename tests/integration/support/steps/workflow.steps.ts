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

Given("{string} has a learnings section", function (this: GtdWorld, file: string) {
  const filePath = join(this.repoDir, file)
  const content = readFileSync(filePath, "utf-8")
  if (!content.toLowerCase().includes("## learnings")) {
    writeFileSync(
      filePath,
      content + "\n## Learnings\n\n- avoid magic numbers in business logic\n",
    )
  }
  // Ensure at least one learning survives after removing "magic numbers"
  const updated = readFileSync(filePath, "utf-8")
  if (!updated.includes("always validate inputs")) {
    writeFileSync(filePath, updated + "- always validate inputs at system boundaries\n")
  }
})

Given(
  "the {string} learning is removed from {string}",
  function (this: GtdWorld, pattern: string, file: string) {
    const filePath = join(this.repoDir, file)
    const content = readFileSync(filePath, "utf-8")
    // Remove lines containing the pattern within the Learnings section
    const lines = content.split("\n")
    let inLearnings = false
    const filtered = lines.filter((line) => {
      if (line.match(/^## Learnings/i)) inLearnings = true
      else if (line.match(/^## /) && inLearnings) inLearnings = false
      if (inLearnings && line.includes(pattern)) return false
      return true
    })
    writeFileSync(filePath, filtered.join("\n"))
  },
)

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
