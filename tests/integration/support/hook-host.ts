import { Effect, Layer } from "effect"
import { HookHost } from "../../../src/hook/index.js"

/** The hook's host in memory: files outside the repository from `files`, by absolute path; appends land there too. */
export const inMemoryHookHost = (
  files: Map<string, string>,
  env: Readonly<Record<string, string | undefined>> = {},
): Layer.Layer<HookHost> =>
  Layer.succeed(HookHost, {
    env,
    readFile: (path) => Effect.succeed(files.get(path)),
    appendFile: (path, text) =>
      Effect.sync(() => void files.set(path, (files.get(path) ?? "") + text)),
  })
