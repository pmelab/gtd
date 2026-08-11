import { execFileSync, execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  abandonedOutcome,
  abandonNoopOutcome,
  abandonNoopText,
  commitOutcome,
  noopText,
  noteOutcome,
  OUTCOME_PREAMBLE,
  renderFormat,
  restoredOutcome,
  transitionOutcome,
} from "./OutcomeScript.js"

const runBashCheckSyntax = (script: string): number => {
  try {
    execFileSync("bash", ["-n"], { input: script })
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

describe("transitionOutcome", () => {
  it("emits a call to gtd_report_transition with both states shell-quoted", () => {
    expect(transitionOutcome("plan.planning", "plan.await-plan")).toBe(
      "gtd_report_transition 'plan.planning' 'plan.await-plan'",
    )
  })

  it("is syntactically valid bash on its own", () => {
    expect(runBashCheckSyntax(transitionOutcome("a", "b"))).toBe(0)
  })
})

describe("commitOutcome", () => {
  it("emits a call to gtd_report_commit with the subject shell-quoted", () => {
    expect(commitOutcome("gtd(agent): x")).toBe("gtd_report_commit 'gtd(agent): x'")
  })
})

describe("noteOutcome", () => {
  it("emits a call to gtd_report_note with the text shell-quoted", () => {
    expect(noteOutcome('nothing to do at "idle"')).toBe(
      "gtd_report_note 'nothing to do at \"idle\"'",
    )
  })
})

describe("abandonedOutcome / restoredOutcome", () => {
  it("emits gtd_report_abandoned with from/head/state shell-quoted", () => {
    expect(abandonedOutcome("build.fix", "abc123", "idle")).toBe(
      "gtd_report_abandoned 'build.fix' 'abc123' 'idle'",
    )
  })

  it("emits gtd_report_restored with to/state shell-quoted", () => {
    expect(restoredOutcome("abc123", "idle")).toBe("gtd_report_restored 'abc123' 'idle'")
  })
})

describe("abandonNoopOutcome", () => {
  it("carries the same wording as abandonNoopText, via gtd_report_note", () => {
    expect(abandonNoopOutcome("idle")).toBe(noteOutcome(abandonNoopText("idle")))
  })
})

describe("plain-text twins", () => {
  it("noopText names the state", () => {
    expect(noopText("idle")).toBe('nothing to do at "idle"\n')
  })

  it("abandonNoopText names the initial state", () => {
    expect(abandonNoopText("idle")).toBe(
      'no gtd process is underway (resting at "idle") — nothing to abandon\n',
    )
  })
})

describe("renderFormat", () => {
  it("substitutes %s placeholders in order", () => {
    expect(renderFormat("%s and %s", "a", "b")).toBe("a and b")
  })

  it("leaves a literal % that isn't followed by s untouched", () => {
    expect(renderFormat("100%% done, %s", "ok")).toBe("100%% done, ok")
  })
})

/** A subject containing printf conversion specs and quotes must survive both the plain and script paths untouched. */
describe("%-safety and quoting", () => {
  it("a subject containing %s survives transitionOutcome/commitOutcome round-tripped through printf", () => {
    const tricky = "gtd(agent): 50%s off deal's price"
    const script = [
      OUTCOME_PREAMBLE,
      commitOutcome(tricky),
      // `gtd_files HEAD` inside gtd_report_commit will no-op (no commit yet in
      // this throwaway dir), so nothing more needs to be staged.
    ].join("\n")
    const dir = mkdtempSync(join(tmpdir(), "outcome-safety-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    const out = execSync("bash", { input: script, cwd: dir, encoding: "utf8" })
    expect(out).toContain(tricky)
  })

  it("round-trips arbitrary subjects (including % and quotes) through commitOutcome + gtd_report_note", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "binary" }).filter((s) => !s.includes("\0") && !s.includes("\n")),
        (subject) => {
          const script = [OUTCOME_PREAMBLE, noteOutcome(subject)].join("\n")
          const out = execSync("bash", { input: script, encoding: "utf8" })
          expect(out).toBe(`${subject}\n`)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe("OUTCOME_PREAMBLE", () => {
  it("is one block with no blank lines", () => {
    expect(OUTCOME_PREAMBLE).not.toContain("\n\n")
  })

  it("starts with the marker comment naming this module", () => {
    expect(OUTCOME_PREAMBLE.split("\n")[0]).toBe(
      "# gtd: human-facing outcome rendering (see src/OutcomeScript.ts)",
    )
  })

  it("is syntactically valid bash on its own", () => {
    expect(runBashCheckSyntax(OUTCOME_PREAMBLE)).toBe(0)
  })
})

describe("gtd_report_transition — real repo", () => {
  const initRepo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "outcome-realrepo-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
    return dir
  }

  it("prints the transition line and up to 3 changed-file rows, plain (NO_COLOR)", () => {
    const dir = initRepo()
    execFileSync("bash", ["-c", "printf a > a.txt && printf b > b.txt && git add -A"], {
      cwd: dir,
    })
    execFileSync("git", ["commit", "-q", "-m", "gtd(human): from → to"], { cwd: dir })
    const script = [OUTCOME_PREAMBLE, transitionOutcome("from", "to")].join("\n")
    const out = execSync("bash", {
      input: script,
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    })
    expect(out).toBe("-> from → to\n   a.txt\n   b.txt\n")
  })

  it("caps changed files at 3 rows with an overflow count", () => {
    const dir = initRepo()
    for (const f of ["a", "b", "c", "d"]) {
      execFileSync("bash", ["-c", `printf x > ${f}.txt`], { cwd: dir })
    }
    execFileSync("git", ["add", "-A"], { cwd: dir })
    execFileSync("git", ["commit", "-q", "-m", "gtd(human): x"], { cwd: dir })
    const script = [OUTCOME_PREAMBLE, commitOutcome("gtd(human): x")].join("\n")
    const out = execSync("bash", {
      input: script,
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    })
    expect(out).toBe("[commit] gtd(human): x\n   a.txt\n   b.txt\n   c.txt\n   ... (1 more)\n")
  })

  it("shows the first commit's own files with --root", () => {
    const dir = initRepo()
    execFileSync("bash", ["-c", "printf a > a.txt"], { cwd: dir })
    execFileSync("git", ["add", "-A"], { cwd: dir })
    execFileSync("git", ["commit", "-q", "-m", "gtd(human): idle"], { cwd: dir })
    const script = [OUTCOME_PREAMBLE, commitOutcome("gtd(human): idle")].join("\n")
    const out = execSync("bash", {
      input: script,
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    })
    expect(out).toBe("[commit] gtd(human): idle\n   a.txt\n")
  })
})

describe("gtd_report_abandoned / gtd_report_restored — real repo", () => {
  const initRepo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "outcome-abandon-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "gtd(human): idle"], { cwd: dir })
    return dir
  }

  it("resolves the short hash/subject post-hoc from the given commitish", () => {
    const dir = initRepo()
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim()
    const short = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim()
    const script = [OUTCOME_PREAMBLE, abandonedOutcome("build.fix", head, "idle")].join("\n")
    const out = execSync("bash", { input: script, cwd: dir, encoding: "utf8" })
    expect(out).toBe(
      `abandoned the process resting at "build.fix" — HEAD is back at ${short} ` +
        '("gtd(human): idle"), resting at "idle".\n' +
        "Everything the process produced is kept as uncommitted changes (`git status`); " +
        "discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.\n",
    )
  })

  it("restoredOutcome resolves the short hash/subject post-hoc from the given commitish", () => {
    const dir = initRepo()
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim()
    const short = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim()
    const script = [OUTCOME_PREAMBLE, restoredOutcome(head, "await-review")].join("\n")
    const out = execSync("bash", { input: script, cwd: dir, encoding: "utf8" })
    expect(out).toBe(
      `restored the retained history — HEAD is back at ${short} ("gtd(human): idle"), ` +
        'resting at "await-review". Resume with the loop, or `git reset` to any earlier ' +
        "turn to restart from there.\n",
    )
  })
})
