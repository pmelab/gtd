import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import { ConfigService } from "./Config.js"

const run = <A>(eff: Effect.Effect<A, Error, ConfigService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(ConfigService.Live)))

const runExit = <A>(eff: Effect.Effect<A, Error, ConfigService>) =>
  Effect.runPromiseExit(eff.pipe(Effect.provide(ConfigService.Live)))

let projectDir: string
let originalCwd: string

beforeEach(() => {
  originalCwd = process.cwd()
  projectDir = mkdtempSync(join(tmpdir(), "gtd-config-"))
  process.chdir(projectDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(projectDir, { recursive: true, force: true })
})

describe("ConfigService", () => {
  it("with no config anywhere: testCommand defaults to `npm run test` and resolveModel returns built-in tier defaults", async () => {
    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.testCommand).toBe("npm run test")
    expect(cfg.resolveModel("decompose")).toBe("claude-opus-4-8")
    expect(cfg.resolveModel("grilling")).toBe("claude-opus-4-8")
    expect(cfg.resolveModel("building")).toBe("claude-sonnet-4-8")
    expect(cfg.resolveModel("fixing")).toBe("claude-sonnet-4-8")
  })

  it("reads testCommand from a single .gtdrc.yaml in cwd", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `testCommand: "pnpm test"\n`)

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.testCommand).toBe("pnpm test")
  })

  it("merges levels low->high: cwd wins on overlap, non-overlapping ancestor keys still appear", async () => {
    // Build a chain entirely under tmpdir so the root-stop path is exercised
    // and the user's home dir is never reached.
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })

    // Ancestor (projectDir): sets testCommand AND a planning model.
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      `testCommand: "ancestor test"\nmodels:\n  planning: "ancestor-planner"\n`,
    )
    // Innermost (child = cwd): overrides testCommand, leaves planning untouched.
    writeFileSync(join(child, ".gtdrc.yaml"), `testCommand: "child test"\n`)

    process.chdir(child)

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.testCommand).toBe("child test") // cwd wins
    expect(cfg.resolveModel("decompose")).toBe("ancestor-planner") // ancestor key survives
  })

  it("resolveModel precedence: states beats tier, tier beats built-in, built-in when nothing set", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `models:`,
        `  planning: "tier-planner"`,
        `  execution: "tier-executor"`,
        `  states:`,
        `    decompose: "state-decompose"`,
        ``,
      ].join("\n"),
    )

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    // (1) states wins
    expect(cfg.resolveModel("decompose")).toBe("state-decompose")
    // (2) tier when no state override
    expect(cfg.resolveModel("grilling")).toBe("tier-planner")
    expect(cfg.resolveModel("building")).toBe("tier-executor")
  })

  it("fails to decode with a readable error on unknown models.states key", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`models:`, `  states:`, `    fix-tests: "nope"`, ``].join("\n"),
    )

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const msg = String(exit.cause)
      expect(msg).toMatch(/fix-tests|states/i)
    }
  })

  it("loads JSON config (gtd.config.json)", async () => {
    writeFileSync(join(projectDir, "gtd.config.json"), JSON.stringify({ testCommand: "json test" }))

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.testCommand).toBe("json test")
  })


  it("agenticReview defaults to true with no config", async () => {
    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.agenticReview).toBe(true)
  })

  it("agenticReview is overridable", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `agenticReview: false\n`)

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.agenticReview).toBe(false)
  })

  it("rejects the removed agenticReviewMaxCycles key as an excess property", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `agenticReviewMaxCycles: 5\n`)

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("a .gtdrc with agenticReview: false decodes without excess-property error", async () => {
    writeFileSync(join(projectDir, ".gtdrc"), `agenticReview: false\n`)

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agenticReview).toBe(false)
    }
  })

  it("fixAttemptCap defaults to 3 with no config", async () => {
    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.fixAttemptCap).toBe(3)
  })

  it("fixAttemptCap is overridable via config", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `fixAttemptCap: 5\n`)

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.fixAttemptCap).toBe(5)
  })

  it("reviewThreshold defaults to 3 with no config", async () => {
    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.reviewThreshold).toBe(3)
  })

  it("reviewThreshold is overridable via config", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `reviewThreshold: 7\n`)

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.reviewThreshold).toBe(7)
  })

  it("resolveModel returns planning default for grilling, agentic-review, clean with no config", async () => {
    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.resolveModel("grilling")).toBe("claude-opus-4-8")
    expect(cfg.resolveModel("agentic-review")).toBe("claude-opus-4-8")
    expect(cfg.resolveModel("clean")).toBe("claude-opus-4-8")
  })

  it("resolveModel returns execution default for building and fixing with no config", async () => {
    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.resolveModel("building")).toBe("claude-sonnet-4-8")
    expect(cfg.resolveModel("fixing")).toBe("claude-sonnet-4-8")
  })

  it("models.planning override applies to grilling, agentic-review, clean", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`models:`, `  planning: "tier-planner"`, ``].join("\n"),
    )

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.resolveModel("grilling")).toBe("tier-planner")
    expect(cfg.resolveModel("agentic-review")).toBe("tier-planner")
    expect(cfg.resolveModel("clean")).toBe("tier-planner")
  })

  it("models.execution override applies to building and fixing", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`models:`, `  execution: "tier-executor"`, ``].join("\n"),
    )

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.resolveModel("building")).toBe("tier-executor")
    expect(cfg.resolveModel("fixing")).toBe("tier-executor")
  })

  it("models.states per-state overrides for new states beat tier", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `models:`,
        `  planning: "tier-planner"`,
        `  execution: "tier-executor"`,
        `  states:`,
        `    grilling: "state-griller"`,
        `    building: "state-builder"`,
        `    fixing: "state-fixer"`,
        `    agentic-review: "state-reviewer"`,
        `    clean: "state-cleaner"`,
        ``,
      ].join("\n"),
    )

    const cfg = await run(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(cfg.resolveModel("grilling")).toBe("state-griller")
    expect(cfg.resolveModel("building")).toBe("state-builder")
    expect(cfg.resolveModel("fixing")).toBe("state-fixer")
    expect(cfg.resolveModel("agentic-review")).toBe("state-reviewer")
    expect(cfg.resolveModel("clean")).toBe("state-cleaner")
  })

  it("new model state keys decode without excess-property error", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `models:`,
        `  states:`,
        `    grilling: "g"`,
        `    building: "b"`,
        `    fixing: "f"`,
        `    agentic-review: "ar"`,
        `    clean: "cl"`,
        ``,
      ].join("\n"),
    )

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
