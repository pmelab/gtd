import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8")

// GitHub-style heading slug
const slug = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-")

// stale-paths.test.ts scans only src/ and tests/, so SDLC.md's links rot unseen
const links = [...read("SDLC.md").matchAll(/\]\(([^)#\s]+)(?:#([^)\s]+))?\)/g)]
  .map((m) => ({ path: m[1] as string, anchor: m[2] }))
  .filter((l) => !/^https?:/.test(l.path))

describe("SDLC.md links", () => {
  it("cites links", () => {
    expect(links.length).toBeGreaterThan(0)
  })

  it.each(links)("$path#$anchor resolves", ({ path, anchor }) => {
    expect(existsSync(resolve(repoRoot, path)), `${path} does not exist`).toBe(true)
    if (anchor) {
      const slugs = read(path)
        .split("\n")
        .filter((l) => /^#+ /.test(l))
        .map((l) => slug(l.replace(/^#+ /, "")))
      expect(slugs, `${path} has no heading for #${anchor}`).toContain(anchor)
    }
  })
})
