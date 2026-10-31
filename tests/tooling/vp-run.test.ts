import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import viteConfig from "../../vite.config.ts"
import { TASKS, VITEST_TASKS } from "../../scripts/test-states.ts"

type Task = {
  command: string
  dependsOn?: string[]
  cache?: false | { env?: string[]; input?: unknown[]; output?: unknown[] }
}

const tasks = viteConfig.run!.tasks as Record<string, Task>
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
const tsconfig = JSON.parse(readFileSync(new URL("../../tsconfig.json", import.meta.url), "utf8"))

describe("vite.config.ts run tasks", () => {
  it("runs the test script through the flag-state runner, whose aggregates name exactly its task sets", () => {
    expect(pkg.scripts.test).toBe("jiti scripts/test-states.main.ts")
    expect(tasks["gate"]!.dependsOn).toEqual([...TASKS])
    expect(tasks["gate:tests"]!.dependsOn).toEqual([...VITEST_TASKS])
    for (const key of TASKS) expect(tasks, `missing vp task "${key}"`).toHaveProperty(key)
  })

  it("fingerprints GTD_FLAG_* on each VITEST_TASKS entry and on no other task", () => {
    for (const [key, task] of Object.entries(tasks)) {
      const declared = task.cache !== false && (task.cache?.env ?? []).includes("GTD_FLAG_*")
      expect(declared, `task "${key}" GTD_FLAG_* env`).toBe(
        (VITEST_TASKS as readonly string[]).includes(key),
      )
    }
  })

  it("builds before every test task that loads the bundle", () => {
    for (const key of VITEST_TASKS.filter((t) => t !== "test:web")) {
      expect(tasks[key]!.dependsOn, key).toContain("build")
    }
  })

  // vite-plus#2635: with output left to auto-tracking, a cache hit can drop files yet exit 0.
  it("declares build's outputs explicitly", () => {
    const cache = tasks["build"]!.cache
    expect(cache && cache.output).toEqual(["dist/**", "src/ui/client.generated.html"])
  })

  // Auto-tracking replaces hand-kept input globs; build's outputs must not become inputs.
  it("auto-tracks every cached task's inputs, excluding build's outputs", () => {
    for (const [key, task] of Object.entries(tasks)) {
      if (task.cache === false) continue
      expect(task.cache?.input, key).toEqual([
        { auto: true },
        "!dist/**",
        "!src/ui/client.generated.html",
      ])
    }
  })

  it("typechecks scripts/", () => {
    expect(tsconfig.include).toContain("scripts")
  })

  it("keeps browser-only web-client packages out of dependencies — only @trpc/server ships at runtime", () => {
    // They are inlined into src/ui/client.generated.html at build time.
    for (const name of [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "@trpc/client",
      "@trpc/react-query",
      "tailwind-merge",
      "zustand",
    ]) {
      expect(pkg.dependencies, `"${name}" must not be a runtime dependency`).not.toHaveProperty(
        name,
      )
      expect(pkg.devDependencies, `"${name}" must be a devDependency`).toHaveProperty(name)
    }
    expect(pkg.dependencies).toHaveProperty("@trpc/server")
  })
})
