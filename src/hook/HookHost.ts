import { appendFileSync, readFileSync } from "node:fs"
import { Context, Effect, Layer } from "effect"

/** What `gtd context-hook` reads and writes outside the repository: its env, the transcript, the stop record. */
export class HookHost extends Context.Tag("HookHost")<
  HookHost,
  {
    readonly env: Readonly<Record<string, string | undefined>>
    /** `undefined` for a missing file; any other read failure fails. */
    readonly readFile: (path: string) => Effect.Effect<string | undefined, Error>
    readonly appendFile: (path: string, text: string) => Effect.Effect<void>
  }
>() {}

export const liveHookHost: Layer.Layer<HookHost> = Layer.succeed(HookHost, {
  env: process.env,
  readFile: (path) =>
    Effect.try({
      try: () => {
        try {
          return readFileSync(path, "utf-8")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
          throw error
        }
      },
      catch: (error) => new Error(`could not read ${path}: ${String(error)}`),
    }),
  appendFile: (path, text) => Effect.sync(() => appendFileSync(path, text)),
})
