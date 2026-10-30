import { registerHooks } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { nodeSyncIo } from "./NodeSync.js"
import type { PinFile } from "./PinFile.js"

// `cwd`, as the engine's own root is: gtd runs only at the worktree root, and
// a relocated `$GIT_DIR` leaves no `.git` to walk up to. A file that cannot be
// read counts as no pin, so the launcher refuses it rather than crashing.
export const livePinFile =
  (cwd: string, path: string): PinFile =>
  () => {
    const file = join(cwd, path)
    try {
      const bytes = nodeSyncIo.readFile(file)
      if (bytes !== undefined) return { path: file, bytes }
    } catch {
      return { path: file, bytes: new Uint8Array() }
    }
    try {
      return { path: file, bytes: nodeSyncIo.gitBytes(cwd, ["show", `HEAD:${path}`]) }
    } catch {
      return undefined
    }
  }

/**
 * Runs a pin's module as this process's main program. Node refuses an unknown
 * extension, so a load hook serves the unpacked source under the pin's own
 * URL — `import.meta.url` stays a file in the repository.
 */
export const runPinModule = async (path: string, source: string): Promise<void> => {
  const url = pathToFileURL(path).href
  // A pin read from HEAD has no file behind its URL, which Node's own resolve refuses.
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === url ? { url, shortCircuit: true } : nextResolve(specifier, context),
    load: (requested, context, nextLoad) =>
      requested === url
        ? { format: "module", source, shortCircuit: true }
        : nextLoad(requested, context),
  })
  await import(url)
}
