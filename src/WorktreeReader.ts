import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Cwd } from "./Cwd.js"

/**
 * A synchronous working-tree file read, keyed by repo-root-relative path —
 * exactly the `read(path)` callback `PatternTemplates.TemplateContext`
 * requires. Kept as its own tiny Context tag (mirroring `Cwd`) rather than
 * routed through `FileSystem.FileSystem`: Eta's `renderString` calls template
 * helpers synchronously, and `@effect/platform-node`'s FileSystem reads are
 * not guaranteed `Effect.runSync`-safe, while the in-memory test FileSystem
 * layer's reads happen to be. A dedicated sync-only tag sidesteps that
 * mismatch entirely and lets the in-memory test layer substitute its own
 * worktree map directly (see tests/integration/support/inmem/layers.ts).
 */
export class WorktreeReader extends Context.Tag("WorktreeReader")<
  WorktreeReader,
  { readonly read: (path: string) => string }
>() {
  static Live = Layer.effect(
    WorktreeReader,
    Effect.gen(function* () {
      const { root } = yield* Cwd
      return { read: (path: string) => readFileSync(join(root, path), "utf8") }
    }),
  )
}
