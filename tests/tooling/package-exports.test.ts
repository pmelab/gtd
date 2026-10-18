import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import tsdownConfigs from "../../tsdown.config.js"
import { GitService, Host, Narrator, Workspace } from "../../src/platform/index.js"
import { ConfigDiscovery, ConfigService, LEGACY_RC_FILES } from "../../src/workflow/index.js"

const root = new URL("../../", import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  readonly exports: Readonly<Record<string, string | Readonly<Record<string, string>>>>
}

// Every `./dist/<name>.mjs` some tsdown config writes.
const built = new Set(
  (Array.isArray(tsdownConfigs) ? tsdownConfigs : [tsdownConfigs]).flatMap((config) =>
    Object.keys(config.entry as Record<string, string>).map(
      (name) => `./${config.outDir}/${name}.mjs`,
    ),
  ),
)

describe("package.json exports", () => {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === "string") continue
    it(`${subpath} serves a build tsdown writes, and its source for types and tests`, () => {
      expect(built).toContain(target.default)
      expect(target.types).toBe(target.source)
      expect(existsSync(join(root, target.source!))).toBe(true)
    })
  }
})

describe("the entrypoint docs", () => {
  for (const file of ["README.md", "COMPATIBILITY.md"]) {
    it(`${file} names every subpath`, () => {
      const doc = readFileSync(join(root, file), "utf8")
      for (const subpath of Object.keys(pkg.exports)) {
        expect(doc).toContain(`\`@pmelab/gtd/${subpath.replace(/^\.\//, "")}\``)
      }
    })
  }
})

describe("rollout and cleanup", () => {
  const factories = {
    "./workflows": ["rollout", "cleanup"],
    "./workflows/rollout": ["default", "rollout"],
    "./workflows/cleanup": ["default", "cleanup"],
  } as const
  for (const [subpath, names] of Object.entries(factories)) {
    it(`${subpath} exports ${names.join(" and ")} as functions`, async () => {
      const target = pkg.exports[subpath as keyof typeof pkg.exports] as { source: string }
      const mod = (await import(join(root, target.source))) as Record<string, unknown>
      for (const name of names) expect(typeof mod[name]).toBe("function")
    })
  }
})

describe("this repository's config", () => {
  it("is gtd.config.ts alone — no removed rc file", () => {
    for (const name of LEGACY_RC_FILES) expect(existsSync(join(root, name))).toBe(false)
  })

  it("loads, running the shipped workflows", async () => {
    // `home` at the root ends the walk there: nothing above this checkout counts.
    const host = Host.layer({ root, home: root, env: {} })
    const git = GitService.Live.pipe(Layer.provide(Layer.merge(host, NodeContext.layer)))
    const config = await Effect.runPromise(
      Effect.flatMap(ConfigService, (c) => c.load).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigService.Live,
            ConfigDiscovery.Live,
            host,
            git,
            Workspace.Live.pipe(Layer.provide(Layer.merge(host, git))),
            Narrator.layer(() => {}, false),
          ),
        ),
      ),
    )
    expect(config.defaultWorkflow.name).toBe("feature")
    // A workflow exported in another shape is missed here and reds the diff.
    const declared = [
      ...readFileSync(join(root, "gtd.config.ts"), "utf8").matchAll(
        /^export const (\w+) = \w+\(/gm,
      ),
    ]
      .map((m) => m[1] as string)
      .sort()
    expect(declared.length).toBeGreaterThan(0)
    expect([...config.workflowNames].sort()).toEqual(declared)
    for (const name of declared) expect(config.workflowNamed(name)?.def.initial).toBeDefined()
  })
})
