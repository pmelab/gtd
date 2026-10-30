import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { isBuiltin } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Exit } from "effect"
import { parseAst } from "rolldown/parseAst"
import { afterEach, describe, expect, it } from "vitest"
import { PIN_KEY } from "../install/index.js"
import { InMemRepo, testLayers } from "../twins/index.js"
import { ConfigDiscovery, ConfigService } from "./index.js"
import { EngineCore, pin, readPin } from "./pin.js"

afterEach(() => {
  delete (globalThis as { [PIN_KEY]?: unknown })[PIN_KEY]
})

// A pin must run with nothing installed: the engine imports Node and nothing else.
describe.each([
  ["live", EngineCore.Live],
  ["in memory", testLayers(new InMemRepo())],
])("EngineCore (%s)", (_, layer) => {
  const source = () =>
    Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EngineCore, (e) => e.source),
        layer,
      ),
    )

  it("serves an ES module importing only Node's builtins", async () => {
    const imported = parseAst(await source()).body.flatMap((node) =>
      "source" in node && node.source !== null && node.source !== undefined
        ? [String(node.source.value)]
        : [],
    )
    expect(imported.filter((id) => !isBuiltin(id))).toEqual([])
  })
})

describe("EngineCore.layer", () => {
  it("names the engine it cannot find", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        Effect.flatMap(EngineCore, (e) => e.source),
        EngineCore.layer(() => "/nowhere/gtd.core.mjs"),
      ),
    )
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
      "no engine at /nowhere/gtd.core.mjs",
    )
  })
})

const CONFIG = `import { human } from "@pmelab/gtd/flows"
import { message } from "./lib/message.js"

export default async () => {
  await human("idle", { message })
}
`

const pinFrom = (repo: InMemRepo) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const module = yield* (yield* ConfigDiscovery).workflowModule("/repo", "/repo")
      return yield* pin(module!, "/repo", "1.2.3")
    }).pipe(Effect.provide(testLayers(repo))),
  )

describe("pin", () => {
  it("leads with a plain header, then the workflow and the engine gzipped", async () => {
    const repo = new InMemRepo()
    repo.writeFile("gtd.config.ts", CONFIG)
    repo.writeFile("lib/message.ts", `export const message = "pinned message"\n`)
    const bytes = await pinFrom(repo)

    expect(Buffer.from(bytes).toString("latin1").split("\n")[0]).toBe("gtdpin 1 gtd 1.2.3")
    const { format, version, source } = readPin(bytes)
    expect({ format, version }).toEqual({ format: 1, version: "1.2.3" })
    expect(source).toContain("pinned message")
    expect(source.endsWith('import "node:process"\n')).toBe(true)
  })

  it("registers a workflow load runs without any config", async () => {
    const repo = new InMemRepo()
    repo.writeFile("gtd.config.ts", CONFIG)
    repo.writeFile("lib/message.ts", `export const message = "pinned message"\n`)
    const { source } = readPin(await pinFrom(repo))
    repo.writeFile("gtd.config.ts", "")
    repo.seedCommit("chore: init")

    await import(`data:text/javascript,${encodeURIComponent(source)}`)
    const config = await Effect.runPromise(
      Effect.flatMap(ConfigService, (c) => c.load).pipe(Effect.provide(testLayers(repo))),
    )
    expect(config.defaultWorkflow.def.initial).toBe("idle")
    expect(Object.keys(config.fingerprint).sort()).toEqual(["gtd.config.ts", "lib/message.ts"])
  })

  describe("from disk", () => {
    let dir: string
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    const pinDir = (config: string) => {
      writeFileSync(join(dir, "gtd.config.ts"), config)
      return Effect.runPromiseExit(
        pin(
          {
            filepath: join(dir, "gtd.config.ts"),
            source: readFileSync(join(dir, "gtd.config.ts"), "utf8"),
          },
          dir,
          "1.2.3",
        ).pipe(Effect.provide(testLayers(new InMemRepo()))),
      )
    }

    const pkg = (name: string, files: Record<string, string>) => {
      const root = join(dir, "node_modules", name)
      for (const [file, content] of Object.entries({
        "package.json": JSON.stringify({ name, main: "index.js" }),
        ...files,
      })) {
        mkdirSync(join(root, file, ".."), { recursive: true })
        writeFileSync(join(root, file), content)
      }
    }

    it("carries a CommonJS package", async () => {
      dir = mkdtempSync(join(tmpdir(), "gtd-pin-"))
      pkg("shout", { "index.js": "module.exports = (s) => s.toUpperCase() + '!pinned-cjs'" })
      const exit = await pinDir(
        `import shout from "shout"\nexport default async () => shout("x")\n`,
      )
      expect(Exit.isSuccess(exit) && readPin(exit.value).source).toContain("!pinned-cjs")
    })

    it("refuses a package node-gyp builds, naming it", async () => {
      dir = mkdtempSync(join(tmpdir(), "gtd-pin-"))
      pkg("sqlish", { "index.js": "module.exports = {}", "binding.gyp": "{}" })
      const exit = await pinDir(`import "sqlish"\nexport default async () => {}\n`)
      expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
        'package "sqlish" loads a native addon',
      )
    })

    it("refuses a native addon, naming its package", async () => {
      dir = mkdtempSync(join(tmpdir(), "gtd-pin-"))
      pkg("@scope/native", {
        "index.js": 'module.exports = require("./build/addon.node")',
        "build/addon.node": "",
      })
      const exit = await pinDir(`import "@scope/native"\nexport default async () => {}\n`)
      expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
        'package "@scope/native" loads a native addon',
      )
    })
  })
})
