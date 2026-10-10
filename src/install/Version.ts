import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const _require = createRequire(import.meta.url)

// A source-relative literal (`../../package.json`) breaks the built single-file
// bundle: bundling doesn't rewrite `import.meta.url` per original module, so a
// hardcoded depth only matches whichever depth this file happens to sit at in
// dist/ vs src/ — they differ (dist/gtd.bundle.mjs is always one level below
// repo root; src/install/Version.ts is two). Walking up from wherever this module
// actually runs from resolves correctly in both the unbundled (vitest/tsc) and
// bundled (dist/gtd.bundle.mjs) case.
const findPackageJson = (fromUrl: string): string => {
  let dir = dirname(fileURLToPath(fromUrl))
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "package.json")
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  throw new Error(`package.json not found by walking up from ${fromUrl}`)
}

export const GTD_VERSION: string = (
  _require(findPackageJson(import.meta.url)) as { version: string }
).version
