import { execFileSync, execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  abandonedOutcome,
  abandonNoopOutcome,
  abandonNoopText,
  commitOutcome,
  noteOutcome,
  OUTCOME_PREAMBLE,
  renderFormat,
  restoredOutcome,
  transitionOutcome,
} from "./OutcomeScript.js"

const runShCheckSyntax = (script: string): number => {
  try {
    execFileSync("sh", ["-n"], { input: script })
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

  it("is syntactically valid sh on its own", () => {
    expect(runShCheckSyntax(transitionOutcome("a", "b"))).toBe(0)
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
    const out = execSync("sh", { input: script, cwd: dir, encoding: "utf8" })
    expect(out).toContain(tricky)
  })

  it("round-trips arbitrary subjects (including % and quotes) through commitOutcome + gtd_report_note", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "binary" }).filter((s) => !s.includes("\0") && !s.includes("\n")),
        (subject) => {
          const script = [OUTCOME_PREAMBLE, noteOutcome(subject)].join("\n")
          const out = execSync("sh", { input: script, encoding: "utf8" })
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

  it("is syntactically valid sh on its own", () => {
    expect(runShCheckSyntax(OUTCOME_PREAMBLE)).toBe(0)
  })

  it("uses printf-built escapes for colour codes, never ANSI-C $'...' quoting", () => {
    expect(OUTCOME_PREAMBLE).toContain("printf '\\033[")
    expect(OUTCOME_PREAMBLE).not.toContain("$'\\e")
  })

  it("contains no bash-only local declarations, process substitution, or ANSI-C quoting", () => {
    expect(OUTCOME_PREAMBLE).not.toContain(" local ")
    expect(OUTCOME_PREAMBLE).not.toContain("<(")
    expect(OUTCOME_PREAMBLE).not.toContain("$'")
  })
})

/**
 * `[ -t 1 ]` is a real `isatty()` check — a pipe (every other test in this
 * file captures output through one) can never make it true, so it alone
 * can't distinguish "plain because no tty" from "plain because TERM=dumb /
 * NO_COLOR" once a tty is involved. `run-in-pty.py` allocates a throwaway
 * pty pair (no controlling terminal needed, unlike Python's `pty.spawn`) so
 * these cases can be told apart for real. The colour vs. plain distinction
 * itself is made on the presence of a raw ESC byte (`\x1b`, what `printf
 * '\033[...'` actually emits at runtime) rather than the marker glyphs,
 * since that's the one thing plain mode structurally can never contain.
 */
describe("OUTCOME_PREAMBLE's colour gating under a real tty", () => {
  const PTY_RUNNER = resolve(import.meta.dirname, "../tests/tooling/support/run-in-pty.py")
  const ESC = "\x1b"

  const initRepo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "outcome-pty-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "gtd(human): idle"], { cwd: dir })
    return dir
  }

  const runUnderRealPty = (
    dir: string,
    script: string,
    env: Readonly<Record<string, string>>,
  ): string =>
    execFileSync("python3", [PTY_RUNNER, `cd ${JSON.stringify(dir)} && ${script}`], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
    })

  it("still selects the plain fallback strings when TERM=dumb, even on a real tty with NO_COLOR unset", () => {
    const dir = initRepo()
    const out = runUnderRealPty(
      dir,
      [OUTCOME_PREAMBLE, commitOutcome("gtd(human): idle")].join("\n"),
      {
        TERM: "dumb",
      },
    )
    expect(out).not.toContain(ESC)
  })

  it("still selects the plain fallback strings when NO_COLOR is set, even on a real tty with a normal TERM", () => {
    const dir = initRepo()
    const out = runUnderRealPty(
      dir,
      [OUTCOME_PREAMBLE, commitOutcome("gtd(human): idle")].join("\n"),
      {
        TERM: "xterm",
        NO_COLOR: "1",
      },
    )
    expect(out).not.toContain(ESC)
  })

  it("emits colour on a real tty with NO_COLOR unset and a normal TERM", () => {
    const dir = initRepo()
    const out = runUnderRealPty(
      dir,
      [OUTCOME_PREAMBLE, commitOutcome("gtd(human): idle")].join("\n"),
      {
        TERM: "xterm",
      },
    )
    expect(out).toContain(ESC)
  })
})

describe("OUTCOME_PREAMBLE's TERM handling under set -u", () => {
  it("does not error when TERM is entirely unset", () => {
    const env = { ...process.env }
    delete env.TERM
    delete env.NO_COLOR
    const script = ["set -u", OUTCOME_PREAMBLE, noteOutcome("ok")].join("\n")
    expect(() => execSync("sh", { input: script, encoding: "utf8", env })).not.toThrow()
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
    const out = execSync("sh", {
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
    const out = execSync("sh", {
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
    const out = execSync("sh", {
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
    const out = execSync("sh", { input: script, cwd: dir, encoding: "utf8" })
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
    const out = execSync("sh", { input: script, cwd: dir, encoding: "utf8" })
    expect(out).toBe(
      `restored the retained history — HEAD is back at ${short} ("gtd(human): idle"), ` +
        'resting at "await-review". Resume with the loop, or `git reset` to any earlier ' +
        "turn to restart from there.\n",
    )
  })
})
