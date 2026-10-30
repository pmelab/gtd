import { Context, Effect, Layer, Path } from "effect"
import { GtdError, NodeRuntime, nodeSyncIo } from "../platform/index.js"
import { ownPackage, pinnedWorkflowSource } from "./load.js"
import type { WorkflowModule } from "./discovery.js"

/** Bumped when a launcher could no longer run an older pin the same way. */
export const PIN_FORMAT = 1

/**
 * The engine a pin carries, as ES module source. Live, the `gtd.core.mjs` the
 * running gtd ships beside its own bundle.
 */
export class EngineCore extends Context.Service<
  EngineCore,
  { readonly source: Effect.Effect<string, Error> }
>()("EngineCore") {
  static layer = (path: () => string): Layer.Layer<EngineCore> =>
    Layer.succeed(EngineCore, {
      source: Effect.suspend(() => {
        const file = path()
        return Effect.try({
          try: () => {
            const source = nodeSyncIo.readText(file)
            if (source === undefined) throw new Error("absent")
            return source
          },
          catch: () => new GtdError(`gtd bundle: no engine at ${file} — build gtd first`),
        })
      }),
    })
  static Live = Layer.unwrap(
    Effect.map(Path.Path, (path) =>
      EngineCore.layer(() => path.join(ownPackage(path).root, "dist", "gtd.core.mjs")),
    ),
  )
}

/**
 * A pin: one plain-text header line a launcher reads without unpacking, then
 * the gzipped ES module — the workflow registering itself, then the engine.
 * Gzipped, git sees binary and diffs no source.
 */
export const pin = (
  module: WorkflowModule,
  root: string,
  version: string,
): Effect.Effect<Uint8Array, Error, EngineCore | Path.Path> =>
  Effect.gen(function* () {
    const core = yield* (yield* EngineCore).source
    const path = yield* Path.Path
    const workflow = yield* Effect.tryPromise({
      try: () => pinnedWorkflowSource(path, module, root, version),
      catch: (e) =>
        new GtdError(
          `gtd bundle: ${module.filepath}: ${e instanceof Error ? e.message : String(e)}`,
        ),
    })
    // The registration runs first; a shebang is only valid on a file's first line.
    const source = workflow + core.replace(/^#!.*\n/, "")
    return Buffer.concat([
      Buffer.from(`gtdpin ${PIN_FORMAT} gtd ${version}\n`),
      NodeRuntime.gzip(source),
    ])
  })

/** A pin's header line, read without unpacking it; undefined when the bytes are no pin. */
export const pinHeader = (
  bytes: Uint8Array,
): { readonly format: number; readonly version: string } | undefined => {
  const end = bytes.indexOf(0x0a)
  const header =
    end < 0 ? null : /^gtdpin (\d+) gtd (\S+)$/.exec(Buffer.from(bytes.subarray(0, end)).toString())
  return header === null ? undefined : { format: Number(header[1]), version: header[2]! }
}

/** A pin's header and module source. */
export const readPin = (
  bytes: Uint8Array,
): { readonly format: number; readonly version: string; readonly source: string } => {
  const header = pinHeader(bytes)
  if (header === undefined) throw new Error("not a gtd pin")
  return {
    ...header,
    source: NodeRuntime.gunzip(bytes.subarray(bytes.indexOf(0x0a) + 1)),
  }
}
