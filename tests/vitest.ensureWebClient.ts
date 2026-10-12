import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { type Plugin } from "vitest/config"

const REPO_ROOT = resolve(import.meta.dirname, "..")
const GENERATED_HTML = resolve(REPO_ROOT, "src/ui/client.generated.html")

export const isGeneratedClientImport = (source: string): boolean =>
  source.endsWith("/client.generated.html")

/** `npm run build`'s own steps up to and including the inline script, so the fallback cannot drift from the real build. */
export const fallbackBuildCommand = (): string => {
  const build: string = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")).scripts
    .build
  const steps = build.split(" && ")
  return steps
    .slice(0, steps.findIndex((step) => step.includes("inline-web-client")) + 1)
    .join(" && ")
}

/**
 * `src/ui/Server.ts` imports `./client.generated.html` — gitignored,
 * produced only by `npm run build`'s browser step + inline script. Turbo's
 * `test:unit`/`test:workflows`/`test:e2e:inmem`/`test:e2e:live` tasks all declare
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
      if (ensured || !isGeneratedClientImport(source)) return null
      ensured = true
      if (!existsSync(GENERATED_HTML)) {
        // npm-script names (`tsdown`) resolve only with the local bin on PATH.
        execSync(fallbackBuildCommand(), {
          cwd: REPO_ROOT,
          stdio: "inherit",
          env: {
            ...process.env,
            PATH: `${resolve(REPO_ROOT, "node_modules/.bin")}:${process.env["PATH"] ?? ""}`,
          },
        })
      }
      return null // Fall through to the default resolver now that the file exists.
    },
  }
}
