import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { widgetFormat } from "../steering/index.js"
import { readSteeringFile } from "./ReadSteeringFile.js"
import { contentHashOf, liveReadFile } from "./index.js"

const PLAN = "# Plan\n\n## 🔘 Store?\n\n- [ ] Redis\n- [ ] Memory\n"

const depsFor = (files: Readonly<Record<string, string>>, headSha: string | undefined) => ({
  headSha: () => Promise.resolve(headSha),
  readFile: (absPath: string) =>
    Promise.resolve(
      absPath in files
        ? { kind: "content" as const, content: files[absPath]! }
        : { kind: "absent" as const },
    ),
})

describe("readSteeringFile", () => {
  it("reads the file, resolving path against worktreePath, and returns its content/headSha/contentHash/view together", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: ".gtd/PLAN.md" },
      depsFor({ "/repo/.gtd/PLAN.md": PLAN }, "abc123"),
    )
    expect(result).toEqual({
      ok: true,
      content: PLAN,
      headSha: "abc123",
      contentHash: contentHashOf(PLAN),
      view: widgetFormat.view(PLAN),
    })
  })

  it("reads a missing served file as an empty document, rather than refusing", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "missing.md" },
      depsFor({}, "abc123"),
    )
    expect(result).toEqual({
      ok: true,
      content: "",
      headSha: "abc123",
      contentHash: contentHashOf(""),
      view: widgetFormat.view(""),
    })
  })

  it("refuses a filePath that escapes the worktree root, as file-vanished, never reaching readFile with a path outside it", async () => {
    let readCalled = false
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "../../../etc/passwd" },
      {
        headSha: () => Promise.resolve("abc123"),
        readFile: () => {
          readCalled = true
          return Promise.resolve({ kind: "absent" as const })
        },
      },
    )
    expect(result).toEqual({ ok: false, reason: "file-vanished" })
    expect(readCalled).toBe(false)
  })

  it("T3: refuses a symlink inside the worktree root whose real target lands outside it, real on-disk, through the actual readFile", async () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-readsteering-"))
    const outside = mkdtempSync(join(tmpdir(), "gtd-readsteering-outside-"))
    try {
      writeFileSync(join(outside, "secret.md"), "top secret")
      symlinkSync(join(outside, "secret.md"), join(root, "escape.md"))
      const result = await readSteeringFile(
        { worktreePath: root, filePath: "escape.md" },
        { headSha: () => Promise.resolve("abc123"), readFile: liveReadFile },
      )
      expect(result).toEqual({ ok: false, reason: "file-vanished" })
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("refuses as file-vanished when the read fails (EISDIR, permission error, …), never falling back to an empty document", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "x.md" },
      {
        headSha: () => Promise.resolve("abc123"),
        readFile: () => Promise.resolve({ kind: "unreadable" as const }),
      },
    )
    expect(result).toEqual({ ok: false, reason: "file-vanished" })
  })

  it("refuses as head-unresolved when headSha resolves undefined, never an ok:true carrying an empty headSha", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "x.md" },
      depsFor({ "/repo/x.md": "Just prose.\n" }, undefined),
    )
    expect(result).toEqual({ ok: false, reason: "head-unresolved" })
  })
})
