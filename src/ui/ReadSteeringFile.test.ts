import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { freeFormFormat, steeringFormatFor } from "../steering/index.js"
import { readSteeringFile } from "./ReadSteeringFile.js"
import { contentHashOf, liveReadFile } from "./index.js"

const QA_FORMAT = steeringFormatFor("qa")!

const depsFor = (files: Readonly<Record<string, string>>, headSha: string | undefined) => ({
  headSha: () => Promise.resolve(headSha),
  readFile: (absPath: string) => Promise.resolve(files[absPath]),
})

describe("readSteeringFile", () => {
  it("reads the file, resolving path against worktreePath, and returns its content/headSha/contentHash/view together", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: ".gtd/PLAN.md", mode: "qa" },
      depsFor({ "/repo/.gtd/PLAN.md": QA_FORMAT.sample }, "abc123"),
    )
    expect(result).toEqual({
      ok: true,
      content: QA_FORMAT.sample,
      headSha: "abc123",
      contentHash: contentHashOf(QA_FORMAT.sample),
      view: QA_FORMAT.view(QA_FORMAT.sample),
    })
  })

  it("reads a missing served file as an empty document, rather than refusing", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "missing.md", mode: "qa" },
      depsFor({}, "abc123"),
    )
    expect(result).toEqual({
      ok: true,
      content: "",
      headSha: "abc123",
      contentHash: contentHashOf(""),
      view: QA_FORMAT.view(""),
    })
  })

  it("refuses a filePath that escapes the worktree root, as file-vanished, never reaching readFile with a path outside it", async () => {
    let readCalled = false
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "../../../etc/passwd", mode: "qa" },
      {
        headSha: () => Promise.resolve("abc123"),
        readFile: () => {
          readCalled = true
          return Promise.resolve(undefined)
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
        { worktreePath: root, filePath: "escape.md", mode: "qa" },
        { headSha: () => Promise.resolve("abc123"), readFile: liveReadFile },
      )
      expect(result).toEqual({ ok: false, reason: "file-vanished" })
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("falls back to the free-form format's own view for an unregistered mode, rather than refusing", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "x.md", mode: "not-a-real-mode" },
      depsFor({ "/repo/x.md": "content" }, "abc123"),
    )
    expect(result).toEqual({
      ok: true,
      content: "content",
      headSha: "abc123",
      contentHash: contentHashOf("content"),
      view: freeFormFormat.view("content"),
    })
  })

  it("falls back to the free-form format's own view when mode is absent entirely", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "x.md", mode: undefined },
      depsFor({ "/repo/x.md": "content" }, "abc123"),
    )
    expect(result).toEqual({
      ok: true,
      content: "content",
      headSha: "abc123",
      contentHash: contentHashOf("content"),
      view: freeFormFormat.view("content"),
    })
  })

  it("refuses as head-unresolved when headSha resolves undefined, never an ok:true carrying an empty headSha", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "x.md", mode: "qa" },
      depsFor({ "/repo/x.md": "Just prose.\n" }, undefined),
    )
    expect(result).toEqual({ ok: false, reason: "head-unresolved" })
  })
})
