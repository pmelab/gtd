import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { GitService, Host, Narrator, Workspace } from "../platform/index.js"
import { InMemRepo, testLayers } from "../testkit/index.js"
import { ConfigDiscovery, ConfigService } from "./index.js"

// A config and the local modules it imports load the same from disk, where
// jiti resolves them, and from an in-memory discovery, where the loader
// resolves them itself — the same workflows, the same fingerprint, the same
// failure for a module that is not there.
type Files = Readonly<Record<string, string>>

interface Tier {
  readonly load: (files: Files) => Promise<{ names: readonly string[]; fingerprint: object }>
  readonly dispose: () => void
}

const config = (imports: string): string =>
  [
    'import { agent, human } from "@pmelab/gtd/flows"',
    imports,
    "export default async () => {",
    '  await human("idle", { message: "go" })',
    '  await agent("working", brief)',
    "}",
    "export const named = async () => {",
    '  await agent("working", brief)',
    "}",
    "",
  ].join("\n")

const loadWith = (
  layer: Layer.Layer<ConfigService | Narrator | Workspace | Host | ConfigDiscovery>,
) =>
  Effect.runPromise(
    Effect.flatMap(ConfigService, (service) => service.load).pipe(
      Effect.map((loaded) => ({ names: loaded.workflowNames, fingerprint: loaded.fingerprint })),
      Effect.provide(layer),
    ),
  )

const live = (): Tier => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-discovery-")))
  execSync("git init -q && git commit -q --allow-empty -m init", {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  })
  return {
    load: (files) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
      }
      const host = Host.layer({ root, home: root, env: {} })
      const git = GitService.Live.pipe(Layer.provide(Layer.merge(host, NodeContext.layer)))
      const workspace = Workspace.Live.pipe(Layer.provide(Layer.merge(host, git)))
      return loadWith(
        Layer.mergeAll(
          ConfigService.Live,
          ConfigDiscovery.Live,
          host,
          workspace,
          Narrator.layer(() => {}, false),
        ),
      )
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

const inMemory = (): Tier => ({
  load: (files) => {
    const repo = new InMemRepo()
    for (const [path, content] of Object.entries(files)) repo.writeFile(path, content)
    repo.seedCommit("chore: init")
    return loadWith(testLayers(repo))
  },
  dispose: () => {},
})

for (const make of [live, inMemory]) {
  describe(`a config's local modules [${make.name}]`, () => {
    let t: Tier
    afterEach(() => t.dispose())

    it("loads an import by its .js spelling, and one it imports in turn", async () => {
      t = make()
      const loaded = await t.load({
        "gtd.config.ts": config('import { brief } from "./lib/brief.js"'),
        "lib/brief.ts": 'import { word } from "./word"\nexport const brief = `do ${word}`\n',
        "lib/word.ts": 'export const word = "it"\n',
      })
      expect(loaded.names).toEqual(["named"])
      expect(Object.keys(loaded.fingerprint).sort()).toEqual([
        "gtd.config.ts",
        "lib/brief.ts",
        "lib/word.ts",
      ])
    })

    it("hashes each file's content the same way", async () => {
      t = make()
      const loaded = await t.load({
        "gtd.config.ts": config('import { brief } from "./brief.js"'),
        "brief.ts": 'export const brief = "do the work"\n',
      })
      expect(loaded.fingerprint).toEqual({
        "brief.ts": "c59960854e8032b7",
        "gtd.config.ts": expect.stringMatching(/^[0-9a-f]{16}$/),
      })
    })

    it("leaves a specifier in a string alone, and loads a skipped require never", async () => {
      t = make()
      const loaded = await t.load({
        "gtd.config.ts": config(
          [
            "const brief = \"look from './word.js'\"",
            'if (brief === "") require("./optional.js")',
          ].join("\n"),
        ),
        "word.ts": "export const word = 1\n",
        "optional.ts": 'throw new Error("optional ran")\n',
      })
      expect(loaded.names).toEqual(["named"])
      expect(Object.keys(loaded.fingerprint)).toEqual(["gtd.config.ts"])
    })

    it("fails on an import that is not there, naming it", async () => {
      t = make()
      await expect(
        t.load({ "gtd.config.ts": config('import { brief } from "./missing.js"') }),
      ).rejects.toThrow(/Cannot find module '\.\/missing\.js'/)
    })
  })
}
