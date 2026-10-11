import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fallbackBuildCommand, isGeneratedClientImport } from "../vitest.ensureWebClient.js"

const REPO_ROOT = join(import.meta.dirname, "..", "..")

describe("ensureWebClient's fallback build", () => {
  it("triggers on the specifier src/ui/Server.ts actually imports the client page by", () => {
    const server = readFileSync(join(REPO_ROOT, "src/ui/Server.ts"), "utf8")
    const specifier = /from "([^"]+\.html)"/.exec(server)?.[1]

    expect(specifier).toBeDefined()
    expect(isGeneratedClientImport(specifier!)).toBe(true)
  })

  it("runs every build step up to and including the inline script, Tailwind included", () => {
    const command = fallbackBuildCommand()

    expect(command).toContain("tsdown --filter web")
    expect(command).toContain("@tailwindcss/cli")
    expect(command.endsWith("node scripts/inline-web-client.mjs")).toBe(true)
  })
})
