import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { steeringFormatFor } from "../steering/index.js"
import {
  applySteeringEdits,
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
/** Shorthand for a `readFile` double returning `absent` — a mode-less file gtd hasn't written yet. */
const absent = (): Promise<ReadFileResult> => Promise.resolve({ kind: "absent" })

const REVIEW_FORMAT = steeringFormatFor("review")!

const WORKTREE = "/repo"
const FILE = ".gtd/REVIEW.md"
const CONTENT = [
  "# Review: abc1234",
  "<!-- base: abc1234def5678901234567890123456789abcd -->",
  "",
  "## Chunk",
  "",
  "- [ ] ./a.ts#1 hunk",
  "",
].join("\n")

/** A `qa`-mode fixture with an unfilled free-text slot — the LAST option — used only by the `checked`+`text` combined-write test below. */
const QA_CONTENT = [
  "Sample plan.",
  "",
  "## Open Questions",
  "",
  "### Which option?",
  "",
  "- [ ] Option A",
  "- [ ] _your answer_",
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
  mode: "review",
  anchor: { kind: "chunk" as const, index: 0 },
  text: "a note a human typed",
})

const baseValueRequest = () => ({
  worktreePath: WORKTREE,
  filePath: FILE,
  expectedHeadSha: "sha1",
  expectedContentHash: contentHashOf(CONTENT),
  mode: "review",
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

describe("applySteeringEdits", () => {
  it("splices edits back-to-front so earlier offsets stay valid", () => {
    const content = "abc\ndef\n"
    const edits = [
      {
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
        newText: "X",
      },
      {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
        newText: "Y",
      },
    ]
    expect(applySteeringEdits(content, edits)).toBe("aXbc\nYdef\n")
  })
})

describe("writeNote", () => {
  it("succeeds when the sha and content hash both match, and the worktree rests with a human", async () => {
    const deps = fakeDeps()
    const result = await writeNote(baseRequest(), deps)
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    const [absPath, written] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(absPath).toBe("/repo/.gtd/REVIEW.md")
    expect(written).toContain("[^na")
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
    const withTrailingSpace = CONTENT.replace("## Chunk", "## Chunk ")
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

  it("a served file absent at write time (a mode-less file gtd hasn't written yet) is treated as empty, not vanished — the anchor still has to resolve against that empty document", async () => {
    const deps = fakeDeps({ readFile: vi.fn(() => absent()) })
    const request = {
      ...baseRequest(),
      mode: undefined,
      expectedContentHash: contentHashOf(""),
      anchor: { kind: "paragraph" as const, line: 0 },
    }
    // An empty document has no block at line 0 for `annotate` to attach a
    // footnote to — free-form's `anchor-not-found`, never `file-vanished`.
    // Proves `verifyForWrite` got past the "file exists?" question at all.
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
    const request = { ...baseRequest(), anchor: { kind: "chunk" as const, index: 99 } }
    expect(await writeNote(request, deps)).toEqual({ ok: false, reason: "anchor-unresolved" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("an unregistered mode falls back to free-form, which only resolves a paragraph anchor — a chunk anchor refuses anchor-unresolved, not a distinct unsupported-mode reason", async () => {
    const deps = fakeDeps()
    const request = { ...baseRequest(), mode: "not-a-real-mode" }
    expect(await writeNote(request, deps)).toEqual({ ok: false, reason: "anchor-unresolved" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("an absent mode falls back to free-form the same way — a paragraph anchor succeeds", async () => {
    const deps = fakeDeps()
    const request = {
      ...baseRequest(),
      mode: undefined,
      anchor: { kind: "paragraph" as const, line: 0 },
    }
    const result = await writeNote(request, deps)
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    const [, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("writing a SECOND note at an anchor that already has one EDITS it in place, rather than refusing (T6: 'offers editing it, not a second note')", async () => {
    // Attach a note to the chunk anchor for REAL first (via the same
    // `REVIEW_FORMAT.annotate` `writeNote` itself delegates to), so the
    // derived id involved is the format's own, never a guessed literal.
    const firstAttach = REVIEW_FORMAT.annotate(CONTENT, { kind: "chunk", index: 0 }, "first note")
    expect(firstAttach.ok).toBe(true)
    if (!firstAttach.ok) return
    const alreadyNotedContent = applySteeringEdits(CONTENT, firstAttach.edits)

    const deps = fakeDeps({
      readFile: vi.fn(() => content(alreadyNotedContent)),
      writeFile: vi.fn(async () => undefined),
    })
    const request = {
      ...baseRequest(),
      expectedContentHash: contentHashOf(alreadyNotedContent),
      anchor: { kind: "chunk" as const, index: 0 },
      text: "edited note",
    }
    const result = await writeNote(request, deps)
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    const [, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
    expect(written).toContain("edited note")
    expect(written).not.toContain("first note")
    // Still exactly one definition — an edit, never a second attach.
    expect(REVIEW_FORMAT.validate(written)).toEqual([])
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
      anchor: { kind: "chunk" as const, index: 0 },
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
    expect(absPath).toBe("/repo/.gtd/REVIEW.md")
    expect(written).toContain("- [x] ./a.ts#1 hunk")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("commits checked and text together in ONE call for a qa free-text slot, landing the label change in the written bytes", async () => {
    const deps = fakeDeps({ readFile: vi.fn(() => content(QA_CONTENT)) })
    const request = {
      worktreePath: WORKTREE,
      filePath: FILE,
      expectedHeadSha: "sha1",
      expectedContentHash: contentHashOf(QA_CONTENT),
      mode: "qa",
      // The free-text slot is always the LAST option (`OpenQuestions.ts`'s
      // own positional convention) — index 1 here, the second of two.
      anchor: { kind: "option" as const, questionIndex: 0, index: 1 },
      checked: true,
      text: "worth flagging",
    }
    const result = await writeValue(request, deps)
    const [, written] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(written).toContain("[x] worth flagging")
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
      mode: undefined,
      anchor: { kind: "paragraph" as const, line: 0 },
      text: "first line ever written",
    }
    const result = await writeValue(request, deps)
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    const [absPath, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(absPath).toBe("/repo/.gtd/REVIEW.md")
    expect(written).toContain("first line ever written")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("liveWriteFile creates the containing directory, real on-disk, when a worktree's .gtd/ doesn't exist yet — the exact shape a mode-less file's first write hits", async () => {
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
        mode: undefined,
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

  it("an unregistered mode falls back to free-form, which only resolves a paragraph anchor — a hunk anchor refuses anchor-unresolved", async () => {
    const deps = fakeDeps()
    const request = { ...baseValueRequest(), mode: "not-a-real-mode" }
    expect(await writeValue(request, deps)).toEqual({ ok: false, reason: "anchor-unresolved" })
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it("a chunk anchor ticks every hunk beneath it in one write", async () => {
    const nestedContent = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1 outer hunk",
      "  - [ ] ./b.ts#2 nested hunk",
      "",
    ].join("\n")
    const deps = fakeDeps({ readFile: vi.fn(() => content(nestedContent)) })
    const request = {
      ...baseValueRequest(),
      expectedContentHash: contentHashOf(nestedContent),
      anchor: { kind: "chunk" as const, index: 0 },
      checked: true,
    }
    const result = await writeValue(request, deps)
    const [, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(written).toContain("- [x] ./a.ts#1 outer hunk")
    expect(written).toContain("- [x] ./b.ts#2 nested hunk")
    expect(REVIEW_FORMAT.validate(written)).toEqual([])
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })
})

describe("writeValue — ui.format's post-write formatCommand", () => {
  /** A `deps.formatCommand` fake wired to a mutable in-memory "disk" — `stored` starts as whatever `writeFile` last wrote, and `formatCommand` mutates it to simulate a formatter rewriting the file in place. */
  const withFormatter = (
    onFormat: (current: string) => string,
    outcome: { readonly ok: boolean; readonly exitCode: number | null },
  ): { readonly deps: WriteDeps; readonly diskAfter: () => string } => {
    let stored = CONTENT
    const deps: WriteDeps = {
      headSha: async () => "sha1",
      actorAt: async () => "human",
      readFile: async () => content(stored),
      writeFile: async (_path, content) => {
        stored = content
      },
      formatCommand: async () => {
        stored = onFormat(stored)
        return { ok: outcome.ok, command: "npx oxfmt --write x", exitCode: outcome.exitCode }
      },
    }
    return { deps, diskAfter: () => stored }
  }

  it("runs formatCommand AFTER writeFile and BEFORE the mutation resolves, and the resolved contentHash reflects the post-format bytes on disk, not the pre-format ones", async () => {
    const { deps, diskAfter } = withFormatter((current) => `${current}<!-- formatted -->\n`, {
      ok: true,
      exitCode: 0,
    })
    const request = { ...baseValueRequest(), expectedContentHash: contentHashOf(CONTENT) }
    const result = await writeValue(request, deps)
    const onDisk = diskAfter()
    expect(onDisk).toContain("<!-- formatted -->")
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(onDisk) })
  })

  it("finishWrite's post-format re-read is not hardened: an unreadable re-read falls back to hashing nextContent and still returns success", async () => {
    // The FIRST readFile call is `verifyForWrite`'s own — real content, so the
    // compare-and-swap passes. The SECOND is `finishWrite`'s post-format
    // re-read, which comes back unreadable and must fall back to `nextContent`
    // rather than turn into a refusal after the bytes already landed.
    let calls = 0
    const readFile: WriteDeps["readFile"] = async () => {
      calls += 1
      return calls === 1 ? { kind: "content", content: CONTENT } : { kind: "unreadable" }
    }
    const writeFile = vi.fn<WriteDeps["writeFile"]>(async () => undefined)
    const deps: WriteDeps = {
      headSha: async () => "sha1",
      actorAt: async () => "human",
      readFile,
      writeFile,
      formatCommand: async () => ({ ok: true, command: "npx oxfmt --write x", exitCode: 0 }),
    }
    const request = { ...baseValueRequest(), expectedContentHash: contentHashOf(CONTENT) }
    const result = await writeValue(request, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [, written] = writeFile.mock.calls[0]!
    expect(result.contentHash).toBe(contentHashOf(written))
  })

  it("unset ui.format (no formatCommand on deps) spawns no command at all — contentHash is just the pre-format bytes' own hash", async () => {
    const deps = fakeDeps()
    const result = await writeValue(baseValueRequest(), deps)
    const [, written] = vi.mocked(deps.writeFile).mock.calls[0]!
    expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
  })

  it("a non-zero formatCommand exit leaves the written bytes on disk, resolves ok, and reports a formatNotice naming the command and exit code — never a refusal", async () => {
    const { deps, diskAfter } = withFormatter((current) => current, { ok: false, exitCode: 1 })
    const request = { ...baseValueRequest(), expectedContentHash: contentHashOf(CONTENT) }
    const result = await writeValue(request, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.formatNotice).toEqual({ command: "npx oxfmt --write x", exitCode: 1 })
    expect(result.contentHash).toBe(contentHashOf(diskAfter()))
  })

  it("a missing formatter binary (no exit code at all) surfaces the same formatNotice shape with a null exitCode, never reverting or refusing", async () => {
    const { deps } = withFormatter((current) => current, { ok: false, exitCode: null })
    const request = { ...baseValueRequest(), expectedContentHash: contentHashOf(CONTENT) }
    const result = await writeValue(request, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.formatNotice).toEqual({ command: "npx oxfmt --write x", exitCode: null })
  })

  it("a formatCommand that THROWS (defense-in-depth alongside Server.ts#buildFormatCommand's own catch) still resolves ok with a formatNotice, never rejecting the mutation after the bytes already landed", async () => {
    const deps: WriteDeps = {
      headSha: async () => "sha1",
      actorAt: async () => "human",
      readFile: async () => content(CONTENT),
      writeFile: async () => {},
      formatCommand: async () => {
        throw new Error("boom")
      },
    }
    const request = { ...baseValueRequest(), expectedContentHash: contentHashOf(CONTENT) }
    const result = await writeValue(request, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.formatNotice?.exitCode).toBeNull()
  })
})
