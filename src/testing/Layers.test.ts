import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ConfigDiscovery, SEARCH_PLACES, walkUp } from "../workflow/index.js"
import { InMemRepo } from "./index.js"
import { testLayers } from "./Layers.js"

// Pins the one fact `Layers.ts`'s over-long comment used to carry: the
// in-memory `ConfigDiscovery` counterpart walks the SAME root→home chain
// and reads the SAME `SEARCH_PLACES` as `ConfigDiscovery.Live` (both tiers
// import the identical values, asserted below), but parses with a plain
// YAML/JSON reader rather than cosmiconfig's own bundled loaders — so a
// malformed-config error message is the one place the two are allowed to
// differ.

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
  f: (d: ConfigDiscovery["Type"]) => Effect.Effect<A, Error>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const discovery = yield* ConfigDiscovery
      return yield* f(discovery)
    }).pipe(Effect.provide(testLayers(repo, { root: ROOT, home: HOME }))),
  )

describe("the in-memory ConfigDiscovery counterpart", () => {
  it("combines the shared walkUp(root, home) chain with the shared SEARCH_PLACES, outermost to innermost, first match per directory wins", async () => {
    const repo = new InMemRepo()
    seed(repo, HOME, SEARCH_PLACES[0]!, "outer: true\n")
    seed(repo, MIDDLE, SEARCH_PLACES[1]!, '{"middle": true}\n')
    // Two candidates at the innermost dir — SEARCH_PLACES[0] must win over [1].
    seed(repo, ROOT, SEARCH_PLACES[0]!, "inner: true\n")
    seed(repo, ROOT, SEARCH_PLACES[1]!, '{"innerLoses": true}\n')

    const levels = await runDiscovery(repo, (d) => d.levels(ROOT, HOME))

    // Derived independently from the two shared imports, not hard-coded —
    // this is what "same chain, same SEARCH_PLACES" actually means.
    const expectedDirs = [...walkUp(ROOT, HOME)].reverse()
    expect(expectedDirs).toEqual([HOME, MIDDLE, ROOT])
    const expectedFilepaths = [
      `${HOME}/${SEARCH_PLACES[0]}`,
      `${MIDDLE}/${SEARCH_PLACES[1]}`,
      `${ROOT}/${SEARCH_PLACES[0]}`,
    ]

    expect(levels.map((l) => l.filepath)).toEqual(expectedFilepaths)
  })

  it("stops the walk at home — a config above home is never seen", async () => {
    const repo = new InMemRepo()
    seed(repo, ABOVE_HOME, SEARCH_PLACES[0]!, "should-never-be-read: true\n")
    seed(repo, HOME, SEARCH_PLACES[0]!, "home: true\n")

    const levels = await runDiscovery(repo, (d) => d.levels(ROOT, HOME))

    expect(levels.map((l) => l.filepath)).toEqual([`${HOME}/${SEARCH_PLACES[0]}`])
  })

  it("rejects a bare YAML/JSON null with the in-memory tier's own error text — cosmiconfig's own loaders differ on purpose, so this is NOT asserted to match ConfigDiscovery.Live", async () => {
    const repo = new InMemRepo()
    seed(repo, ROOT, SEARCH_PLACES[0]!, "null\n")

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const discovery = yield* ConfigDiscovery
        return yield* Effect.flip(discovery.levels(ROOT, HOME))
      }).pipe(Effect.provide(testLayers(repo, { root: ROOT, home: HOME }))),
    )

    expect(failure.message).toBe(
      `${ROOT}/${SEARCH_PLACES[0]}: config must be a plain object, got null`,
    )
  })
})
