import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Cwd } from "./Cwd.js"
import { GitService } from "./Git.js"

/**
 * The content port: reading a repo-root-relative path, working-tree or
 * committed. Replaces `WorktreeReader` — the guards (`src/StepGuards.ts`)
 * need BOTH the pending bytes and the last-committed bytes of the same
 * `file:`, so this widens the old single-purpose read into one port with two
 * halves rather than adding a second tag alongside it.
 */
export interface RepoFilesOps {
  /**
   * Working-tree contents of a repo-root-relative path, `undefined` when
   * absent. SYNCHRONOUS and TOTAL — sync because Eta calls `it.read`
   * synchronously during a render (the reason `WorktreeReader` existed).
   * ENOENT reads as `undefined`; any other read failure (a directory in the
   * file's place, a permissions error) THROWS rather than being swallowed.
   */
  readonly working: (path: string) => string | undefined
  /** Contents of `path` at `ref` (default `"HEAD"`), `undefined` when not present there — git cannot distinguish a missing path from a missing ref without a second call, and every caller already treats both alike. */
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
 * `TemplateContext.read`: re-adds the ENOENT throw `RepoFiles.working`
 * deliberately drops, because a template's `it.read(missing)` throwing IS the
 * commit-refusal mechanism (`PatternTemplates.ts`'s render-failure contract) —
 * the one caller that wants the throw back.
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
