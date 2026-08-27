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
  OUTCOME_MARKER,
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
  it("emits one printf naming both states", () => {
    expect(transitionOutcome("plan.planning", "plan.await-plan")).toBe(
      `${OUTCOME_MARKER}\nprintf '%s %s → %s\\n' '->' 'plan.planning' 'plan.await-plan'`,
    )
  })

  it("is syntactically valid sh on its own — no preamble to define first", () => {
    expect(runShCheckSyntax(transitionOutcome("a", "b"))).toBe(0)
  })
})

describe("commitOutcome", () => {
  it("emits one printf naming the subject", () => {
    expect(commitOutcome("gtd(agent): x")).toBe(
      `${OUTCOME_MARKER}\nprintf '%s %s\\n' '[commit]' 'gtd(agent): x'`,
    )
  })

  it("is syntactically valid sh on its own", () => {
    expect(runShCheckSyntax(commitOutcome("gtd(agent): x"))).toBe(0)
  })
})

describe("noteOutcome", () => {
  it("emits a single printf of the text", () => {
    expect(noteOutcome('nothing to do at "idle"')).toBe(
      `${OUTCOME_MARKER}\nprintf '%s\\n' 'nothing to do at "idle"'`,
    )
  })
})

describe("abandonedOutcome / restoredOutcome", () => {
  it("resolves the short hash and subject in-script, since the reset has not happened yet when gtd emits this", () => {
    expect(abandonedOutcome("build.fix", "abc123", "idle")).toContain(
      "\"$(git rev-parse --short 'abc123')\"",
    )
    expect(abandonedOutcome("build.fix", "abc123", "idle")).toContain(
      "\"$(git log -1 --format=%s 'abc123')\"",
    )
  })

  it("both are syntactically valid sh on their own", () => {
    expect(runShCheckSyntax(abandonedOutcome("build.fix", "abc123", "idle"))).toBe(0)
    expect(runShCheckSyntax(restoredOutcome("abc123", "idle"))).toBe(0)
  })
})

describe("abandonNoopOutcome", () => {
  it("carries the same wording as abandonNoopText", () => {
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

/**
 * The emitted statements carry no ANSI at all now, so there is no tty /
 * `NO_COLOR` / `TERM=dumb` branch left to gate: output is byte-identical on a
 * pipe and on a real terminal. `run-in-pty.py` is what proves that rather than
 * assumes it — it allocates a throwaway pty pair, the one context where a
 * colour branch (if one came back) would actually fire.
 */
describe("no ANSI, on a pipe or a real tty", () => {
  const PTY_RUNNER = resolve(import.meta.dirname, "../tests/tooling/support/run-in-pty.py")
  const ESC = "\x1b"

  const initRepo = (dir: string): void => {
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "gtd(human): idle"], { cwd: dir })
  }

  it("emits no escape byte under a real tty with a colour-capable TERM", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcome-pty-"))
    initRepo(dir)
    const script = commitOutcome("gtd(human): idle")
    const out = execFileSync("python3", [PTY_RUNNER, `cd ${JSON.stringify(dir)} && ${script}`], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", TERM: "xterm" },
    })
    expect(out).not.toContain(ESC)
    expect(out).toContain("[commit] gtd(human): idle")
  })

  it("contains no ANSI source text either — nothing for a driver's stdout to leak", () => {
    for (const statement of [
      transitionOutcome("a", "b"),
      commitOutcome("gtd(human): x"),
      noteOutcome("ok"),
      abandonedOutcome("build.fix", "abc123", "idle"),
      restoredOutcome("abc123", "idle"),
    ]) {
      expect(statement).not.toContain("\\033[")
      expect(statement).not.toContain("$'")
    }
  })

  it("contains no bash-only local declarations or process substitution", () => {
    const statement = commitOutcome("gtd(human): x")
    expect(statement).not.toContain(" local ")
    expect(statement).not.toContain("<(")
  })
})

describe("%-safety and quoting", () => {
  it("a subject containing %s survives commitOutcome round-tripped through printf", () => {
    const tricky = "gtd(agent): 50%s off deal's price"
    const dir = mkdtempSync(join(tmpdir(), "outcome-safety-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    const out = execSync("sh", { input: commitOutcome(tricky), cwd: dir, encoding: "utf8" })
    expect(out).toContain(tricky)
  })

  it("round-trips arbitrary subjects (including % and quotes) through noteOutcome", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "binary" }).filter((s) => !s.includes("\0") && !s.includes("\n")),
        (subject) => {
          const out = execSync("sh", { input: noteOutcome(subject), encoding: "utf8" })
          expect(out).toBe(`${subject}\n`)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe("abandonedOutcome / restoredOutcome — real repo", () => {
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
    const out = execSync("sh", {
      input: abandonedOutcome("build.fix", head, "idle"),
      cwd: dir,
      encoding: "utf8",
    })
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
    const out = execSync("sh", {
      input: restoredOutcome(head, "await-review"),
      cwd: dir,
      encoding: "utf8",
    })
    expect(out).toBe(
      `restored the retained history — HEAD is back at ${short} ("gtd(human): idle"), ` +
        'resting at "await-review". Resume with the loop, or `git reset` to any earlier ' +
        "turn to restart from there.\n",
    )
  })
})
