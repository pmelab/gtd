import { Effect, Layer, Path } from "effect"
import { describe, expect, it } from "vitest"
import { NodeServices } from "../platform/index.js"
import { InMemRepo, testLayers } from "./index.js"

// The core reaches paths through `Path`: Node's live, Effect's own POSIX one in memory.
describe.each([
  ["live", NodeServices.layer as Layer.Layer<Path.Path>],
  ["in memory", testLayers(new InMemRepo())],
])("Path (%s)", (_, layer) => {
  const run = <A>(f: (path: Path.Path) => A | Effect.Effect<A, unknown>): Promise<A> =>
    Effect.runPromise(
      Effect.flatMap(Path.Path, (path) => {
        const result = f(path)
        return Effect.isEffect(result) ? result : Effect.succeed(result)
      }).pipe(Effect.provide(layer)),
    )

  it("joins, splits and relates paths", async () => {
    expect(
      await run((path) => [
        path.sep,
        path.join("/repo", ".gtd", "../gtd.config.ts"),
        path.dirname("/repo/.gtd/TODO.md"),
        path.dirname("/"),
        path.resolve("/repo", "lib/flow.ts"),
        path.resolve("/repo", "/elsewhere"),
        path.relative("/repo", "/repo/lib/flow.ts"),
        path.relative("/repo", "/home/.gtdrc"),
        path.isAbsolute("/repo"),
        path.isAbsolute("lib/flow.ts"),
      ]),
    ).toEqual([
      "/",
      "/repo/gtd.config.ts",
      "/repo/.gtd",
      "/",
      "/repo/lib/flow.ts",
      "/elsewhere",
      "lib/flow.ts",
      "../home/.gtdrc",
      true,
      false,
    ])
  })

  it("converts a path to a file URL and back", async () => {
    const url = await run((path) => path.toFileUrl("/repo/a b.ts"))
    expect(url.href).toBe("file:///repo/a%20b.ts")
    expect(await run((path) => path.fromFileUrl(url))).toBe("/repo/a b.ts")
  })
})
