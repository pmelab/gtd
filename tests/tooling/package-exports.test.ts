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
    expect(config.workflowNames).toEqual(["feature", "fix", "review"])
  })
})
