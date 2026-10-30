import { existsSync, readFileSync } from "node:fs"

// A source-relative literal (`../../package.json`) breaks the built single-file
// bundle: bundling doesn't rewrite `import.meta.url` per original module, so a
// hardcoded depth only matches whichever depth this file happens to sit at in
// dist/ vs src/ — they differ (dist/gtd.bundle.mjs is always one level below
// repo root; src/install/Version.ts is two). Walking up from wherever this module
// actually runs from resolves correctly in both the unbundled (vitest/tsc) and
// bundled (dist/gtd.bundle.mjs) case. URLs, not paths: this runs at import,
// before any Effect service exists.
const findPackageJson = (fromUrl: string): URL => {
  let dir = new URL(".", fromUrl)
  for (let i = 0; i < 5; i++) {
    const candidate = new URL("package.json", dir)
    if (existsSync(candidate)) return candidate
    dir = new URL("..", dir)
  }
  throw new Error(`package.json not found by walking up from ${fromUrl}`)
}

/** The global a pin's workflow registers itself under, ahead of the engine in the same file. */
export const PIN_KEY = Symbol.for("@pmelab/gtd/pin")

// Inside a pin, `import.meta.url` is the pin's own file, in the user's
// repository: the pin registered the version it was built by before this runs.
const pinned = (globalThis as { [PIN_KEY]?: { readonly version: string } })[PIN_KEY]?.version

export const GTD_VERSION: string =
  pinned ??
  (JSON.parse(readFileSync(findPackageJson(import.meta.url), "utf8")) as { version: string })
    .version
