import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { type Plugin } from "vitest/config"

const GENERATED_HTML = resolve(import.meta.dirname, "..", "src/web/generated.html")

/**
 * `src/ui/Server.ts` imports `../web/generated.html` — gitignored,
 * produced only by `npm run build`'s browser step + inline script. Turbo's
 * `test:unit`/`test:e2e:inmem`/`test:e2e:live` tasks all declare
 * `dependsOn: ["build"]` so that import always resolves under `npm test`
 * (`test:web`'s storybook project needs no such dependency: it only ever
 * loads `App.stories.tsx` -> `App.tsx`, never `src/ui/Server.ts`). Two
 * SANCTIONED entry points bypass turbo entirely: `npm run test:mutation`
 * (stryker has no build step of its own) and a bare
 * `npm run test:unit`/`test:changed` invoked directly. A `pre<task>` npm
 * script would cover those but is banned outright
 * (`tests/tooling/turbo.test.ts` — it bypasses turbo's cache graph), so the
 * fallback lives here instead: the FIRST resolution of the generated file in
 * any vitest run builds it on demand, once, if it's missing. A no-op on an
 * already-built tree (the common case under turbo).
 */
export const ensureWebClient = (): Plugin => {
  let ensured = false
  return {
    name: "ensure-web-client",
    resolveId(source) {
      if (ensured || !source.endsWith("web/generated.html")) return null
      ensured = true
      if (!existsSync(GENERATED_HTML)) {
        execSync("npx tsdown --filter web && node scripts/inline-web-client.mjs", {
          cwd: resolve(import.meta.dirname, ".."),
          stdio: "inherit",
        })
      }
      return null // Fall through to the default resolver now that the file exists.
    },
  }
}
