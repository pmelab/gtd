import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderStateTemplate, type TemplateContext } from "../PatternTemplates.js"
import { compileTemplate } from "./index.js"

/**
 * Real execution, not `bash -n`: `packages.item.spec.scoping`'s script is the
 * whole approve/scope decision (round-3 review), and a syntax-only check
 * would never have caught either regression this file pins — a blank
 * `specPreJudge` clearing every section (fail-APPROVE) and a quoted `"yes"`
 * verdict reading as unanswered. A real temp git repo, not a fake, because
 * the script's own `git log -1 --format=%B HEAD` needs a real commit body.
 */
const initRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "spec-review-scoping-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  git("init", "-q")
  git("config", "user.email", "t@t.com")
  git("config", "user.name", "t")
  return dir
}

const writePackage = (dir: string, body: string): void => {
  writeFileSync(join(dir, "NEXT.md"), "packages/01-widget.md\n")
  mkdirSync(join(dir, "packages"), { recursive: true })
  writeFileSync(join(dir, "packages", "01-widget.md"), body)
}

const commitWithTrailer = (dir: string, trailer: string): void => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  git("add", "-A")
  git(
    "commit",
    "-q",
    "-m",
    `gtd(human): packages.item.spec.pre → packages.item.spec.scoping\n\n${trailer}`,
  )
}

/** Renders `scoping`'s script with a given `specPreJudge` value and runs it for real against `dir`. */
const runScoping = (dir: string, specPreJudge: string): void => {
  const { definition, vars } = compileTemplate()
  const state = definition.states["packages.item.spec.scoping"]!
  const script = renderStateTemplate(state.script!, {
    startCommit: "",
    currentCommit: "",
    previousCommit: "",
    state: "packages.item.spec.scoping",
    actor: "check",
    reviewBase: "",
    processBase: "",
    processCost: 0,
    processCostByModel: [],
    read: () => "",
    sections: () => [],
    openQuestions: () => [],
    openQuestionOptions: () => [],
    vars: { ...vars, specPreJudge },
    edges: [],
  })
  // NEXT.md points at "packages/01-widget.md" (relative to `dir`, the
  // script's own cwd) rather than the real `.gtd/`-prefixed path — this test
  // runs the script standalone, outside a real `.gtd` checkout, and the
  // script itself never hardcodes the `.gtd/` prefix (it only ever reads
  // whatever `.gtd/NEXT.md` names).
  execFileSync("sh", ["-c", script.replace(/\.gtd\//g, "")], { cwd: dir, stdio: "pipe" })
}

const readIfExists = (dir: string, name: string): string | undefined => {
  try {
    return readFileSync(join(dir, name), "utf8")
  } catch {
    return undefined
  }
}

describe("packages.item.spec.scoping's script, executed for real (round-3 review)", () => {
  const PACKAGE = "Package: the widget factory.\n\n## Section A\n- [ ] add src/a.ts\n"

  it("a blank specPreJudge fails closed — never clears a section, however high the confidence", () => {
    const dir = initRepo()
    writePackage(dir, PACKAGE)
    commitWithTrailer(dir, 'Gtd-Judge: {"id":"section-1","answer":true,"p":0.99}')
    runScoping(dir, "")
    expect(readIfExists(dir, "SPEC_SCOPE.md")).toContain("Section A")
    expect(readIfExists(dir, "SPEC_CLEARED.md")).toBeUndefined()
  })

  it('a quoted string "yes" verdict clears a section exactly like a JSON boolean true does', () => {
    const dir = initRepo()
    writePackage(dir, PACKAGE)
    commitWithTrailer(dir, 'Gtd-Judge: {"id":"section-1","answer":"yes","p":0.99}')
    runScoping(dir, "0.9")
    expect(readIfExists(dir, "SPEC_SCOPE.md")).toBeUndefined()
    expect(readIfExists(dir, "SPEC_CLEARED.md")).toBeDefined()
  })

  it("a numeric specPreJudge below the verdict's own p still clears (the ordinary approve path)", () => {
    const dir = initRepo()
    writePackage(dir, PACKAGE)
    commitWithTrailer(dir, 'Gtd-Judge: {"id":"section-1","answer":true,"p":0.99}')
    runScoping(dir, "0.9")
    expect(readIfExists(dir, "SPEC_SCOPE.md")).toBeUndefined()
    expect(readIfExists(dir, "SPEC_CLEARED.md")).toBeDefined()
  })

  // The exact "real, silent corruption" a round of review flagged: this
  // state's own comment in unified.yaml warns that `section-N` must map back
  // to the SAME title `it.sections` numbered it as — a three-section package
  // is the minimum fixture that can catch a mapping shifted by one.
  const THREE_SECTIONS =
    "Package: the widget factory.\n\n" +
    "## Section A\n- [ ] add src/a.ts\n\n" +
    "## Section B\n- [ ] add src/b.ts\n\n" +
    "## Section C\n- [ ] add src/c.ts\n"

  it("a partial verdict (only section-1 answered) scopes to EXACTLY the two unanswered sections, in order — never section-1", () => {
    const dir = initRepo()
    writePackage(dir, THREE_SECTIONS)
    commitWithTrailer(dir, 'Gtd-Judge: {"id":"section-1","answer":true,"p":0.99}')
    runScoping(dir, "0.9")
    expect(readIfExists(dir, "SPEC_SCOPE.md")).toBe("- Section B\n- Section C\n")
    expect(readIfExists(dir, "SPEC_CLEARED.md")).toBeUndefined()
  })

  it('the middle section answered "no" scopes to EXACTLY that one — section-2 maps to "Section B", not a neighbor', () => {
    const dir = initRepo()
    writePackage(dir, THREE_SECTIONS)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"section-1","answer":true,"p":0.99}',
        'Gtd-Judge: {"id":"section-2","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"section-3","answer":true,"p":0.99}',
      ].join("\n"),
    )
    runScoping(dir, "0.9")
    expect(readIfExists(dir, "SPEC_SCOPE.md")).toBe("- Section B\n")
    expect(readIfExists(dir, "SPEC_CLEARED.md")).toBeUndefined()
  })

  it('all three sections answered "yes" at high confidence clears with no scope file at all', () => {
    const dir = initRepo()
    writePackage(dir, THREE_SECTIONS)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"section-1","answer":true,"p":0.99}',
        'Gtd-Judge: {"id":"section-2","answer":true,"p":0.99}',
        'Gtd-Judge: {"id":"section-3","answer":true,"p":0.99}',
      ].join("\n"),
    )
    runScoping(dir, "0.9")
    expect(readIfExists(dir, "SPEC_SCOPE.md")).toBeUndefined()
    expect(readIfExists(dir, "SPEC_CLEARED.md")).toBeDefined()
  })
})

/** Renders `striking`'s script with a given `specFindingKeep` value and runs it for real against `dir`. */
const runStriking = (dir: string, specFindingKeep: string): void => {
  const { definition, vars } = compileTemplate()
  const state = definition.states["packages.item.spec.striking"]!
  const script = renderStateTemplate(state.script!, {
    startCommit: "",
    currentCommit: "",
    previousCommit: "",
    state: "packages.item.spec.striking",
    actor: "check",
    reviewBase: "",
    processBase: "",
    processCost: 0,
    processCostByModel: [],
    read: () => "",
    sections: () => [],
    openQuestions: () => [],
    openQuestionOptions: () => [],
    vars: { ...vars, specFindingKeep },
    edges: [],
  })
  execFileSync("sh", ["-c", script.replace(/\.gtd\//g, "")], { cwd: dir, stdio: "pipe" })
}

const writeFeedback = (dir: string, body: string): void => {
  writeFileSync(join(dir, "SPEC_FEEDBACK.md"), body)
}

describe("packages.item.spec.striking's script, executed for real (round-3 review)", () => {
  const THREE_FINDINGS =
    "## Finding one\nBody of finding one.\n\n" +
    "## Finding two\nBody of finding two.\n\n" +
    "## Finding three\nBody of finding three.\n"

  it('strikes exactly the finding answered "no", keeping the other two intact and in order', () => {
    const dir = initRepo()
    writeFeedback(dir, THREE_FINDINGS)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"finding-1","answer":true,"p":0.9}',
        'Gtd-Judge: {"id":"finding-2","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"finding-3","answer":true,"p":0.9}',
      ].join("\n"),
    )
    runStriking(dir, "0.6")
    expect(readIfExists(dir, "SPEC_FEEDBACK.md")).toBe(
      "## Finding one\nBody of finding one.\n\n## Finding three\nBody of finding three.\n",
    )
  })

  it("every finding struck deletes SPEC_FEEDBACK.md entirely", () => {
    const dir = initRepo()
    writeFeedback(dir, THREE_FINDINGS)
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"finding-1","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"finding-2","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"finding-3","answer":false,"p":0.9}',
      ].join("\n"),
    )
    runStriking(dir, "0.6")
    expect(readIfExists(dir, "SPEC_FEEDBACK.md")).toBeUndefined()
  })

  it("no Gtd-Judge trailer at all (a skipped judgment) strikes nothing — every finding survives verbatim", () => {
    const dir = initRepo()
    writeFeedback(dir, THREE_FINDINGS)
    commitWithTrailer(dir, "")
    runStriking(dir, "0.6")
    expect(readIfExists(dir, "SPEC_FEEDBACK.md")).toBe(THREE_FINDINGS)
  })

  it("preserves the preamble and the surviving finding's own last line when the file has no trailing newline (round-4 review)", () => {
    // Exact repro from the round-4 review: `wc -l` undercounts a
    // no-trailing-newline file by one, truncating the last surviving
    // finding's final line; the preamble before the first `## ` heading
    // must also survive a strike, not just the findings themselves.
    const dir = initRepo()
    writeFeedback(
      dir,
      "Reviewed…\n\n## Finding one\n\nnit text\n\n## Finding two\n\nthe last line of the real finding",
    )
    commitWithTrailer(dir, 'Gtd-Judge: {"id":"finding-1","answer":false,"p":0.9}')
    runStriking(dir, "0.6")
    expect(readIfExists(dir, "SPEC_FEEDBACK.md")).toBe(
      "Reviewed…\n\n## Finding two\n\nthe last line of the real finding",
    )
  })

  it("deletes the file when a preamble is the only thing left after every finding is struck (round-5 review)", () => {
    // Emptiness must be judged on surviving FINDINGS, not bytes — a title
    // plus prose ahead of the first `## ` heading (the shape every real
    // review this repo writes has) must not keep .gtd/SPEC_FEEDBACK.md alive
    // once nothing is left to fix, or the post-judge spends the exact
    // fix-spec turn it exists to avoid.
    const dir = initRepo()
    writeFeedback(
      dir,
      "Reviewed…\n\n## Finding one\n\nnit text\n\n## Finding two\n\nthe last line of the real finding",
    )
    commitWithTrailer(
      dir,
      [
        'Gtd-Judge: {"id":"finding-1","answer":false,"p":0.9}',
        'Gtd-Judge: {"id":"finding-2","answer":false,"p":0.9}',
      ].join("\n"),
    )
    runStriking(dir, "0.6")
    expect(readIfExists(dir, "SPEC_FEEDBACK.md")).toBeUndefined()
  })

  it('a blank specFindingKeep disables striking entirely — a "no"-answered finding survives too', () => {
    const dir = initRepo()
    writeFeedback(dir, THREE_FINDINGS)
    commitWithTrailer(dir, 'Gtd-Judge: {"id":"finding-2","answer":false,"p":0.9}')
    runStriking(dir, "")
    expect(readIfExists(dir, "SPEC_FEEDBACK.md")).toBe(THREE_FINDINGS)
  })
})

describe("packages.item.spec.pre's judge template (round-3 review)", () => {
  it("interpolates the real startCommit, never the literal `it.startCommit`", () => {
    const { definition, vars } = compileTemplate()
    const state = definition.states["packages.item.spec.pre"]!
    const context: TemplateContext = {
      startCommit: "abc1234def",
      currentCommit: "cur",
      previousCommit: "prev",
      state: "packages.item.spec.pre",
      actor: "human",
      reviewBase: "",
      processBase: "",
      processCost: 0,
      processCostByModel: [],
      read: (path) =>
        path === ".gtd/NEXT.md" ? ".gtd/packages/01-widget.md\n" : "## Do the thing\n- [ ] task\n",
      sections: () => ["Do the thing"],
      openQuestions: () => [],
      openQuestionOptions: () => [],
      vars,
      edges: [],
    }
    const rendered = renderStateTemplate(state.judge!, context)
    expect(rendered).not.toContain("it.startCommit")
    expect(rendered).toContain("abc1234def")
  })
})
