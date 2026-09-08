import { describe, expect, it } from "vitest"
import { QA_FORMAT } from "../OpenQuestions.js"
import { readSteeringFile } from "./ReadSteeringFile.js"
import { contentHashOf } from "./Write.js"

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

  it("returns file-vanished when the file can't be read, never throwing", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "missing.md", mode: "qa" },
      depsFor({}, "abc123"),
    )
    expect(result).toEqual({ ok: false, reason: "file-vanished" })
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

  it("returns unsupported-mode for an unregistered mode, never a throw or a stale/empty view", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "x.md", mode: "not-a-real-mode" },
      depsFor({ "/repo/x.md": "content" }, "abc123"),
    )
    expect(result).toEqual({ ok: false, reason: "unsupported-mode" })
  })

  it("falls back to an empty headSha string, never undefined, when the worktree has no commits yet", async () => {
    const result = await readSteeringFile(
      { worktreePath: "/repo", filePath: "x.md", mode: "qa" },
      depsFor({ "/repo/x.md": "Just prose.\n" }, undefined),
    )
    expect(result).toEqual({
      ok: true,
      content: "Just prose.\n",
      headSha: "",
      contentHash: contentHashOf("Just prose.\n"),
      view: QA_FORMAT.view("Just prose.\n"),
    })
  })
})
