import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ConfigDiscovery, LEGACY_RC_FILES, walkUp } from "../workflow/index.js"
import { InMemRepo } from "./index.js"
import { ambientFlagEnv, inMemPath, testLayers } from "./Layers.js"
import { Host } from "../platform/index.js"

// The in-memory `ConfigDiscovery` counterpart walks the SAME root→home chain
// and looks for the SAME `LEGACY_RC_FILES` as `ConfigDiscovery.Live` — both
// imported from it, never copied.

const ROOT = "/home/user/project/sub"
const MIDDLE = "/home/user/project"
const HOME = "/home/user"
const ABOVE_HOME = "/home"

/** Writes `content` at `dir/name`, using a repo-relative key inside `ROOT` and an absolute literal key outside it — matching `makeInMemoryWorkspaceOps.atPath`'s own root-relative/ancestor split. */
const seed = (repo: InMemRepo, dir: string, name: string, content: string): void => {
  const filepath = `${dir}/${name}`
  const key = filepath.startsWith(`${ROOT}/`) ? filepath.slice(ROOT.length + 1) : filepath
  repo.writeFile(key, content)
}

const runDiscovery = <A>(
  repo: InMemRepo,
  f: (d: ConfigDiscovery["Service"]) => Effect.Effect<A, Error>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const discovery = yield* ConfigDiscovery
      return yield* f(discovery)
    }).pipe(Effect.provide(testLayers(repo, { root: ROOT, home: HOME }))),
  )

describe("the in-memory ConfigDiscovery counterpart", () => {
  it("finds every leftover rc file on the shared walk, innermost first", async () => {
    const repo = new InMemRepo()
    seed(repo, HOME, LEGACY_RC_FILES[1]!, "{}\n")
    seed(repo, ROOT, LEGACY_RC_FILES[0]!, "vars: {}\n")
    seed(repo, ROOT, LEGACY_RC_FILES[1]!, "{}\n")
    seed(repo, ABOVE_HOME, LEGACY_RC_FILES[0]!, "never-walked: true\n")
    const found = (await runDiscovery(repo, (d) => d.legacyRcFiles(ROOT, HOME))).map((f) => f.path)
    expect(walkUp(inMemPath, ROOT, HOME)).toEqual([ROOT, MIDDLE, HOME])
    expect(found).toEqual([
      `${ROOT}/${LEGACY_RC_FILES[0]}`,
      `${ROOT}/${LEGACY_RC_FILES[1]}`,
      `${HOME}/${LEGACY_RC_FILES[1]}`,
    ])
  })

  it("also searches home when the walk never reaches it", async () => {
    const repo = new InMemRepo()
    seed(repo, HOME, LEGACY_RC_FILES[1]!, "{}\n")
    const found = (
      await runDiscovery(repo, (d) => d.legacyRcFiles("/elsewhere/project", HOME))
    ).map((f) => f.path)
    expect(found).toEqual([`${HOME}/${LEGACY_RC_FILES[1]}`])
  })
})

describe("ambient GTD_FLAG_* reaches the in-memory Host", () => {
  const hostEnv = (ambient: Record<string, string>, env?: Record<string, string>) => {
    const before = { ...process.env }
    Object.assign(process.env, ambient)
    return Effect.runPromise(
      Effect.map(Host, (h) => h.env).pipe(
        Effect.provide(testLayers(new InMemRepo(), env ? { env } : {})),
        Effect.ensuring(
          Effect.sync(() => {
            for (const k of Object.keys(ambient)) {
              if (before[k] === undefined) delete process.env[k]
              else process.env[k] = before[k]
            }
          }),
        ),
      ),
    )
  }

  it("carries the ambient flag, and explicit env wins", async () => {
    expect((await hostEnv({ GTD_FLAG_ALPHA: "1" }))["GTD_FLAG_ALPHA"]).toBe("1")
    const env = await hostEnv({ GTD_FLAG_ALPHA: "1" }, { GTD_FLAG_ALPHA: "0" })
    expect(env["GTD_FLAG_ALPHA"]).toBe("0")
  })

  it("picks only GTD_FLAG_* keys", () => {
    expect(ambientFlagEnv({ GTD_FLAG_X: "1", PATH: "/bin", GTD_FLAG_U: undefined })).toEqual({
      GTD_FLAG_X: "1",
    })
  })
})
