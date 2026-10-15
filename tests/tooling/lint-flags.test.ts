import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { FLAGS } from "../../src/flags/index.js"
import { lintFlags, REGISTRY_PATH, shippedSources } from "../../scripts/lint-flags.ts"

const flag = (name: string, expiry: string) => ({
  name,
  owner: "ann",
  expiry,
  kind: "release" as const,
})
const lint = (text: string, registry = [flag("beta", "2099-01-01")], today = "2026-06-01") =>
  lintFlags([], { registry, files: [{ path: "src/a.ts", text }], today })

describe("lintFlags expiry", () => {
  it("fails an expiry before today", () => {
    expect(lint("", [flag("old", "2026-05-31")])).toEqual({
      code: 1,
      stderr: ["src/flags/index.ts: flag old (owner ann) expired on 2026-05-31"],
    })
  })

  it("passes an expiry equal to today", () => {
    expect(lint("", [flag("edge", "2026-06-01")])).toEqual({ code: 0, stderr: [] })
  })

  it("fails an impossible or malformed expiry, and accepts years below 100", () => {
    const r = lint(
      "",
      [flag("a", "2026-02-30"), flag("b", "soon"), flag("c", "0050-01-01")],
      "0001-01-01",
    )
    expect(r.stderr).toEqual([
      'src/flags/index.ts: flag a (owner ann): expiry "2026-02-30" is not a YYYY-MM-DD date',
      'src/flags/index.ts: flag b (owner ann): expiry "soon" is not a YYYY-MM-DD date',
    ])
  })
})

describe("lintFlags references", () => {
  it("fails an unregistered reference with file:line", () => {
    const r = lint("x\nconst v = 'GTD_FLAG_GHOST'", [])
    expect(r).toEqual({
      code: 1,
      stderr: ["src/a.ts:2: GTD_FLAG_GHOST names no registered flag"],
    })
  })

  it("matches the upper-cased name exactly, as resolveFlags reads it", () => {
    expect(lint("GTD_FLAG_BETA").code).toBe(0)
    expect(lint("GTD_FLAG_beta")).toEqual({
      code: 1,
      stderr: ["src/a.ts:1: GTD_FLAG_beta names no registered flag"],
    })
  })

  it("ignores names embedded in a longer identifier", () => {
    expect(lint("OTHER_GTD_FLAG_GHOST XGTD_FLAG_Y 2GTD_FLAG_Z", [])).toEqual({
      code: 0,
      stderr: [],
    })
  })

  it("counts $-, member- and quote-preceded names as references", () => {
    for (const text of ["$GTD_FLAG_X", "process.env.GTD_FLAG_X"]) {
      expect(lint(text, []).stderr).toEqual(["src/a.ts:1: GTD_FLAG_X names no registered flag"])
    }
  })

  it("ignores the bare prefix and placeholders", () => {
    expect(lint("GTD_FLAG_ `GTD_FLAG_${name}` GTD_FLAG_* GTD_FLAG_<NAME>", []).code).toBe(0)
  })

  it("reports every finding in one run", () => {
    const r = lintFlags([], {
      registry: [flag("old", "2020-01-01")],
      files: [{ path: "src/a.ts", text: "GTD_FLAG_X\nGTD_FLAG_Y" }],
      today: "2026-06-01",
    })
    expect(r.stderr).toEqual([
      "src/flags/index.ts: flag old (owner ann) expired on 2020-01-01",
      "src/a.ts:1: GTD_FLAG_X names no registered flag",
      "src/a.ts:2: GTD_FLAG_Y names no registered flag",
    ])
  })
})

describe("lintFlags usage", () => {
  it("rejects any argument with code 2", () => {
    expect(lintFlags(["--x"], { registry: [], files: [], today: "2026-06-01" })).toEqual({
      code: 2,
      stderr: ["usage: lint-flags takes no arguments"],
    })
  })
})

describe("lint-flags entry point", () => {
  it("runs as a script: a bad argument exits 2 with usage on stderr", () => {
    const r = spawnSync("npx", ["jiti", "scripts/lint-flags.ts", "--x"], { encoding: "utf8" })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage: lint-flags takes no arguments")
    expect(r.stdout).toBe("")
  })
})

describe("shippedSources", () => {
  const files = shippedSources("src")

  it("lints the real tree clean without reading the clock", () => {
    expect(lintFlags([], { registry: FLAGS, files, today: "0000-01-01" }).code).toBe(0)
  })

  it("lists shipped source only", () => {
    const paths = files.map((f) => f.path)
    expect(files.find((f) => f.path === REGISTRY_PATH)?.text).toMatch(/export const FLAGS\b/)
    expect(paths.filter((p) => /\.(test|fixture)\.tsx?$/.test(p))).toEqual([])
    expect(paths).toContain("src/web/App.tsx")
  })
})
