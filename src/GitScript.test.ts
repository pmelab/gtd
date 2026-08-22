import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  commitAll,
  commitAsIs,
  deleteRef,
  discardPending,
  hardResetTo,
  mixedResetTo,
  pathspec,
  restoreStagedFrom,
  shellQuote,
  softResetTo,
  updateRef,
} from "./GitScript.js"

const runBashCheckSyntax = (script: string): number => {
  try {
    execFileSync("bash", ["-n"], { input: script })
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

/**
 * A fake `git` on `PATH` that behaves per invocation count (tracked in a
 * counter file), so a script's real retry/discrimination logic can be
 * exercised against real bash without a real repo. `firstBehavior`/
 * `secondBehavior` are shell snippets run in place of the real command.
 */
const withFakeGit = (
  firstBehavior: string,
  secondBehavior = `exit 0`,
): { readonly binDir: string; readonly counterFile: string } => {
  const binDir = mkdtempSync(join(tmpdir(), "gitscript-fakebin-"))
  const counterFile = join(binDir, "count")
  const gitPath = join(binDir, "git")
  writeFileSync(
    gitPath,
    [
      "#!/bin/bash",
      `count=$(( $(cat '${counterFile}' 2>/dev/null || echo 0) + 1 ))`,
      `echo "$count" > '${counterFile}'`,
      `if [ "$count" -eq 1 ]; then`,
      `  ${firstBehavior}`,
      `else`,
      `  ${secondBehavior}`,
      `fi`,
    ].join("\n"),
    { mode: 0o755 },
  )
  chmodSync(gitPath, 0o755)
  return { binDir, counterFile }
}

const runWithFakeGit = (script: string, binDir: string): { status: number | null } =>
  spawnSync("bash", ["-c", script], {
    env: { ...process.env, PATH: `${binDir}:${process.env["PATH"]}` },
    encoding: "utf8",
  })

const allBuilders: ReadonlyArray<[string, string]> = [
  ["commitAll", commitAll("gtd(agent): working")],
  ["commitAsIs", commitAsIs("gtd(agent): working")],
  ["softResetTo", softResetTo("HEAD~1")],
  ["mixedResetTo", mixedResetTo("HEAD~1")],
  ["hardResetTo", hardResetTo("HEAD~1")],
  ["discardPending", discardPending()],
  ["updateRef", updateRef("refs/worktree/gtd/review-head", "abc123")],
  ["deleteRef", deleteRef("refs/worktree/gtd/review-head")],
  ["restoreStagedFrom (with paths)", restoreStagedFrom("HEAD", [".gtd/TODO.md"])],
  ["restoreStagedFrom (no paths)", restoreStagedFrom("HEAD", [])],
]

describe("commitAll", () => {
  it("stages everything then commits with --allow-empty, retrying without hooks", () => {
    const script = commitAll("gtd(agent): working")
    expect(script).toContain("git add -A")
    expect(script).toContain("git commit --allow-empty -m 'gtd(agent): working'")
    expect(script).toContain("--no-verify")
  })

  it("short-circuits: a failed git add never reaches the commit", () => {
    const { binDir, counterFile } = withFakeGit(`exit 1`)
    const result = runWithFakeGit(commitAll("msg"), binDir)
    expect(result.status).not.toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("1")
  })
})

describe("commitAsIs", () => {
  it("commits the staged index as-is with --allow-empty, without an add", () => {
    const script = commitAsIs("gtd(agent): working")
    expect(script).not.toContain("git add -A")
    expect(script).toContain("git commit --allow-empty -m 'gtd(agent): working'")
    expect(script).toContain("--no-verify")
  })
})

describe("commitAllowEmpty retry discrimination (via commitAsIs)", () => {
  it("retries without hooks on the hook's own empty-git-commit rejection", () => {
    const { binDir, counterFile } = withFakeGit(
      `echo "fatal: rejecting an empty git commit" >&2; exit 1`,
      `case "$*" in *--no-verify*) exit 0 ;; *) exit 1 ;; esac`,
    )
    const result = runWithFakeGit(commitAsIs("msg"), binDir)
    expect(result.status).toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("2")
  })

  it("does NOT retry — and stays failed — on a non-hook commit failure", () => {
    const { binDir, counterFile } = withFakeGit(`echo "some other failure" >&2; exit 1`)
    const result = runWithFakeGit(commitAsIs("msg"), binDir)
    expect(result.status).not.toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("1")
  })
})

describe("softResetTo", () => {
  it("emits git reset --soft <ref>", () => {
    expect(softResetTo("HEAD~1")).toBe("git reset --soft 'HEAD~1'")
  })
})

describe("mixedResetTo", () => {
  it("emits git reset --mixed <ref>", () => {
    expect(mixedResetTo("HEAD~1")).toBe("git reset --mixed 'HEAD~1'")
  })
})

describe("hardResetTo", () => {
  it("emits git reset --hard <ref>", () => {
    expect(hardResetTo("HEAD~1")).toBe("git reset --hard 'HEAD~1'")
  })
})

describe("discardPending", () => {
  it("stages everything then hard-resets to HEAD", () => {
    const script = discardPending()
    expect(script).toContain("git add -A")
    expect(script).toContain("git reset --hard HEAD")
  })

  it("short-circuits: a failed git add never reaches the hard reset", () => {
    const { binDir, counterFile } = withFakeGit(`exit 1`)
    const result = runWithFakeGit(discardPending(), binDir)
    expect(result.status).not.toBe(0)
    expect(execFileSync("cat", [counterFile], { encoding: "utf8" }).trim()).toBe("1")
  })
})

describe("updateRef", () => {
  it("emits git update-ref <ref> <hash>", () => {
    expect(updateRef("refs/worktree/gtd/review-head", "abc123")).toBe(
      "git update-ref 'refs/worktree/gtd/review-head' 'abc123'",
    )
  })
})

describe("deleteRef", () => {
  it("emits git update-ref -d <ref> verbatim (tolerant of a missing ref already in real git)", () => {
    expect(deleteRef("refs/worktree/gtd/review-head")).toBe(
      "git update-ref -d 'refs/worktree/gtd/review-head'",
    )
  })
})

describe("restoreStagedFrom", () => {
  it("emits git restore --staged --source=<source> -- <paths...>", () => {
    const script = restoreStagedFrom("HEAD", [".gtd/TODO.md", ".gtd/REVIEW.md"])
    expect(script).toContain("git restore --staged --source='HEAD' --")
    expect(script).toContain("'.gtd/TODO.md'")
    expect(script).toContain("'.gtd/REVIEW.md'")
  })

  it("emits a harmless empty script when no paths are given", () => {
    const script = restoreStagedFrom("HEAD", [])
    expect(script).toBe("")
    expect(runBashCheckSyntax(script)).toBe(0)
  })

  it("tolerates a no-matching-path failure", () => {
    const { binDir } = withFakeGit(
      `echo "error: pathspec 'x' did not match any file(s)" >&2; exit 1`,
    )
    const result = runWithFakeGit(restoreStagedFrom("HEAD", [".gtd/TODO.md"]), binDir)
    expect(result.status).toBe(0)
  })

  it("does NOT tolerate index.lock contention — it must still fail the script", () => {
    const { binDir } = withFakeGit(
      `echo "fatal: Unable to create '/repo/.git/index.lock': File exists." >&2; exit 128`,
    )
    const result = runWithFakeGit(restoreStagedFrom("HEAD", [".gtd/TODO.md"]), binDir)
    expect(result.status).not.toBe(0)
  })

  it("does NOT tolerate the 'another git process' lock message either", () => {
    const { binDir } = withFakeGit(`echo "Another git process seems to be running" >&2; exit 128`)
    const result = runWithFakeGit(restoreStagedFrom("HEAD", [".gtd/TODO.md"]), binDir)
    expect(result.status).not.toBe(0)
  })
})

describe("pathspec", () => {
  it("quotes every path and space-joins them", () => {
    expect(pathspec(["src/a.ts", "src/b.ts"])).toBe("'src/a.ts' 'src/b.ts'")
  })

  it("returns an empty string for an empty list", () => {
    expect(pathspec([])).toBe("")
  })
})

describe("shellQuote", () => {
  it.each([
    ["a newline", "gtd(agent): line one\nline two"],
    ["a backtick", "gtd(agent): `echo hi`"],
    ["a double quote", 'gtd(agent): say "hi"'],
    ["a dollar sign", "gtd(agent): $HOME expansion"],
    ["an arrow", "gtd(agent): design.product-author → design.product-answer"],
    ["a single quote", "gtd(agent): it's done"],
  ])("round-trips a message containing %s", (_label, s) => {
    const out = execFileSync("bash", ["-c", `printf %s ${shellQuote(s)}`], { encoding: "utf8" })
    expect(out).toBe(s)
  })

  it("round-trips arbitrary strings — including newlines and non-ASCII — through a real bash printf", () => {
    fc.assert(
      fc.property(
        // `unit: "binary"` covers the full Unicode code-point range (control
        // chars, newlines, non-ASCII) in one code point per unit, unlike the
        // default `"grapheme-ascii"` unit fast-check 4.8 otherwise samples,
        // which never produces a newline or a non-ASCII byte. NUL can't
        // survive an argv round-trip (bash/exec truncate at the first NUL),
        // so it's filtered out here deliberately rather than left to chance.
        fc.string({ unit: "binary" }).filter((s) => !s.includes("\0")),
        (s) => {
          const out = execFileSync("bash", ["-c", `printf %s ${shellQuote(s)}`], {
            encoding: "utf8",
          })
          expect(out).toBe(s)
        },
      ),
      { numRuns: 500 },
    )
  })
})

describe("every builder's output", () => {
  it.each(allBuilders)("%s is syntactically valid bash", (_name, script) => {
    expect(runBashCheckSyntax(script)).toBe(0)
  })
})
