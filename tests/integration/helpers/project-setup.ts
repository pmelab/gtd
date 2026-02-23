import { execFileSync, execSync } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function git(dir: string, ...args: string[]) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" })
}

function writeFile(dir: string, path: string, content: string) {
  const full = join(dir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content)
}

function commit(dir: string, message: string, files?: string[]) {
  if (files) {
    for (const f of files) git(dir, "add", f)
  } else {
    git(dir, "add", "-A")
  }
  git(dir, "commit", "-q", "-m", message)
}

/** Base: git init, package.json, src/math.ts, tests/math.test.ts, npm install, initial commit, empty second commit */
export function createTestProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtd-test-"))

  git(dir, "init", "-q")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "user.email", "test@test.com")

  writeFile(
    dir,
    "package.json",
    JSON.stringify(
      {
        name: "test-project",
        type: "module",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.0.0" },
      },
      null,
      2,
    ),
  )

  writeFile(dir, "src/math.ts", "export const add = (a: number, b: number): number => a + b\n")

  writeFile(
    dir,
    "tests/math.test.ts",
    `import { expect, test } from "vitest"
import { add } from "../src/math.js"

test("add returns sum of two numbers", () => {
  expect(add(2, 3)).toBe(5)
})
`,
  )

  writeFile(dir, ".gitignore", "node_modules\n")

  execSync("npm install -q", { cwd: dir, stdio: "pipe" })

  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "initial commit")

  // Empty second commit so HEAD~1 exists (needed for getDiff fallback)
  git(dir, "commit", "--allow-empty", "-q", "-m", "chore: setup")

  return dir
}

/** 🌱 seed + 🤖 plan: commit TODO.md with seed prefix, then with plan prefix containing checkboxes */
export function setupSeededAndPlanned(dir: string) {
  writeFile(
    dir,
    "TODO.md",
    `- add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- add a test for the \`multiply\` function in \`tests/math.test.ts\`
`,
  )
  commit(dir, "🌱 seed: initial task list", ["TODO.md"])

  writeFile(
    dir,
    "TODO.md",
    `# Math library

## Action Items

### Multiply

- [ ] add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- [ ] add a test for the \`multiply\` function in \`tests/math.test.ts\`
`,
  )
  commit(dir, "🤖 plan: structured action items", ["TODO.md"])
}

/** Above + 💬 + 👷 + 🤖: commit feedback, fix, re-plan */
export function setupPlannedWithFeedback(dir: string) {
  setupSeededAndPlanned(dir)

  // 💬 feedback commit: blockquote was in TODO.md, now incorporated
  writeFile(
    dir,
    "TODO.md",
    `# Math library

## Action Items

### Multiply

- [ ] add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- [ ] add a test for the \`multiply\` function in \`tests/math.test.ts\`

> please also add error handling for non-numeric inputs
`,
  )
  commit(dir, "💬 feedback: add error handling requirement", ["TODO.md"])

  // 👷 fix commit: small formatting fix in source
  writeFile(
    dir,
    "src/math.ts",
    "export const add = (a: number, b: number): number => a + b\n\n",
  )
  commit(dir, "👷 fix: formatting", ["src/math.ts"])

  // 🤖 re-plan: restructured action items with error handling
  writeFile(
    dir,
    "TODO.md",
    `# Math library

## Action Items

### Multiply

- [ ] add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- [ ] add a test for the \`multiply\` function in \`tests/math.test.ts\`
- [ ] add input validation for non-numeric arguments in \`src/math.ts\`
`,
  )
  commit(dir, "🤖 plan: updated action items", ["TODO.md"])
}

/** Above + 🔨: commit multiply function, updated tests, checked items */
export function setupBuilt(dir: string) {
  setupPlannedWithFeedback(dir)

  writeFile(
    dir,
    "src/math.ts",
    `export const add = (a: number, b: number): number => a + b

export const multiply = (a: number, b: number): number => a * b
`,
  )

  writeFile(
    dir,
    "tests/math.test.ts",
    `import { expect, test } from "vitest"
import { add, multiply } from "../src/math.js"

test("add returns sum of two numbers", () => {
  expect(add(2, 3)).toBe(5)
})

test("multiply returns product of two numbers", () => {
  expect(multiply(3, 4)).toBe(12)
})
`,
  )

  writeFile(
    dir,
    "TODO.md",
    `# Math library

## Action Items

### Multiply

- [x] add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- [x] add a test for the \`multiply\` function in \`tests/math.test.ts\`
- [x] add input validation for non-numeric arguments in \`src/math.ts\`
`,
  )

  commit(dir, "🔨 build: implement multiply function")
}

/** Above + 🤦 + 💬 + 🤖: commit code TODO handling, new feedback, re-plan */
export function setupCodeTodosProcessed(dir: string) {
  setupBuilt(dir)

  // 🤦 human TODO commit: code TODO marker was extracted
  writeFile(
    dir,
    "src/math.ts",
    `export const add = (a: number, b: number): number => a + b

export const multiply = (a: number, b: number): number => {
  return a * b
}
`,
  )
  commit(dir, "🤦 human: extract code TODOs", ["src/math.ts"])

  // 💬 feedback commit: blockquote about subtract was incorporated
  writeFile(
    dir,
    "TODO.md",
    `# Math library

## Action Items

### Multiply

- [x] add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- [x] add a test for the \`multiply\` function in \`tests/math.test.ts\`
- [x] add input validation for non-numeric arguments in \`src/math.ts\`

> please add a subtract function too
`,
  )
  commit(dir, "💬 feedback: add subtract function", ["TODO.md"])

  // 🤖 re-plan with new package for subtract
  writeFile(
    dir,
    "TODO.md",
    `# Math library

## Action Items

### Multiply

- [x] add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- [x] add a test for the \`multiply\` function in \`tests/math.test.ts\`
- [x] add input validation for non-numeric arguments in \`src/math.ts\`

### Subtract

- [ ] add a \`subtract\` function to \`src/math.ts\` that subtracts two numbers
- [ ] add a test for the \`subtract\` function in \`tests/math.test.ts\`
`,
  )
  commit(dir, "🤖 plan: add subtract action items", ["TODO.md"])
}

/** Above + 🔨: commit subtract function, all items checked */
export function setupTwiceBuilt(dir: string) {
  setupCodeTodosProcessed(dir)

  writeFile(
    dir,
    "src/math.ts",
    `export const add = (a: number, b: number): number => a + b

export const multiply = (a: number, b: number): number => a * b

export const subtract = (a: number, b: number): number => a - b
`,
  )

  writeFile(
    dir,
    "tests/math.test.ts",
    `import { expect, test } from "vitest"
import { add, multiply, subtract } from "../src/math.js"

test("add returns sum of two numbers", () => {
  expect(add(2, 3)).toBe(5)
})

test("multiply returns product of two numbers", () => {
  expect(multiply(3, 4)).toBe(12)
})

test("subtract returns difference of two numbers", () => {
  expect(subtract(5, 3)).toBe(2)
})
`,
  )

  writeFile(
    dir,
    "TODO.md",
    `# Math library

## Action Items

### Multiply

- [x] add a \`multiply\` function to \`src/math.ts\` that multiplies two numbers
- [x] add a test for the \`multiply\` function in \`tests/math.test.ts\`
- [x] add input validation for non-numeric arguments in \`src/math.ts\`

### Subtract

- [x] add a \`subtract\` function to \`src/math.ts\` that subtracts two numbers
- [x] add a test for the \`subtract\` function in \`tests/math.test.ts\`

## Learnings

- avoid magic numbers in business logic
- always validate inputs at system boundaries
`,
  )

  commit(dir, "🔨 build: implement subtract function")
}

/** 🌱 seed only: committed TODO.md with seed prefix */
export function setupSeeded(dir: string) {
  writeFile(dir, "TODO.md", `- add a feature to the project\n`)
  commit(dir, "🌱 seed: initial task", ["TODO.md"])
}

/** config commit then 🌱 seed: .gtdrc.json committed before seed so seed is last prefix */
export function setupSeededWithConfig(dir: string, config: Record<string, unknown>) {
  writeFile(dir, ".gtdrc.json", JSON.stringify(config))
  commit(dir, "chore: add gtd config", [".gtdrc.json"])
  setupSeeded(dir)
}

/** 🌱 seed + 🧭 explore: seed then explored options committed */
export function setupSeededAndExplored(dir: string) {
  setupSeeded(dir)
  writeFile(
    dir,
    "TODO.md",
    `# Approach Options\n\n## Option A\n\nDo it the simple way.\n\n## Option B\n\nDo it the advanced way.\n`,
  )
  commit(dir, "🧭 explore: two approaches identified", ["TODO.md"])
}

/** 🌱 seed + 🧭 explore + 🤦 human edit: user annotated TODO.md after exploring */
export function setupExploredWithHumanEdits(dir: string) {
  setupSeededAndExplored(dir)
  writeFile(
    dir,
    "TODO.md",
    `# Approach Options\n\n## Option A\n\nDo it the simple way.\n\n## Option B\n\nDo it the advanced way.\n\n> I prefer Option A.\n`,
  )
  commit(dir, "🤦 human: annotated explore options", ["TODO.md"])
}

/** 🌱 seed + 🧭 explore + 💬 feedback: user gave feedback after exploring */
export function setupExploredWithFeedback(dir: string) {
  setupSeededAndExplored(dir)
  writeFile(
    dir,
    "TODO.md",
    `# Approach Options\n\n## Option A\n\nDo it the simple way.\n\n## Option B\n\nDo it the advanced way.\n\n> I prefer Option A.\n`,
  )
  commit(dir, "💬 feedback: prefer Option A", ["TODO.md"])
}

/** Above + 🎓 + 🧹: commit AGENTS.md, remove TODO.md */
export function setupFullyCompleted(dir: string) {
  setupTwiceBuilt(dir)

  writeFile(
    dir,
    "AGENTS.md",
    `## Learnings

- always validate inputs at system boundaries
`,
  )
  commit(dir, "🎓 learn: persist learnings to AGENTS.md", ["AGENTS.md"])

  git(dir, "rm", "TODO.md")
  commit(dir, "🧹 cleanup: remove TODO.md")
}
