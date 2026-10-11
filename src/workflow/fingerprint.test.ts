import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { changedConfigFiles, configFingerprint } from "./fingerprint.js"

describe("the config fingerprint", () => {
  it("hashes each file under its root-relative path, skipping one that cannot be read", () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-fingerprint-"))
    mkdirSync(join(root, "lib"))
    writeFileSync(join(root, "gtd.config.ts"), "export default 1\n")
    writeFileSync(join(root, "lib", "flow.ts"), "export const a = 1\n")

    const fingerprint = configFingerprint(
      [join(root, "gtd.config.ts"), join(root, "lib", "flow.ts"), join(root, "gone.ts")],
      root,
    )

    expect(Object.keys(fingerprint).sort()).toEqual(["gtd.config.ts", "lib/flow.ts"])
    expect(fingerprint["gtd.config.ts"]).toMatch(/^[0-9a-f]{16}$/)
    writeFileSync(join(root, "lib", "flow.ts"), "export const a = 2\n")
    expect(
      changedConfigFiles(
        fingerprint,
        configFingerprint([join(root, "gtd.config.ts"), join(root, "lib", "flow.ts")], root),
      ),
    ).toEqual(["lib/flow.ts"])
  })

  it("relates a file reported by its real path to a root reached through a symlink", () => {
    const real = mkdtempSync(join(tmpdir(), "gtd-fingerprint-"))
    writeFileSync(join(real, "gtd.config.ts"), "export default 1\n")
    const link = join(mkdtempSync(join(tmpdir(), "gtd-fingerprint-link-")), "repo")
    symlinkSync(real, link)

    expect(
      Object.keys(configFingerprint([join(realpathSync(real), "gtd.config.ts")], link)),
    ).toEqual(["gtd.config.ts"])
  })

  it("never records a path with a control character", () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-fingerprint-"))
    writeFileSync(join(root, "a\x1b.ts"), "export const a = 1\n")

    expect(configFingerprint([join(root, "a\x1b.ts")], root)).toEqual({})
  })

  it("names a file only one side has as changed", () => {
    expect(changedConfigFiles({ a: "1", b: "2" }, { a: "1", c: "3" })).toEqual(["b", "c"])
    expect(changedConfigFiles({ a: "1" }, { a: "1" })).toEqual([])
  })
})
