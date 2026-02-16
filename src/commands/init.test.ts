import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initAction } from "./init.js"
import { SCHEMA_URL } from "../services/ConfigResolver.js"
import { Command } from "@effect/cli"

describe("initAction", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gtd-init-test-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("creates .gtdrc.json with $schema in cwd", async () => {
    const logs: string[] = []
    await Effect.runPromise(
      initAction({ cwd: tempDir, global: false, log: (msg) => logs.push(msg) }),
    )

    const content = await readFile(join(tempDir, ".gtdrc.json"), "utf-8")
    const parsed = JSON.parse(content)
    expect(parsed.$schema).toBe(SCHEMA_URL)
    expect(logs.some((l) => l.includes("Created example config"))).toBe(true)
  })

  it("skips when config already exists", async () => {
    await writeFile(join(tempDir, ".gtdrc.json"), "{}", "utf-8")

    const logs: string[] = []
    await Effect.runPromise(
      initAction({ cwd: tempDir, global: false, log: (msg) => logs.push(msg) }),
    )

    const content = await readFile(join(tempDir, ".gtdrc.json"), "utf-8")
    expect(content).toBe("{}")
    expect(logs.some((l) => l.includes("already exists"))).toBe(true)
  })

  it("--global creates config in XDG config dir", async () => {
    const xdgHome = join(tempDir, "xdg-config")

    const logs: string[] = []
    await Effect.runPromise(
      initAction({
        cwd: tempDir,
        global: true,
        log: (msg) => logs.push(msg),
        xdgConfigHome: xdgHome,
      }),
    )

    const content = await readFile(join(xdgHome, "gtd", ".gtdrc.json"), "utf-8")
    const parsed = JSON.parse(content)
    expect(parsed.$schema).toBe(SCHEMA_URL)
  })

  it("--global creates directory when missing", async () => {
    const xdgHome = join(tempDir, "nonexistent", "config")

    await Effect.runPromise(
      initAction({
        cwd: tempDir,
        global: true,
        log: () => {},
        xdgConfigHome: xdgHome,
      }),
    )

    const content = await readFile(join(xdgHome, "gtd", ".gtdrc.json"), "utf-8")
    expect(JSON.parse(content).$schema).toBe(SCHEMA_URL)
  })

  it("--global respects XDG_CONFIG_HOME env var", async () => {
    const customXdg = join(tempDir, "custom-xdg")

    const logs: string[] = []
    await Effect.runPromise(
      initAction({
        cwd: tempDir,
        global: true,
        log: (msg) => logs.push(msg),
        xdgConfigHome: customXdg,
      }),
    )

    const content = await readFile(join(customXdg, "gtd", ".gtdrc.json"), "utf-8")
    expect(JSON.parse(content).$schema).toBe(SCHEMA_URL)
  })

  it("--global skips when global config already exists", async () => {
    const xdgHome = join(tempDir, "xdg-config")
    const gtdDir = join(xdgHome, "gtd")
    await mkdir(gtdDir, { recursive: true })
    await writeFile(join(gtdDir, ".gtdrc.json"), "{}", "utf-8")

    const logs: string[] = []
    await Effect.runPromise(
      initAction({
        cwd: tempDir,
        global: true,
        log: (msg) => logs.push(msg),
        xdgConfigHome: xdgHome,
      }),
    )

    const content = await readFile(join(gtdDir, ".gtdrc.json"), "utf-8")
    expect(content).toBe("{}")
    expect(logs.some((l) => l.includes("already exists"))).toBe(true)
  })
})
