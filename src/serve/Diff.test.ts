import { describe, expect, it, vi } from "vitest"
import type { RunInWorktree, SpawnOutcome } from "./Beat.js"
import { type DiffDeps, parseUnifiedDiff, resolveDiff, selectHunk } from "./Diff.js"

const WORKTREE = "/repo"
const BASE = "abc1234def5678901234567890123456789abcd"

const ok = (stdout: string, stderr = ""): SpawnOutcome => ({ status: 0, stdout, stderr })
const fail = (status: number, stderr: string): SpawnOutcome => ({ status, stdout: "", stderr })

/**
 * Fakes `gtd base` and `git diff` by matching on the command string — the
 * only two commands `resolveDiff` ever runs — so tests never spawn a real
 * process. `diffOutcome` is returned for ANY `git diff` call, letting a test
 * assert on the command string it was invoked with when needed.
 */
const fakeRun = (
  diffOutcome: SpawnOutcome,
  baseOutcome: SpawnOutcome = ok(`${BASE}\n`),
): { run: RunInWorktree; calls: string[] } => {
  const calls: string[] = []
  const run: RunInWorktree = async (_cwd, command) => {
    calls.push(command)
    if (command === "gtd base") return baseOutcome
    return diffOutcome
  }
  return { run, calls }
}

const deps = (diffOutcome: SpawnOutcome, baseOutcome?: SpawnOutcome): DiffDeps => {
  const { run } = fakeRun(diffOutcome, baseOutcome)
  return { run }
}

/** A two-hunk unified diff on `src/a.ts`: hunk 1 is lines 3-5 post-image, hunk 2 is lines 10-11 — the gap (lines 6-9) is unchanged context git elides, so a pointer landing there matches no hunk. */
const TWO_HUNK_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -2,3 +2,3 @@",
  " context before",
  "-old line",
  "+new line one",
  "+new line two",
  "@@ -8,1 +10,2 @@",
  " context",
  "+added at end",
  "",
].join("\n")

describe("parseUnifiedDiff", () => {
  it("parses hunk headers into post-image ranges plus their body lines", () => {
    const diff = parseUnifiedDiff("src/a.ts", TWO_HUNK_DIFF)
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks[0]).toMatchObject({ newStart: 2, newLines: 3 })
    expect(diff.hunks[0]!.lines).toEqual([
      " context before",
      "-old line",
      "+new line one",
      "+new line two",
    ])
    expect(diff.hunks[1]).toMatchObject({ newStart: 10, newLines: 2 })
  })
})

describe("selectHunk", () => {
  const diff = parseUnifiedDiff("src/a.ts", TWO_HUNK_DIFF)

  it("selects the hunk whose post-image range contains the line", () => {
    expect(selectHunk(diff, 3)).toBe(diff.hunks[0])
  })

  it("selects neither hunk when the line falls in the gap between them", () => {
    expect(selectHunk(diff, 7)).toBeUndefined()
  })

  it("selects the hunk at its first post-image line, not the previous hunk", () => {
    // Hunk 0 spans 2-4; line 2 is its first line and must not fall through
    // to "no match" or to some earlier hunk.
    expect(selectHunk(diff, 2)).toBe(diff.hunks[0])
  })

  it("selects the hunk at its last post-image line, not the next hunk", () => {
    // Hunk 0 spans 2-4; line 4 is its last line and must not select hunk 1.
    expect(selectHunk(diff, 4)).toBe(diff.hunks[0])
    expect(selectHunk(diff, 5)).toBeUndefined()
  })

  it("returns undefined for no line number", () => {
    expect(selectHunk(diff, undefined)).toBeUndefined()
  })
})

describe("resolveDiff", () => {
  it("selects exactly the hunk containing the pointed-at line", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 3, deps(ok(TWO_HUNK_DIFF)))
    expect(result.kind).toBe("hunk")
    if (result.kind !== "hunk") throw new Error("expected hunk")
    expect(result.hunk.newStart).toBe(2)
  })

  it("falls back to whole-file when the line falls between two hunks", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 7, deps(ok(TWO_HUNK_DIFF)))
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-hunk-match" })
    if (result.kind !== "whole-file") throw new Error("expected whole-file")
    expect(result.diff.hunks).toHaveLength(2)
  })

  it("falls back to whole-file when no line number is given", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", undefined, deps(ok(TWO_HUNK_DIFF)))
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-line" })
  })

  it("selects the hunk at the first line of its post-image range, not the previous hunk", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 2, deps(ok(TWO_HUNK_DIFF)))
    expect(result.kind).toBe("hunk")
    if (result.kind !== "hunk") throw new Error("expected hunk")
    expect(result.hunk.newStart).toBe(2)
  })

  it("selects the hunk at the last line of its post-image range, not the next hunk", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 4, deps(ok(TWO_HUNK_DIFF)))
    expect(result.kind).toBe("hunk")
    if (result.kind !== "hunk") throw new Error("expected hunk")
    expect(result.hunk.newStart).toBe(2)

    const next = await resolveDiff(WORKTREE, "src/a.ts", 5, deps(ok(TWO_HUNK_DIFF)))
    expect(next).toMatchObject({ kind: "whole-file", reason: "no-hunk-match" })
  })

  it("passes a path containing a literal # through unchanged, shell-quoted rather than split on it", async () => {
    const HASH_PATH = "src/weird#name.ts"
    const diffOutcome = ok(
      [
        `diff --git a/${HASH_PATH} b/${HASH_PATH}`,
        "index 1111111..2222222 100644",
        `--- a/${HASH_PATH}`,
        `+++ b/${HASH_PATH}`,
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    )
    const { run, calls } = fakeRun(diffOutcome)
    const result = await resolveDiff(WORKTREE, HASH_PATH, 1, { run })
    expect(result.kind).toBe("hunk")
    const diffCall = calls.find((c) => c.startsWith("git diff"))
    expect(diffCall).toBe(`git diff ${BASE} -- 'src/weird#name.ts'`)
  })

  it("renders a file added in the range as an all-additions diff", async () => {
    const ADDED_DIFF = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
      "",
    ].join("\n")
    const result = await resolveDiff(WORKTREE, "src/new.ts", undefined, deps(ok(ADDED_DIFF)))
    expect(result.kind).toBe("whole-file")
    if (result.kind !== "whole-file") throw new Error("expected whole-file")
    expect(result.diff.hunks).toHaveLength(1)
    expect(result.diff.hunks[0]!.lines.every((l) => l.startsWith("+"))).toBe(true)
  })

  it("renders a file deleted in the range without crashing", async () => {
    const DELETED_DIFF = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line one",
      "-line two",
      "",
    ].join("\n")
    const result = await resolveDiff(WORKTREE, "src/gone.ts", undefined, deps(ok(DELETED_DIFF)))
    expect(result.kind).toBe("whole-file")
    if (result.kind !== "whole-file") throw new Error("expected whole-file")
    expect(result.diff.hunks).toHaveLength(1)
    expect(result.diff.hunks[0]!.newStart).toBe(0)
    expect(result.diff.hunks[0]!.newLines).toBe(0)
  })

  it("a line pointer against a pure-deletion hunk matches only its insertion point", async () => {
    const DELETED_DIFF = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line one",
      "-line two",
      "",
    ].join("\n")
    const diff = parseUnifiedDiff("src/gone.ts", DELETED_DIFF)
    expect(selectHunk(diff, 0)).toBe(diff.hunks[0])
  })

  it("renders a binary file as a stated placeholder, not an attempt to parse it as text", async () => {
    const BINARY_OUTPUT =
      "diff --git a/image.png b/image.png\nindex 1111111..2222222 100644\nBinary files a/image.png and b/image.png differ\n"
    const result = await resolveDiff(WORKTREE, "image.png", undefined, deps(ok(BINARY_OUTPUT)))
    expect(result).toEqual({ kind: "binary" })
  })

  it("surfaces gtd base refusing at exit 1 as a named refusal, not an empty result", async () => {
    const baseRefusal = fail(1, "gtd base: refused — no process is underway at HEAD")
    const result = await resolveDiff(WORKTREE, "src/a.ts", 1, deps(ok(TWO_HUNK_DIFF), baseRefusal))
    expect(result.kind).toBe("refused")
    if (result.kind !== "refused") throw new Error("expected refused")
    expect(result.detail).toContain("no process is underway")
  })

  it("surfaces a git diff spawn failure as a named refusal", async () => {
    const run: RunInWorktree = vi.fn(async (_cwd, command) => {
      if (command === "gtd base") return ok(`${BASE}\n`)
      return { status: null, stdout: "", stderr: "", spawnError: "spawn git ENOENT" }
    })
    const result = await resolveDiff(WORKTREE, "src/a.ts", 1, { run })
    expect(result).toEqual({ kind: "refused", detail: "spawn git ENOENT" })
  })
})
