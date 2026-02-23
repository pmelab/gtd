import { Given, When } from "@cucumber/cucumber"
import { writeFileSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"
import {
  createTestProject,
  setupSeeded,
  setupSeededWithConfig,
  setupSeededAndExplored,
  setupExploredWithHumanEdits,
  setupExploredWithFeedback,
  setupSeededAndPlanned,
  setupPlannedWithFeedback,
  setupBuilt,
  setupCodeTodosProcessed,
  setupTwiceBuilt,
  setupFullyCompleted,
} from "../../helpers/project-setup.js"

Given("a test project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
})

Given("a seeded project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupSeeded(this.repoDir)
})

Given("a seeded and explored project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupSeededAndExplored(this.repoDir)
})

Given("an explored project with human edits", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupExploredWithHumanEdits(this.repoDir)
})

Given(
  "a seeded project with modelExplore {string}",
  function (this: GtdWorld, model: string) {
    this.repoDir = createTestProject()
    setupSeededWithConfig(this.repoDir, { modelExplore: model })
  },
)

Given("a staged TODO with multiply tasks", function (this: GtdWorld) {
  const todoPath = join(this.repoDir, "TODO.md")
  writeFileSync(
    todoPath,
    `- add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- add a test for the \`multiply\` function in \`tests/math.test.ts\`
`,
  )
  execSync("git add TODO.md", { cwd: this.repoDir })
})

Given("an untracked TODO with multiply tasks", function (this: GtdWorld) {
  const todoPath = join(this.repoDir, "TODO.md")
  writeFileSync(
    todoPath,
    `- add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- add a test for the \`multiply\` function in \`tests/math.test.ts\`
`,
  )
  // Intentionally NOT staging — tests that getDiff() picks up untracked files
})

Given("an explored project with feedback", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupExploredWithFeedback(this.repoDir)
})

Given("a seeded and planned project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupSeededAndPlanned(this.repoDir)
})

Given("a planned project with feedback", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupPlannedWithFeedback(this.repoDir)
})

Given("a built project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupBuilt(this.repoDir)
})

Given("a project with code TODOs processed", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupCodeTodosProcessed(this.repoDir)
})

Given("a twice-built project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupTwiceBuilt(this.repoDir)
})

Given("a fully completed project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
  setupFullyCompleted(this.repoDir)
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

When("I run gtd", function (this: GtdWorld) {
  this.runGtd()
})
