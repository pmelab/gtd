import { describe, expect, it, vi } from "vitest"
import type { RunInWorktree, SpawnOutcome } from "./Beat.js"
import { type DiffDeps, parseUnifiedDiff, resolveDiff, selectHunks, sliceHunk } from "./Diff.js"

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

/** A two-hunk unified diff on `src/a.ts`: hunk 1 is lines 3-5 post-image, hunk 2 is lines 10-11 — the gap (lines 6-9) is unchanged context git elides, so a pointer landing there matches no hunk. */ // gtd-path-exempt: illustrative fixture path, not a repo file
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

/** Two hunks with ADJACENT post-image ranges (2-4 then 5-6, no gap) — unlike `TWO_HUNK_DIFF`'s gapped pair, a range straddling the boundary must return both. */
const ADJACENT_TWO_HUNK_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -2,3 +2,3 @@",
  " context",
  "-old",
  "+new one",
  "+new two",
  "@@ -5,2 +5,2 @@",
  "+new three",
  "+new four",
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

  it("defaults newLines to 1 when the header OMITS the count entirely (the `@@ -1 +5 @@` one-line-range form) — never NaN", () => {
    const ONE_LINE_RANGE_DIFF = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +5 @@",
      "-old",
      "+new",
      "",
    ].join("\n")
    const diff = parseUnifiedDiff("src/a.ts", ONE_LINE_RANGE_DIFF)
    expect(diff.hunks[0]).toMatchObject({ newStart: 5, newLines: 1 })
    expect(selectHunks(diff, 5, 5)).toEqual([diff.hunks[0]])
  })

  it("never appends a SECOND file's own preamble (---/+++) into the FIRST file's last hunk, when a pointer matches more than one file", () => {
    // `--- a/b.ts`/`+++ b/b.ts` are indistinguishable from a real `-`/`+`
    // diff LINE by leading character alone — only the `diff --git` boundary
    // between the two files tells them apart.
    const MULTI_FILE_DIFF = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "index 3333333..4444444 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,1 +1,1 @@",
      "-old two",
      "+new two",
      "",
    ].join("\n")
    const diff = parseUnifiedDiff("src", MULTI_FILE_DIFF)
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks[0]!.lines).toEqual(["-old", "+new"])
    expect(diff.hunks[1]!.lines).toEqual(["-old two", "+new two"])
  })
})

describe("selectHunks", () => {
  const gapped = parseUnifiedDiff("src/a.ts", TWO_HUNK_DIFF)
  const adjacent = parseUnifiedDiff("src/a.ts", ADJACENT_TWO_HUNK_DIFF)

  it("returns exactly the one hunk a range falls wholly inside", () => {
    expect(selectHunks(gapped, 3, 3)).toEqual([gapped.hunks[0]])
  })

  it("returns both hunks, in document order, for a range straddling two adjacent hunks", () => {
    expect(selectHunks(adjacent, 4, 5)).toEqual([adjacent.hunks[0], adjacent.hunks[1]])
  })

  it("returns the one hunk a range starts inside, when the range ends in untouched context below it", () => {
    // Hunk 0 spans 2-4, hunk 1 spans 10-11 — 3-7 starts inside hunk 0 and
    // ends in the gap, never reaching hunk 1.
    expect(selectHunks(gapped, 3, 7)).toEqual([gapped.hunks[0]])
  })

  it("returns an empty list when the range overlaps no hunk at all", () => {
    expect(selectHunks(gapped, 6, 9)).toEqual([])
  })

  it("returns an empty list for an INVERTED range (end < start) — a hand-written pointer with its two numbers transposed — even against a hunk wide enough to span both numbers", () => {
    const wide = parseUnifiedDiff(
      "a.ts",
      [
        "diff --git a/a.ts b/a.ts",
        "index 1111111..2222222 100644",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1,100 +1,100 @@",
        ...Array.from({ length: 100 }, (_, i) => `+line${i + 1}`),
        "",
      ].join("\n"),
    )
    expect(selectHunks(wide, 70, 42)).toEqual([])
  })

  it("never returns a newLines === 0 hunk, for any range, including one whose start equals that hunk's own newStart", () => {
    const MID_FILE_DELETION_DIFF = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,2 +4,0 @@",
      "-deleted line one",
      "-deleted line two",
      "",
    ].join("\n")
    const diff = parseUnifiedDiff("src/a.ts", MID_FILE_DELETION_DIFF)
    expect(diff.hunks[0]).toMatchObject({ newStart: 4, newLines: 0 })
    expect(selectHunks(diff, 4, 4)).toEqual([])
    expect(selectHunks(diff, 1, 10)).toEqual([])
  })
})

describe("sliceHunk", () => {
  /** A single 400-line hunk for a brand-new file: `+line1` through `+line400`. */
  const NEW_FILE_HUNK = {
    header: "@@ -0,0 +1,400 @@",
    newStart: 1,
    newLines: 400,
    lines: Array.from({ length: 400 }, (_, i) => `+line${i + 1}`),
  }

  it("slices a 400-line single-hunk new-file diff to 42-53 into exactly 18 body lines: 12 in range plus 3 above and 3 below", () => {
    const sliced = sliceHunk(NEW_FILE_HUNK, 42, 53)
    expect(sliced.lines).toHaveLength(18)
    expect(sliced.lines[0]).toBe("+line39")
    expect(sliced.lines[17]).toBe("+line56")
  })

  /**
   * A 20-line context-only hunk with a single `-gone` deletion spliced in
   * right before post-image line 10 (so `-gone` itself sits AT position 10,
   * same as the ` line10` that follows it) — 20 lines gives enough padding
   * either side of any mid-hunk range that the `[start - 3, end + 3]`
   * widening never reaches the hunk's own clamp, isolating the window math
   * this fixture is meant to exercise.
   */
  const contextHunkWithDeletionAt10 = () => {
    const lines: string[] = []
    for (let n = 1; n <= 20; n++) {
      if (n === 10) lines.push("-gone")
      lines.push(` line${n}`)
    }
    return { header: "@@ -1,21 +1,20 @@", newStart: 1, newLines: 20, lines }
  }

  it("keeps a `-` line whose position falls inside the window", () => {
    const sliced = sliceHunk(contextHunkWithDeletionAt10(), 10, 10)
    // Window is [7, 13]: "-gone" sits at position 10, inside it.
    expect(sliced.lines).toContain("-gone")
    expect(sliced.lines).toEqual([
      " line7",
      " line8",
      " line9",
      "-gone",
      " line10",
      " line11",
      " line12",
      " line13",
    ])
  })

  it("drops a `-` line whose position falls outside the window", () => {
    const sliced = sliceHunk(contextHunkWithDeletionAt10(), 17, 17)
    // Window is [14, 20]: position 10 ("-gone") is well outside it.
    expect(sliced.lines).not.toContain("-gone")
  })

  it("keeps a `-` line at the very END of a hunk, for a range spanning the whole hunk — the real shape git emits for an end-of-file deletion", () => {
    // Verified against real git: `printf 'a\nb\nc\nd\n'` committed, then
    // truncated to `a\nb`, emits `@@ -1,4 +1,2 @@` with `c`/`d` as trailing
    // `-` lines. Post-image lines 3/4 don't exist, so 1-2 is the only range
    // a pointer can ever name here — trailing deletions must survive it.
    const hunk = {
      header: "@@ -1,4 +1,2 @@",
      newStart: 1,
      newLines: 2,
      lines: [" a", " b", "-c", "-d"],
    }
    const sliced = sliceHunk(hunk, 1, 2)
    expect(sliced.lines).toEqual([" a", " b", "-c", "-d"])
  })

  it("does not let a `\\ No newline at end of file` marker advance the post-image counter, so the line after it keeps its correct number", () => {
    // If the marker wrongly advanced the counter, every line from " l2"
    // onward would carry a number one too high, pushing " l5" (the hunk's
    // real last post-image line, number 5) past the window's own clamp at
    // the hunk's end and dropping it from the slice.
    const hunk = {
      header: "@@ -1,2 +1,5 @@",
      newStart: 1,
      newLines: 5,
      lines: [" l1", "\\ No newline at end of file", " l2", " l3", " l4", " l5"],
    }
    const sliced = sliceHunk(hunk, 5, 5)
    expect(sliced.lines[sliced.lines.length - 1]).toBe(" l5")
  })

  it("yields zero context lines above a range starting at post-image line 1 — never a negative index or a line borrowed from another hunk", () => {
    const sliced = sliceHunk(NEW_FILE_HUNK, 1, 5)
    expect(sliced.lines[0]).toBe("+line1")
    expect(sliced.lines).toHaveLength(8) // 5 in range + 3 below
  })

  it("yields zero context lines below a range ending at the hunk's last post-image line", () => {
    const sliced = sliceHunk(NEW_FILE_HUNK, 396, 400)
    expect(sliced.lines[sliced.lines.length - 1]).toBe("+line400")
    expect(sliced.lines).toHaveLength(8) // 3 above + 5 in range
  })

  it("carries the original hunk's header string byte for byte", () => {
    const sliced = sliceHunk(NEW_FILE_HUNK, 42, 53)
    expect(sliced.header).toBe(NEW_FILE_HUNK.header)
  })
})

describe("resolveDiff", () => {
  it("refuses a path that escapes the worktree root — before either gtd base or git diff ever runs", async () => {
    const { run, calls } = fakeRun(ok(TWO_HUNK_DIFF))
    const result = await resolveDiff(WORKTREE, "../../../etc/passwd", 3, 3, { run })
    expect(result).toEqual({ kind: "refused", detail: "path escapes the served worktree" })
    expect(calls).toEqual([])
  })

  it("selects exactly the hunk containing the pointed-at range", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 3, 3, deps(ok(TWO_HUNK_DIFF)))
    expect(result.kind).toBe("hunk")
    if (result.kind !== "hunk") throw new Error("expected hunk")
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0]!.newStart).toBe(2)
  })

  it("returns kind: hunk with a two-element hunks list for a range spanning two hunks", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 4, 5, deps(ok(ADJACENT_TWO_HUNK_DIFF)))
    expect(result.kind).toBe("hunk")
    if (result.kind !== "hunk") throw new Error("expected hunk")
    expect(result.hunks).toHaveLength(2)
  })

  it("falls back to whole-file with reason no-hunk-match when the range falls between two hunks, and diff.hunks is non-empty", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 6, 9, deps(ok(TWO_HUNK_DIFF)))
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-hunk-match" })
    if (result.kind !== "whole-file") throw new Error("expected whole-file")
    expect(result.diff.hunks).toHaveLength(2)
  })

  it("falls back to whole-file with reason no-hunk-match for an INVERTED range (`#70-42`) — never kind: hunk with a zero-line body, even against a hunk wide enough to span both numbers", async () => {
    const WIDE_ADDITIONS_DIFF = [
      "diff --git a/a.ts b/a.ts",
      "index 1111111..2222222 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,100 +1,100 @@",
      ...Array.from({ length: 100 }, (_, i) => `+line${i + 1}`),
      "",
    ].join("\n")
    const result = await resolveDiff(WORKTREE, "a.ts", 70, 42, deps(ok(WIDE_ADDITIONS_DIFF)))
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-hunk-match" })
  })

  it("falls back to whole-file with reason no-line when no line number is given", async () => {
    const result = await resolveDiff(
      WORKTREE,
      "src/a.ts",
      undefined,
      undefined,
      deps(ok(TWO_HUNK_DIFF)),
    )
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-line" })
  })

  it("falls back to whole-file with reason no-line when a line is given but no endLine", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 3, undefined, deps(ok(TWO_HUNK_DIFF)))
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-line" })
  })

  it("treats a `#0` pointer (a bare path parses to line 0) the SAME as no line number at all — never a hunk selection", async () => {
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
    const result = await resolveDiff(WORKTREE, "src/gone.ts", 0, 0, deps(ok(DELETED_DIFF)))
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-line" })
  })

  it("a range against a pure-deletion pointer (newLines: 0) returns whole-file with reason no-hunk-match, never an empty body", async () => {
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
    const result = await resolveDiff(WORKTREE, "src/gone.ts", 4, 4, deps(ok(DELETED_DIFF)))
    expect(result).toMatchObject({ kind: "whole-file", reason: "no-hunk-match" })
    if (result.kind !== "whole-file") throw new Error("expected whole-file")
    expect(result.diff.hunks).toHaveLength(1)
  })

  it("selects the hunk at the first line of its post-image range, not the previous hunk", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 2, 2, deps(ok(TWO_HUNK_DIFF)))
    expect(result.kind).toBe("hunk")
    if (result.kind !== "hunk") throw new Error("expected hunk")
    expect(result.hunks[0]!.newStart).toBe(2)
  })

  it("selects the hunk at the last line of its post-image range, not the next hunk", async () => {
    const result = await resolveDiff(WORKTREE, "src/a.ts", 4, 4, deps(ok(TWO_HUNK_DIFF)))
    expect(result.kind).toBe("hunk")
    if (result.kind !== "hunk") throw new Error("expected hunk")
    expect(result.hunks[0]!.newStart).toBe(2)

    const next = await resolveDiff(WORKTREE, "src/a.ts", 5, 5, deps(ok(TWO_HUNK_DIFF)))
    expect(next).toMatchObject({ kind: "whole-file", reason: "no-hunk-match" })
  })

  it("the command spawned drops HEAD and diffs base against the working tree", async () => {
    const { run, calls } = fakeRun(ok(TWO_HUNK_DIFF))
    await resolveDiff(WORKTREE, "src/a.ts", 3, 3, { run })
    const diffCall = calls.find((c) => c.startsWith("git diff"))
    expect(diffCall).toBe(`git diff '${BASE}' -- 'src/a.ts'`)
  })

  it("a path whose only change is uncommitted now resolves to a hunk, where git diff base HEAD previously returned no-changes", async () => {
    const UNCOMMITTED_DIFF = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n")
    const result = await resolveDiff(WORKTREE, "src/a.ts", 1, 1, deps(ok(UNCOMMITTED_DIFF)))
    expect(result.kind).toBe("hunk")
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
    const result = await resolveDiff(WORKTREE, HASH_PATH, 1, 1, { run })
    expect(result.kind).toBe("hunk")
    const diffCall = calls.find((c) => c.startsWith("git diff"))
    expect(diffCall).toBe(`git diff '${BASE}' -- 'src/weird#name.ts'`)
  })

  it("single-quotes gtd base's own stdout before interpolating it into git diff — a compromised base never reaches the shell unescaped", async () => {
    const maliciousBase = "$(touch PWNED_MARKER)"
    const { run, calls } = fakeRun(ok(""), ok(`${maliciousBase}\n`))
    await resolveDiff(WORKTREE, "src/a.ts", 1, 1, { run })
    const diffCall = calls.find((c) => c.startsWith("git diff"))
    expect(diffCall).toBe(`git diff '${maliciousBase}' -- 'src/a.ts'`)
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
    const result = await resolveDiff(
      WORKTREE,
      "src/new.ts",
      undefined,
      undefined,
      deps(ok(ADDED_DIFF)),
    )
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
    const result = await resolveDiff(
      WORKTREE,
      "src/gone.ts",
      undefined,
      undefined,
      deps(ok(DELETED_DIFF)),
    )
    expect(result.kind).toBe("whole-file")
    if (result.kind !== "whole-file") throw new Error("expected whole-file")
    expect(result.diff.hunks).toHaveLength(1)
    expect(result.diff.hunks[0]!.newStart).toBe(0)
    expect(result.diff.hunks[0]!.newLines).toBe(0)
  })

  it("renders a binary file as a stated placeholder, not an attempt to parse it as text", async () => {
    const BINARY_OUTPUT =
      "diff --git a/image.png b/image.png\nindex 1111111..2222222 100644\nBinary files a/image.png and b/image.png differ\n"
    const result = await resolveDiff(
      WORKTREE,
      "image.png",
      undefined,
      undefined,
      deps(ok(BINARY_OUTPUT)),
    )
    expect(result).toEqual({ kind: "binary" })
  })

  it("returns its own stated 'no-changes' result for a path with NOTHING in the range — a stale/renamed/moved pointer, or a path with no working-tree diff at all — never `whole-file` with an empty body", async () => {
    const result = await resolveDiff(WORKTREE, "old/path.ts", 1, 1, deps(ok("")))
    expect(result).toEqual({ kind: "no-changes" })
  })

  it("returns 'no-changes' regardless of whether a line number was given at all", async () => {
    const result = await resolveDiff(WORKTREE, "old/path.ts", undefined, undefined, deps(ok("")))
    expect(result).toEqual({ kind: "no-changes" })
  })

  it("never misclassifies a TEXT diff as binary just because an added/removed line's own content contains the binary sentence", async () => {
    // Reviewing gtd's own Diff.test.ts (this very file) is the self-inflicting
    // case a substring-only match hit: an added line literally spells out
    // "Binary files a/image.png and b/image.png differ" as a string literal,
    // but the diff line itself is `+`-prefixed, has real hunks, and must
    // render as a normal text diff.
    const TEXT_DIFF_MENTIONING_BINARY = [
      "diff --git a/src/ui/Diff.test.ts b/src/ui/Diff.test.ts",
      "index 1111111..2222222 100644",
      "--- a/src/ui/Diff.test.ts",
      "+++ b/src/ui/Diff.test.ts",
      "@@ -1,1 +1,2 @@",
      " const BINARY_OUTPUT =",
      '+  "Binary files a/image.png and b/image.png differ"',
      "",
    ].join("\n")
    const result = await resolveDiff(
      WORKTREE,
      "src/ui/Diff.test.ts",
      1,
      1,
      deps(ok(TEXT_DIFF_MENTIONING_BINARY)),
    )
    expect(result.kind).toBe("hunk")
  })

  it("surfaces gtd base refusing at exit 1 as a named refusal, not an empty result", async () => {
    const baseRefusal = fail(1, "gtd base: refused — no process is underway at HEAD")
    const result = await resolveDiff(
      WORKTREE,
      "src/a.ts",
      1,
      1,
      deps(ok(TWO_HUNK_DIFF), baseRefusal),
    )
    expect(result.kind).toBe("refused")
    if (result.kind !== "refused") throw new Error("expected refused")
    expect(result.detail).toContain("no process is underway")
  })

  it("surfaces a git diff spawn failure as a named refusal", async () => {
    const run: RunInWorktree = vi.fn(async (_cwd, command) => {
      if (command === "gtd base") return ok(`${BASE}\n`)
      return { status: null, stdout: "", stderr: "", spawnError: "spawn git ENOENT" }
    })
    const result = await resolveDiff(WORKTREE, "src/a.ts", 1, 1, { run })
    expect(result).toEqual({ kind: "refused", detail: "spawn git ENOENT" })
  })
})
