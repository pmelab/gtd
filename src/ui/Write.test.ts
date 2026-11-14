import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { widgetFormat } from "../steering/index.js"
import {
  contentHashOf,
  liveReadFile,
  liveWriteFile,
  writeNote,
  writeValue,
  type WriteDeps,
} from "./Write.js"
import type { ReadFileResult } from "./index.js"

/** Shorthand for a `readFile` double returning `content` — the common case. */
const content = (text: string): Promise<ReadFileResult> =>
  Promise.resolve({ kind: "content", content: text })
/** Shorthand for a `readFile` double returning `absent` — a file gtd hasn't written yet. */
const absent = (): Promise<ReadFileResult> => Promise.resolve({ kind: "absent" })

const WORKTREE = "/repo"
const FILE = ".gtd/PLAN.md"
const CONTENT = ["# Plan", "", "## 🔍 Chunk", "", "- [ ] ./a.ts#1-1 hunk", ""].join("\n")

const SELECT_CONTENT = [
  "# Plan",
  "",
  "## 🔘 Which option?",
  "",
  "- [ ] Option A",
  "- [ ] ✏️",
  "",
].join("\n")

const fakeDeps = (overrides: Partial<WriteDeps> = {}): WriteDeps => ({
  headSha: vi.fn(async () => "sha1"),
  actorAt: vi.fn(async () => "human"),
  readFile: vi.fn(() => content(CONTENT)),
  writeFile: vi.fn(async () => undefined),
  ...overrides,
})

const baseRequest = () => ({
  worktreePath: WORKTREE,
  filePath: FILE,
  expectedHeadSha: "sha1",
  expectedContentHash: contentHashOf(CONTENT),
  anchor: { kind: "question" as const, index: 0 },
  text: "a note a human typed",
})

const baseValueRequest = () => ({
  worktreePath: WORKTREE,
  filePath: FILE,
  expectedHeadSha: "sha1",
  expectedContentHash: contentHashOf(CONTENT),
  anchor: { kind: "hunk" as const, chunkIndex: 0, index: 0 },
  checked: true,
})

describe("liveReadFile", () => {
  it("a path that was never written classifies as absent, not unreadable", async () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-liveread-"))
    try {
      expect(await liveReadFile(join(root, "never-written.md"))).toEqual({ kind: "absent" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("a directory at the path (EISDIR) classifies as unreadable, real on-disk — the deterministic stand-in for a permission error", async () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-liveread-"))
    try {
      const asDir = join(root, "actually-a-dir.md")
      mkdirSync(asDir)
      expect(await liveReadFile(asDir)).toEqual({ kind: "unreadable" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("reads real content when the file is there", async () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-liveread-"))
    try {
      const filePath = join(root, "file.md")
      writeFileSync(filePath, "hello")
      expect(await liveReadFile(filePath)).toEqual({ kind: "content", content: "hello" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("writeNote", () => {
  it("succeeds when the sha and content hash both match, and the worktree rests with a human", async () => {
    const deps = fakeDeps()
    const result = await writeNote(baseRequest(), deps)
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    const [absPath, written] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(absPath).toBe("/repo/.gtd/PLAN.md")
    expect(written).toContain("## 🔍 Chunk[^fn1]")
    expect(written).toContain("[^fn1]: a note a human typed")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("refuses a filePath that escapes the worktree root — as file-vanished, never reaching readFile/writeFile with a path outside it", async () => {
    const deps = fakeDeps()
    const result = await writeNote({ ...baseRequest(), filePath: "../../../etc/passwd" }, deps)
    expect(result).toEqual({ ok: false, reason: "file-vanished" })
    expect(deps.readFile).not.toHaveBeenCalled()
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("refuses an absolute filePath the same way — path.resolve never falls back to the worktree root for one", async () => {
    const deps = fakeDeps()
    const result = await writeNote({ ...baseRequest(), filePath: "/etc/passwd" }, deps)
    expect(result).toEqual({ ok: false, reason: "file-vanished" })
    expect(deps.readFile).not.toHaveBeenCalled()
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("T3: refuses a symlink inside the worktree root whose real target lands outside it, real on-disk, through the actual readFile/writeFile", async () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-write-"))
    const outside = mkdtempSync(join(tmpdir(), "gtd-write-outside-"))
    try {
      writeFileSync(join(outside, "secret.md"), "top secret")
      symlinkSync(join(outside, "secret.md"), join(root, "escape.md"))
      const readFile = vi.fn(liveReadFile)
      const deps: WriteDeps = {
        headSha: vi.fn(async () => "sha1"),
        actorAt: vi.fn(async () => "human"),
        readFile,
        writeFile: liveWriteFile,
      }
      const result = await writeNote(
        { ...baseRequest(), worktreePath: root, filePath: "escape.md" },
        deps,
      )
      expect(result).toEqual({ ok: false, reason: "file-vanished" })
      expect(readFile).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("rejects a write whose sha moved, and the file is untouched", async () => {
    const deps = fakeDeps({ headSha: vi.fn(async () => "sha2") })
    const result = await writeNote(baseRequest(), deps)
    expect(result).toEqual({ ok: false, reason: "stale-token", moved: "sha" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("rejects a write whose content hash moved, and the file is untouched", async () => {
    const deps = fakeDeps({ readFile: vi.fn(() => content(CONTENT + "\n")) })
    const result = await writeNote(baseRequest(), deps)
    expect(result).toEqual({ ok: false, reason: "stale-token", moved: "content-hash" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("the content hash is over the file's exact bytes, so a whitespace-only change invalidates it", async () => {
    const withTrailingSpace = CONTENT.replace("## 🔍 Chunk", "## 🔍 Chunk ")
    const deps = fakeDeps({ readFile: vi.fn(() => content(withTrailingSpace)) })
    // `baseRequest()`'s `expectedContentHash` is over the ORIGINAL `CONTENT`
    // bytes — the file on disk now differs by one trailing space only.
    const result = await writeNote(baseRequest(), deps)
    expect(result).toEqual({ ok: false, reason: "stale-token", moved: "content-hash" })
    expect(deps.writeFile).not.toHaveBeenCalled()
    // The inverse: hashing the exact (whitespace-changed) bytes and expecting
    // THAT hash succeeds — proving the hash is sensitive to whitespace at all,
    // not merely that a wrong hash was supplied.
    const matchingRequest = {
      ...baseRequest(),
      expectedContentHash: contentHashOf(withTrailingSpace),
    }
    const matchingResult = await writeNote(matchingRequest, deps)
    expect(matchingResult.ok).toBe(true)
  })

  it("names which of the two moved — sha and content-hash are distinguishable", async () => {
    const shaResult = await writeNote(baseRequest(), fakeDeps({ headSha: vi.fn(async () => "x") }))
    const hashResult = await writeNote(
      baseRequest(),
      fakeDeps({ readFile: vi.fn(() => content("different")) }),
    )
    expect(shaResult).toMatchObject({ moved: "sha" })
    expect(hashResult).toMatchObject({ moved: "content-hash" })
  })

  it("a write to a worktree resting at a human state succeeds", async () => {
    const deps = fakeDeps({ actorAt: vi.fn(async () => "human") })
    expect((await writeNote(baseRequest(), deps)).ok).toBe(true)
  })

  it("a write to a worktree resting at an agent or check state is rejected", async () => {
    for (const actor of ["agent", "check", undefined]) {
      const deps = fakeDeps({ actorAt: vi.fn(async () => actor) })
      const result = await writeNote(baseRequest(), deps)
      expect(result).toEqual({ ok: false, reason: "not-resting" })
      expect(deps.writeFile).not.toHaveBeenCalled()
    }
  })

  it("the rest check runs on every write, not once per session", async () => {
    const actorAt = vi.fn(async () => "human")
    const deps = fakeDeps({ actorAt })
    await writeNote(baseRequest(), deps)
    await writeNote(baseRequest(), deps)
    expect(actorAt).toHaveBeenCalledTimes(2)
  })

  it("the not-resting rejection is distinguishable from a compare-and-swap rejection", async () => {
    const notResting = await writeNote(
      baseRequest(),
      fakeDeps({ actorAt: vi.fn(async () => "agent") }),
    )
    const stale = await writeNote(baseRequest(), fakeDeps({ headSha: vi.fn(async () => "other") }))
    expect(notResting.ok).toBe(false)
    expect(stale.ok).toBe(false)
    if (notResting.ok || stale.ok) throw new Error("unreachable")
    expect(notResting.reason).not.toBe(stale.reason)
  })

  it("a served file absent at write time is treated as empty, not vanished — the anchor still has to resolve against that empty document", async () => {
    const deps = fakeDeps({ readFile: vi.fn(() => absent()) })
    const request = {
      ...baseRequest(),
      expectedContentHash: contentHashOf(""),
      anchor: { kind: "paragraph" as const, line: 0 },
    }
    // An empty document has no block at line 0 to annotate: `anchor-unresolved`, never `file-vanished`.
    expect(await writeNote(request, deps)).toEqual({ ok: false, reason: "anchor-unresolved" })
  })

  it("a file that IS there but can't be read (EACCES, EIO, …) refuses as file-vanished — never truncated as if it were absent", async () => {
    const deps = fakeDeps({
      readFile: vi.fn(() => Promise.resolve({ kind: "unreadable" as const })),
    })
    const result = await writeNote(baseRequest(), deps)
    expect(result).toEqual({ ok: false, reason: "file-vanished" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("an unreadable file refuses even when the expected content hash is the hash of empty content — the empty-content compare-and-swap never masks an unreadable file as absent", async () => {
    const deps = fakeDeps({
      readFile: vi.fn(() => Promise.resolve({ kind: "unreadable" as const })),
    })
    const request = { ...baseRequest(), expectedContentHash: contentHashOf("") }
    const result = await writeNote(request, deps)
    expect(result).toEqual({ ok: false, reason: "file-vanished" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("an anchor that no longer resolves is rejected, not silently dropped", async () => {
    const deps = fakeDeps()
    const request = { ...baseRequest(), anchor: { kind: "question" as const, index: 99 } }
    expect(await writeNote(request, deps)).toEqual({ ok: false, reason: "anchor-unresolved" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("no refusal path leaves a partially written file — writeFile is only ever called on a full success", async () => {
    const scenarios: Partial<WriteDeps>[] = [
      { actorAt: vi.fn(async () => "agent") },
      { headSha: vi.fn(async () => "wrong") },
      { readFile: vi.fn(() => absent()) },
    ]
    for (const overrides of scenarios) {
      const deps = fakeDeps(overrides)
      await writeNote(baseRequest(), deps)
      expect(deps.writeFile).not.toHaveBeenCalled()
    }
  })

  it("two writes racing on one file leave the file valid, with exactly one applied", async () => {
    let stored = CONTENT
    let storedHash = contentHashOf(CONTENT)
    const writes: string[] = []
    // Both requests read the SAME initial snapshot (simulating two clients
    // that rendered before either wrote) and race their writes; `readFile`
    // always returns the CURRENT store so the loser sees the winner's write.
    const deps: WriteDeps = {
      headSha: async () => "sha1",
      actorAt: async () => "human",
      readFile: async () => content(stored),
      writeFile: async (_path, content) => {
        writes.push(content)
        stored = content
        storedHash = contentHashOf(content)
      },
    }
    const requestA = {
      ...baseRequest(),
      expectedContentHash: storedHash,
      anchor: { kind: "question" as const, index: 0 },
    }
    const requestB = {
      ...baseRequest(),
      expectedContentHash: storedHash,
      anchor: { kind: "hunk" as const, chunkIndex: 0, index: 0 },
    }
    const [resultA, resultB] = await Promise.all([
      writeNote(requestA, deps),
      writeNote(requestB, deps),
    ])
    const oks = [resultA, resultB].filter((r) => r.ok)
    const rejected = [resultA, resultB].filter((r) => !r.ok)
    expect(oks).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: "stale-token", moved: "content-hash" })
    expect(writes).toHaveLength(1)
  })
})

describe("writeValue", () => {
  it("succeeds when the sha and content hash both match, and the worktree rests with a human", async () => {
    const deps = fakeDeps()
    const result = await writeValue(baseValueRequest(), deps)
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    const [absPath, written] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(absPath).toBe("/repo/.gtd/PLAN.md")
    expect(written).toContain("- [x] ./a.ts#1-1 hunk")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("commits checked and text together in ONE call for a custom answer, landing the text in the written bytes", async () => {
    const deps = fakeDeps({ readFile: vi.fn(() => content(SELECT_CONTENT)) })
    const request = {
      worktreePath: WORKTREE,
      filePath: FILE,
      expectedHeadSha: "sha1",
      expectedContentHash: contentHashOf(SELECT_CONTENT),
      anchor: { kind: "option" as const, questionIndex: 0, index: 1 },
      checked: true,
      text: "worth flagging",
    }
    const result = await writeValue(request, deps)
    const [, written] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(written).toContain("- [x] ✏️ worth flagging")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  // Task 01's in-place recovery (`web/staleRetry.ts#withStaleShaRetry`) lives
  // entirely client-side: it refetches and retries ONCE against the client's
  // own stale HEAD guess. It changes nothing about the compare-and-swap
  // itself — a genuine sha move (someone else really did commit) must still
  // refuse here, every time, with no server-side softening of any kind.
  it("rejects a write whose sha moved, and the file is untouched", async () => {
    const deps = fakeDeps({ headSha: vi.fn(async () => "sha2") })
    const result = await writeValue(baseValueRequest(), deps)
    expect(result).toEqual({ ok: false, reason: "stale-token", moved: "sha" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("rejects a write whose content hash moved, and the file is untouched", async () => {
    const deps = fakeDeps({ readFile: vi.fn(() => content(CONTENT + "\n")) })
    const result = await writeValue(baseValueRequest(), deps)
    expect(result).toEqual({ ok: false, reason: "stale-token", moved: "content-hash" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("a worktree not resting with a human refuses with not-resting", async () => {
    for (const actor of ["agent", "check", undefined]) {
      const deps = fakeDeps({ actorAt: vi.fn(async () => actor) })
      const result = await writeValue(baseValueRequest(), deps)
      expect(result).toEqual({ ok: false, reason: "not-resting" })
      expect(deps.writeFile).not.toHaveBeenCalled()
    }
  })

  it("a served file absent at write time is treated as empty, and appending to it CREATES the file rather than refusing", async () => {
    const deps = fakeDeps({ readFile: vi.fn(() => absent()) })
    const request = {
      worktreePath: WORKTREE,
      filePath: FILE,
      expectedHeadSha: "sha1",
      expectedContentHash: contentHashOf(""),
      anchor: { kind: "paragraph" as const, line: 0 },
      text: "first line ever written",
    }
    const result = await writeValue(request, deps)
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    const [absPath, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(absPath).toBe("/repo/.gtd/PLAN.md")
    expect(written).toContain("first line ever written")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("liveWriteFile creates the containing directory, real on-disk, when a worktree's .gtd/ doesn't exist yet — the exact shape a new file's first write hits", async () => {
    const root = mkdtempSync(join(tmpdir(), "gtd-write-mkdir-"))
    try {
      const deps: WriteDeps = {
        headSha: vi.fn(async () => "sha1"),
        actorAt: vi.fn(async () => "human"),
        readFile: liveReadFile,
        writeFile: liveWriteFile,
      }
      const request = {
        worktreePath: root,
        // `.gtd/` itself does not exist under `root` yet.
        filePath: ".gtd/TODO.md",
        expectedHeadSha: "sha1",
        expectedContentHash: contentHashOf(""),
        anchor: { kind: "paragraph" as const, line: 0 },
        text: "first line ever written",
      }
      const result = await writeValue(request, deps)
      expect(result).toEqual({
        ok: true,
        contentHash: contentHashOf("first line ever written\n"),
      })
      expect(readFileSync(join(root, ".gtd", "TODO.md"), "utf8")).toBe("first line ever written\n")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("an anchor that no longer resolves is rejected, not silently dropped", async () => {
    const deps = fakeDeps()
    const request = {
      ...baseValueRequest(),
      anchor: { kind: "hunk" as const, chunkIndex: 0, index: 99 },
    }
    expect(await writeValue(request, deps)).toEqual({ ok: false, reason: "anchor-unresolved" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("a question anchor on a review checklist ticks every hunk in one write", async () => {
    const twoHunks = `${CONTENT}- [ ] ./b.ts#2-2 other hunk\n`
    const deps = fakeDeps({ readFile: vi.fn(() => content(twoHunks)) })
    const request = {
      ...baseValueRequest(),
      expectedContentHash: contentHashOf(twoHunks),
      anchor: { kind: "question" as const, index: 0 },
    }
    const result = await writeValue(request, deps)
    const [, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(written).toContain("- [x] ./a.ts#1-1 hunk\n- [x] ./b.ts#2-2 other hunk")
    expect(widgetFormat.validate(written)).toEqual([])
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("writes the file in its canonical form, refilling a long paragraph to 80 columns, and returns that form's hash", async () => {
    const long = `${"word ".repeat(30).trim()}\n\n${CONTENT}`
    const deps = fakeDeps({ readFile: vi.fn(() => content(long)) })
    const request = { ...baseValueRequest(), expectedContentHash: contentHashOf(long) }
    const result = await writeValue(request, deps)
    const [, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(written.split("\n").every((line) => line.length <= 80)).toBe(true)
    expect(written).toContain("- [x] ./a.ts#1-1 hunk")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })
})
