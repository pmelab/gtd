import { execFileSync, execSync } from "node:child_process"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { REVIEW_HEAD_REF } from "./ReviewWindow.js"
import { emitScripts, type EmitPreconditions, type EmitStep } from "./Emit.js"

const runBashCheckSyntax = (script: string): number => {
  try {
    execFileSync("bash", ["-n"], { input: script })
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

const HEAD = "a".repeat(40)
const basePreconditions: EmitPreconditions = { expectedHead: HEAD }

describe("emitScripts — empty inputs", () => {
  it("is the empty string when both halves are omitted", () => {
    const { required, optional } = emitScripts(basePreconditions)
    expect(required).toBe("")
    expect(optional).toBe("")
  })

  it("is the empty string when both halves are explicitly []", () => {
    const { required, optional } = emitScripts(basePreconditions, [], [])
    expect(required).toBe("")
    expect(optional).toBe("")
  })
})

describe("emitScripts — required only", () => {
  const steps: ReadonlyArray<EmitStep> = [
    { kind: "gitWrite", command: "git commit --allow-empty -m 'gtd(agent): x'" },
  ]
  const { required, optional } = emitScripts(basePreconditions, steps)

  it("leaves optional empty", () => {
    expect(optional).toBe("")
  })

  it("begins with set -euo pipefail as the literal first line", () => {
    expect(required.split("\n")[0]).toBe("set -euo pipefail")
  })

  it("asserts HEAD before doing anything, naming the mismatch and telling the reader to re-run gtd", () => {
    expect(required).toContain("git rev-parse HEAD")
    expect(required).toContain(HEAD)
    expect(required).toContain("re-run gtd")
  })

  it("is syntactically valid bash", () => {
    expect(runBashCheckSyntax(required)).toBe(0)
  })
})

describe("emitScripts — both halves populated", () => {
  const required: ReadonlyArray<EmitStep> = [
    { kind: "gitWrite", command: "git commit --allow-empty -m 'gtd(agent): x'" },
  ]
  const optional: ReadonlyArray<EmitStep> = [
    { kind: "command", command: "some-format-command --check FEEDBACK.md" },
  ]
  const preconditions: EmitPreconditions = {
    expectedHead: HEAD,
    reviewWindow: { ref: REVIEW_HEAD_REF, expectedHash: "b".repeat(40) },
  }
  const result = emitScripts(preconditions, required, optional)

  it("both halves are non-empty", () => {
    expect(result.required).not.toBe("")
    expect(result.optional).not.toBe("")
  })

  it("both halves independently begin with set -euo pipefail", () => {
    expect(result.required.split("\n")[0]).toBe("set -euo pipefail")
    expect(result.optional.split("\n")[0]).toBe("set -euo pipefail")
  })

  it("both halves independently assert the review-window ref when reviewWindow is supplied", () => {
    for (const script of [result.required, result.optional]) {
      expect(script).toContain(REVIEW_HEAD_REF)
      expect(script).toContain("b".repeat(40))
      expect(script).toContain("re-run gtd")
    }
  })

  it("both halves are syntactically valid bash", () => {
    expect(runBashCheckSyntax(result.required)).toBe(0)
    expect(runBashCheckSyntax(result.optional)).toBe(0)
  })

  it("a plain command step is emitted verbatim, not routed through the retry helper", () => {
    expect(result.optional).toContain("some-format-command --check FEEDBACK.md")
    expect(result.optional).not.toContain("gtd_retry 'some-format-command")
  })

  it("a gitWrite step is routed through the retry helper", () => {
    expect(result.required).toMatch(/gtd_retry '.*git commit --allow-empty/)
  })
})

describe("emitScripts — no reviewWindow means no extra ref assertion", () => {
  const steps: ReadonlyArray<EmitStep> = [{ kind: "command", command: "echo hi" }]
  const { required } = emitScripts(basePreconditions, steps)

  it("does not mention a review-head ref at all", () => {
    expect(required).not.toContain("refs/worktree/gtd/review-head")
  })
})

describe("emitScripts — a script with no gitWrite steps omits the retry helper", () => {
  const steps: ReadonlyArray<EmitStep> = [{ kind: "command", command: "echo hi" }]
  const { required } = emitScripts(basePreconditions, steps)

  it("never defines gtd_retry when nothing needs it", () => {
    expect(required).not.toContain("gtd_retry()")
  })

  it("is still syntactically valid bash", () => {
    expect(runBashCheckSyntax(required)).toBe(0)
  })
})

/**
 * A fake git-alike, invoked by ABSOLUTE PATH from within the assembled
 * script's `gitWrite` step (never named bare `git`), behaving per invocation
 * count (tracked in a counter file) — same technique `GitScript.test.ts`'s
 * `withFakeGit` uses. Keeping it off `PATH` under the name `git` matters
 * here: the assembled script's OWN precondition assertion also runs a bare
 * `git rev-parse HEAD`, which must keep hitting the REAL git in the real
 * throwaway repo these tests run in, not this fake.
 */
const withFakeGit = (
  behaviorByAttempt: ReadonlyArray<string>,
): { readonly binPath: string; readonly counterFile: string } => {
  const binDir = mkdtempSync(join(tmpdir(), "emit-fakebin-"))
  const counterFile = join(binDir, "count")
  const binPath = join(binDir, "fake-git")
  const cases = behaviorByAttempt.map((behavior, i) => `  ${i + 1}) ${behavior} ;;`).join("\n")
  const last = behaviorByAttempt[behaviorByAttempt.length - 1] ?? "exit 0"
  writeFileSync(
    binPath,
    [
      "#!/bin/bash",
      `count=$(( $(cat '${counterFile}' 2>/dev/null || echo 0) + 1 ))`,
      `echo "$count" > '${counterFile}'`,
      `case "$count" in`,
      cases,
      `  *) ${last} ;;`,
      `esac`,
    ].join("\n"),
    { mode: 0o755 },
  )
  chmodSync(binPath, 0o755)
  return { binPath, counterFile }
}

const runScriptInRealRepo = (script: string, cwd: string): number => {
  try {
    execSync("bash", { input: script, cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

describe("gtd_retry — index.lock contention", () => {
  const initRepo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "emit-retry-repo-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "initial"], {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    })
    return dir
  }
  const headOf = (dir: string): string =>
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim()
  const scriptFor = (dir: string, binPath: string): string =>
    emitScripts({ expectedHead: headOf(dir) }, [
      { kind: "gitWrite", command: `${binPath} commit --allow-empty -m x` },
    ]).required

  it("retries on the index.lock wording and eventually succeeds", () => {
    const dir = initRepo()
    const { binPath, counterFile } = withFakeGit([
      `echo "fatal: Unable to create '.git/index.lock': File exists." >&2; exit 128`,
      `echo "fatal: Unable to create '.git/index.lock': File exists." >&2; exit 128`,
      `exit 0`,
    ])
    const status = runScriptInRealRepo(scriptFor(dir, binPath), dir)
    expect(status).toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("3")
  })

  it("retries on the 'another git process' wording too", () => {
    const dir = initRepo()
    const { binPath, counterFile } = withFakeGit([
      `echo "Another git process seems to be running" >&2; exit 128`,
      `exit 0`,
    ])
    const status = runScriptInRealRepo(scriptFor(dir, binPath), dir)
    expect(status).toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("2")
  })

  it("gives up after 6 total attempts, still contending", () => {
    const dir = initRepo()
    const { binPath, counterFile } = withFakeGit([
      `echo "fatal: Unable to create '.git/index.lock': File exists." >&2; exit 128`,
    ])
    const status = runScriptInRealRepo(scriptFor(dir, binPath), dir)
    expect(status).not.toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("6")
  })

  it("does NOT retry a non-lock failure — fails on the first attempt", () => {
    const dir = initRepo()
    const { binPath, counterFile } = withFakeGit([`echo "fatal: some other failure" >&2; exit 1`])
    const status = runScriptInRealRepo(scriptFor(dir, binPath), dir)
    expect(status).not.toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("1")
  })
})

describe("real repo — HEAD precondition and retry plumbing end to end", () => {
  const initRepo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "emit-realrepo-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "initial"], { cwd: dir })
    return dir
  }

  const headOf = (dir: string): string =>
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim()

  const commitCount = (dir: string): number =>
    Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(),
    )

  it("a matching HEAD passes the precondition and the wrapped git command actually lands", () => {
    const dir = initRepo()
    const head = headOf(dir)
    const before = commitCount(dir)
    const { required } = emitScripts({ expectedHead: head }, [
      { kind: "gitWrite", command: "git commit --allow-empty -m 'gtd(agent): landed'" },
    ])
    execSync("bash", { input: required, cwd: dir })
    expect(commitCount(dir)).toBe(before + 1)
    expect(
      execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: dir, encoding: "utf8" }).trim(),
    ).toBe("gtd(agent): landed")
  })

  it("a mismatched expected HEAD aborts before touching anything", () => {
    const dir = initRepo()
    const before = commitCount(dir)
    const { required } = emitScripts({ expectedHead: "f".repeat(40) }, [
      { kind: "gitWrite", command: "git commit --allow-empty -m 'gtd(agent): should-not-land'" },
    ])
    let status = 0
    try {
      execSync("bash", { input: required, cwd: dir, stdio: ["pipe", "pipe", "pipe"] })
    } catch (error) {
      status = (error as { status?: number }).status ?? 1
    }
    expect(status).not.toBe(0)
    expect(commitCount(dir)).toBe(before)
  })
})
