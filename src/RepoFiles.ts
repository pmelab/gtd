import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Cwd } from "./Cwd.js"
import { GitService } from "./Git.js"

export interface RepoFilesOps {
  /**
   * Working-tree contents, `undefined` when absent. SYNCHRONOUS and TOTAL —
   * sync because Eta calls `it.read` synchronously during a render. ENOENT
   * reads as `undefined`; any other read failure THROWS.
   */
  readonly working: (path: string) => string | undefined
  /** Contents of `path` at `ref` (default `"HEAD"`), `undefined` when not present there. */
  readonly committed: (path: string, ref?: string) => Effect.Effect<string | undefined, Error>
}

export class RepoFiles extends Context.Tag("RepoFiles")<RepoFiles, RepoFilesOps>() {
  static Live = Layer.effect(
    RepoFiles,
    Effect.gen(function* () {
      const { root } = yield* Cwd
      const git = yield* GitService
      return {
        working: (path: string) => {
          try {
            return readFileSync(join(root, path), "utf8")
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined
            throw e
          }
        },
        committed: (path: string, ref = "HEAD") =>
          git.readFileAtRef(ref, path).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      }
    }),
  )
}

/**
 * Re-adds the ENOENT throw `RepoFiles.working` drops: a template's
 * `it.read(missing)` throwing IS the commit-refusal mechanism
 * (`PatternTemplates.ts`'s render-failure contract).
 */
export const templateRead =
  (files: RepoFilesOps) =>
  (path: string): string => {
    const content = files.working(path)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    }
    return content
  }
