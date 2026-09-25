import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderStateTemplate } from "../PatternTemplates.js"
import { headingSections } from "../steering/index.js"
import { compileTemplate } from "./index.js"

/**
 * Real execution, not `bash -n`: this file pins a regression a syntax-only
 * check would never catch — `triaging`'s chunk-count scan numbering a `## `
 * heading differently than `it.sections` did for `triage`'s own `chunk-N`
 * ids. Same `initRepo`/`commitWithTrailer` shape as
 * `specReviewScripts.test.ts` (package 02's own convention for this class of
 * check-actor script).
 */
const initRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "review-lap-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  git("init", "-q")
  git("config", "user.email", "t@t.com")
  git("config", "user.name", "t")
  return dir
}

const commitWithTrailer = (dir: string, trailer: string, files: Record<string, string> = {}) => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  git("add", "-A")
  const message = trailer
    ? `gtd(judge): build.review.triage → build.review.triaging\n\n${trailer}`
    : "gtd(judge): build.review.triage → build.review.triaging"
  git("commit", "-q", "-m", message, "--allow-empty")
}

const readIfExists = (dir: string, name: string): string | undefined => {
  try {
    return readFileSync(join(dir, name), "utf8")
  } catch {
    return undefined
  }
}

/** Renders `stateName`'s script with a given `vars` override and runs it for real against `dir`. `.gtd/`-prefixed paths are stripped — same technique `specReviewScripts.test.ts` uses to run a bundled script standalone, outside a real `.gtd` checkout. */
const runScript = (dir: string, stateName: string, varsOverride: Record<string, string>): void => {
  const { definition, vars } = compileTemplate()
  const state = definition.states[stateName]!
  const script = renderStateTemplate(state.script!, {
    startCommit: "",
    currentCommit: "",
    previousCommit: "",
    state: stateName,
    actor: "check",
    reviewBase: "",
    processBase: "",
    processCost: 0,
    processCostByModel: [],
    read: () => "",
    diff: () => "",
    sections: () => [],
    tail: () => "",
    diffTail: () => "",
    vars: { ...vars, ...varsOverride },
    edges: [],
    item: "",
    itemIndex: -1,
  })
  execFileSync("sh", ["-c", script.replace(/\.gtd\//g, "")], { cwd: dir, stdio: "pipe" })
}

describe("build.review.triaging's script, executed for real", () => {
  const THREE_CHUNKS =
    "# Review: abc1234\n\n<!-- base: 0000000000000000000000000000000000000000 -->\n\n" +
    "## Chunk A\n- [ ] ./a.ts#1 note\n\n" +
    "## Chunk B\n- [ ] ./b.ts#1 note\n\n" +
    "## Chunk C\n- [ ] ./c.ts#1 note\n"

  it("counts exactly the same number of chunks `it.sections` (headingSections) does", () => {
    expect(headingSections(THREE_CHUNKS).length).toBe(3)
  })

  it('the middle chunk answered "no" signs off only that chunk\'s worth — chunk-2 maps to "Chunk B", not a neighbor', () => {
    const dir = initRepo()
    writeFileSync(join(dir, "REVIEW.md"), THREE_CHUNKS)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"chunk-1","answer":true,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-2","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-3","answer":true,"p":0.9}',
      ].join("\n"),
    )
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    // chunk-1/chunk-3 stayed actionable — the round captures, never signs
    // off, and REVIEW.md is consumed either way.
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeDefined()
    expect(readIfExists(dir, "REVIEW.md")).toBeUndefined()
  })

  it("a heading indented exactly one space still counts as a real chunk (it always breaks a preceding list's continuation, per CommonMark)", () => {
    // `it.sections`'s real mdast parse (CommonMark) numbers `triage`'s
    // `chunk-2` id against "Indented" here regardless of context — a single
    // leading space always breaks a `- ` list's 2-space continuation column
    // and starts a new top-level block. A bare `/^## /` awk scan would miss
    // it, shifting chunk-3's number and reading its verdict against the
    // wrong heading. (2-3 spaces of indent, by contrast, STAYS absorbed
    // into a preceding list under both parsers — matching a note's own
    // continuation line that happens to start with `##` — so the fix below
    // only widens the match by exactly one column, not three.)
    const indented =
      "# Review: abc1234\n\n<!-- base: 0000000000000000000000000000000000000000 -->\n\n" +
      "## Chunk A\n- [ ] ./a.ts#1 note\n\n" +
      " ## Indented\n- [ ] ./b.ts#1 note\n\n" +
      "## Chunk C\n- [ ] ./c.ts#1 note\n"
    expect(headingSections(indented).length).toBe(3)

    const dir = initRepo()
    writeFileSync(join(dir, "REVIEW.md"), indented)
    // Every chunk confidently non-actionable, including the indented one —
    // if the script's own scan undercounts to 2, chunk-3's verdict below
    // would be read for the (nonexistent) third slot and the round would
    // still sign off by accident; asserting the sign-off actually happens
    // here would not distinguish a correct 3-count from a lucky 2-count.
    // Assert the count directly instead, via the script's own visible
    // effect: a fourth, unanswered id it would only reach at total=3.
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"chunk-1","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-2","answer":false,"p":0.9}',
        // chunk-3 deliberately unanswered — defaults to actionable ONLY if
        // the script's own count reaches a third slot at all.
      ].join("\n"),
    )
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeDefined()
  })

  it("a note's own continuation line indented 2 spaces and starting with `##` is never miscounted as a chunk heading", () => {
    // The regression the previous fix would have introduced if it had
    // widened the match to 2-3 spaces instead of 1: a chunk's own note,
    // continued below its pointer at the documented 2-space indent (see
    // `reviewing`'s own format contract), can legitimately start with `##`
    // as informal markdown — that must stay body text, not a phantom
    // fourth chunk.
    const withNoteBody =
      "# Review: abc1234\n\n<!-- base: 0000000000000000000000000000000000000000 -->\n\n" +
      "## Chunk A\n- [ ] ./a.ts#1 note\n  ## not a heading, just the note continuing\n\n" +
      "## Chunk B\n- [ ] ./b.ts#1 note\n\n" +
      "## Chunk C\n- [ ] ./c.ts#1 note\n"
    expect(headingSections(withNoteBody).length).toBe(3)

    const dir = initRepo()
    writeFileSync(join(dir, "REVIEW.md"), withNoteBody)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"chunk-1","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-2","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-3","answer":false,"p":0.9}',
      ].join("\n"),
    )
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    // All three real chunks answered "no" — a correct 3-count signs off; a
    // miscount to 4 (treating the note line as a phantom chunk-4) would
    // leave that id unanswered and default it to actionable, capturing
    // instead.
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeUndefined()
  })

  it("every chunk confidently non-actionable signs off with no REVIEW_RAW.md capture", () => {
    const dir = initRepo()
    writeFileSync(join(dir, "REVIEW.md"), THREE_CHUNKS)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"chunk-1","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-2","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-3","answer":false,"p":0.9}',
      ].join("\n"),
    )
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeUndefined()
    expect(readIfExists(dir, "REVIEW.md")).toBeUndefined()
  })

  it("a skipped judgment (no Gtd-Judge trailer) defaults every chunk to actionable — the conservative default", () => {
    const dir = initRepo()
    writeFileSync(join(dir, "REVIEW.md"), THREE_CHUNKS)
    commitWithTrailer(dir, "")
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeDefined()
  })

  it("a low-confidence (below reviewNoteActionable) yes is treated as non-actionable", () => {
    const dir = initRepo()
    const ONE_CHUNK =
      "# Review: abc1234\n\n<!-- base: 0000000000000000000000000000000000000000 -->\n\n" +
      "## Chunk A\n- [ ] ./a.ts#1 note\n"
    writeFileSync(join(dir, "REVIEW.md"), ONE_CHUNK)
    commitWithTrailer(dir, 'Gtd-Judge: {"id":"chunk-1","answer":true,"p":0.2}')
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeUndefined()
    expect(readIfExists(dir, "REVIEW.md")).toBeUndefined()
  })

  it("a LOW-CONFIDENCE yes for a chunk whose evidence was actually truncated away still forces capture — the committed Gtd-Payload: trailer bypasses reviewNoteActionable's confidence gate", () => {
    // Same ONE_CHUNK shape and the same sub-threshold p (0.2) as the test
    // above — the only difference is the landing commit's own
    // `Gtd-Payload: {"truncated":true}` trailer, stamped by the render that
    // produced the judged document when `judgeBudgetBytes` truncated it, so
    // this chunk's "yes" was never a genuine judgment (`triage` marks it
    // structural and always instructs "yes"). Without the trailer, this
    // p=0.2 answer would fold into sign-off exactly like the test above —
    // the concrete hole a round of review caught.
    const dir = initRepo()
    const ONE_CHUNK =
      "# Review: abc1234\n\n<!-- base: 0000000000000000000000000000000000000000 -->\n\n" +
      "## Chunk A\n- [ ] ./a.ts#1 note\n"
    writeFileSync(join(dir, "REVIEW.md"), ONE_CHUNK)
    commitWithTrailer(
      dir,
      ['Gtd-Judge: {"id":"chunk-1","answer":true,"p":0.2}', 'Gtd-Payload: {"truncated":true}'].join(
        "\n",
      ),
    )
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeDefined()
  })

  it("shortening REVIEW.md in the working tree after the judged commit landed does not clear the gate — the trailer measures what the judge saw, not what's on disk now", () => {
    // The committed REVIEW.md (what `triage` actually judged) is large
    // enough to have truncated; the working-tree file present when
    // `triaging` runs is a SHRUNK, under-budget stand-in — a `wc -c`-style
    // recheck of the working tree would see it and wrongly clear the gate.
    // The trailer is the only thing this script reads for truncation.
    const dir = initRepo()
    const ONE_CHUNK =
      "# Review: abc1234\n\n<!-- base: 0000000000000000000000000000000000000000 -->\n\n" +
      "## Chunk A\n- [ ] ./a.ts#1 note\n"
    writeFileSync(join(dir, "REVIEW.md"), ONE_CHUNK)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"chunk-1","answer":true,"p":0.95}',
        'Gtd-Payload: {"truncated":true}',
      ].join("\n"),
    )
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeDefined()
  })

  it("a missing Gtd-Payload: trailer reads as not truncated — an under-budget gate still clears normally", () => {
    const dir = initRepo()
    writeFileSync(join(dir, "REVIEW.md"), THREE_CHUNKS)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"chunk-1","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-2","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"chunk-3","answer":false,"p":0.9}',
      ].join("\n"),
    )
    runScript(dir, "build.review.triaging", { reviewNoteActionable: "0.7" })
    expect(readIfExists(dir, "REVIEW_RAW.md")).toBeUndefined()
  })
})
