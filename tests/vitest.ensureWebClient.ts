import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { type Plugin } from "vitest/config"
import { WEB_CLIENT_STEPS } from "../scripts/build.mjs"

const REPO_ROOT = resolve(import.meta.dirname, "..")
const GENERATED_HTML = resolve(REPO_ROOT, "src/ui/client.generated.html")

export const isGeneratedClientImport = (source: string): boolean =>
  source.endsWith("/client.generated.html")

/** The real build's own steps up to and including the inline script, so the fallback cannot drift from it. */
export const fallbackBuildCommand = (): string => WEB_CLIENT_STEPS.join(" && ")

/**
 * `src/ui/Server.ts` imports `./client.generated.html` — gitignored, produced
 * only by the `build` task. `vp run`'s test tasks depend on `build`; a bare
 * `vitest` or stryker run does not, so the first resolution builds it once if
 * missing.
 */
export const ensureWebClient = (): Plugin => {
  let ensured = false
  return {
    name: "ensure-web-client",
    resolveId(source) {
      if (ensured || !isGeneratedClientImport(source)) return null
      ensured = true
      if (!existsSync(GENERATED_HTML)) {
        // npm-script names (`vp`) resolve only with the local bin on PATH.
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
