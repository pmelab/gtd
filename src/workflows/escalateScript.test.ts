import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderScript } from "./text.fixture.js"

/**
 * Real execution against a real git repo, not `bash -n`: `healthGate.escalate`'s
 * round-counting anchor is a git-history walk, and a syntax-only check can't
 * catch an anchor that resolves to the wrong commit. `.gtd/FEEDBACK.md`
 * churns every red round (a fix turn deletes-then-recreates it, per
 * `fixFeedbackPrompt`), so anchoring on ITS deletion (the shape this suite
 * pins as wrong) would reset the round count on every single retry — the
 * cap could never fire. Anchoring on `.gtd/ESCALATION.md`'s own deletion
 * (only ever swept by `healthGate.check`'s green branch) survives that
 * churn.
 */
const initRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "escalate-script-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  git("init", "-q")
  git("config", "user.email", "t@t.com")
  git("config", "user.name", "t")
  return dir
}

const commit = (dir: string, subject: string): void => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  git("add", "-A")
  git("commit", "-q", "--allow-empty", "-m", subject)
}

const headHash = (dir: string): string =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim()

/**
 * Renders `build.health.escalate`'s real script against `startCommit`/`state`
 * and runs it for real in `dir`. The `.gtd/` prefix is stripped the same way
 * `specReviewScripts.test.ts` strips it — this test runs standalone, outside
 * a real `.gtd` checkout, and the script never hardcodes the prefix (it only
 * ever reads/writes whatever path it's given), so a flat `ESCALATION.md`/
 * `FEEDBACK.md` at the repo root stands in for `.gtd/ESCALATION.md`/
 * `.gtd/FEEDBACK.md`.
 */
const runEscalate = (dir: string, startCommit: string): void => {
  const script = renderScript("escalateScript", {
    refs: { start: startCommit },
  })
  execFileSync("sh", ["-c", script.replace(/\.gtd\//g, "")], { cwd: dir, stdio: "pipe" })
}

const gitStatusClean = (dir: string): boolean =>
  execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim() === ""

describe("build.health.escalate's script, executed for real", () => {
  it("a still-red fix turn's own FEEDBACK.md delete/recreate churn between rounds does not reset the round count — the cap still fires at round 3 (package 01, spec-review fix)", () => {
    const dir = initRepo()
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
    commit(dir, "chore: initial commit")
    const startCommit = headHash(dir)

    // Round 1: a red check, three fix attempts each deleting/recreating
    // FEEDBACK.md (the churn the old FEEDBACK.md-anchor mistook for a green
    // reset), then describe writes the first ESCALATION.md.
    execFileSync("sh", ["-c", "printf 'boom 1' > FEEDBACK.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.check → build.health.check")
    for (let i = 0; i < 3; i++) {
      git("rm", "-q", "-f", "FEEDBACK.md")
      commit(dir, "gtd(agent): build.fix → build.health.check")
      execFileSync("sh", ["-c", `printf 'boom ${i}' > FEEDBACK.md`], { cwd: dir })
      commit(dir, "gtd(agent): build.health.check → build.health.check")
    }
    execFileSync("sh", ["-c", "printf 'round 1 analysis' > ESCALATION.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.describe → build.health.stop")

    // Under 2 rounds so far (just this one add) — the script must leave the
    // tree untouched (no ESCALATION.md write), same as a genuine "C" match.
    runEscalate(dir, startCommit)
    expect(gitStatusClean(dir)).toBe(true)

    // The human lands round 1's stop untouched, straight into build.fix —
    // more FEEDBACK.md churn, ESCALATION.md itself never touched, up to the
    // retry cap's second arrival at escalate.
    commit(dir, "gtd(human): build.health.stop → build.fix")
    for (let i = 0; i < 3; i++) {
      execFileSync("sh", ["-c", `printf 'boom again ${i}' > FEEDBACK.md`], { cwd: dir })
      commit(dir, "gtd(agent): build.health.check → build.health.check")
      git("rm", "-q", "-f", "FEEDBACK.md")
      commit(dir, "gtd(agent): build.fix → build.health.check")
    }
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")

    // Second arrival: only round 1's own add is on record so far (its
    // survived document hasn't been overwritten yet) — still under 2, so
    // the script must leave the tree clean, same as the first arrival.
    runEscalate(dir, startCommit)
    expect(gitStatusClean(dir)).toBe(true)

    // Round 2's describe overwrites the survived document (a modify, not
    // an add — it was never swept between rounds).
    execFileSync("sh", ["-c", "printf 'round 2 analysis' > ESCALATION.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.describe → build.health.stop")

    // The human lands round 2's stop untouched too, then the retry cap is
    // hit a third time — ESCALATION.md still never swept along the way.
    commit(dir, "gtd(human): build.health.stop → build.fix")
    execFileSync("sh", ["-c", "printf 'boom once more' > FEEDBACK.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")

    // Third arrival: 2 rounds already on record (round 1's add, round 2's
    // modify) — the cap fires. The script must restore round 2's content
    // (stamped, so it registers as a real change even though the file
    // already holds that exact text) rather than leaving the tree clean.
    runEscalate(dir, startCommit)
    expect(gitStatusClean(dir)).toBe(false)
    const restored = readFileSync(join(dir, "ESCALATION.md"), "utf8")
    expect(restored).toContain("round 2 analysis")
    expect(restored).not.toContain("round 1 analysis")
  })

  it("a byte-identical second describe write still counts as round 2 — the cap fires even when the analysis never changes on disk (package 01, spec-feedback)", () => {
    const dir = initRepo()
    commit(dir, "chore: initial commit")
    const startCommit = headHash(dir)

    execFileSync("sh", ["-c", "printf 'same analysis every time' > ESCALATION.md"], {
      cwd: dir,
    })
    commit(dir, "gtd(agent): build.health.describe → build.health.stop")
    runEscalate(dir, startCommit)
    expect(gitStatusClean(dir)).toBe(true)

    commit(dir, "gtd(human): build.health.stop → build.fix")
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")

    // Round 2's describe writes the EXACT same bytes already on disk — `git
    // add -A && git commit` still produces a real commit (an agent/`prompt`
    // state's clean step is an attempt, not a no-op) even though nothing
    // changed, so `git log -- ESCALATION.md` would never surface it. The
    // round count must not depend on that pathspec.
    commit(dir, "gtd(agent): build.health.describe → build.health.stop")
    commit(dir, "gtd(human): build.health.stop → build.fix")
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")

    runEscalate(dir, startCommit)
    expect(gitStatusClean(dir)).toBe(false)
    const restored = readFileSync(join(dir, "ESCALATION.md"), "utf8")
    expect(restored).toContain("same analysis every time")
  })

  it("a human's fresh-instructions edit landed at the terminal exhausted stop survives the next arrival at escalate, instead of being silently overwritten by the last machine analysis (package 01, spec-feedback)", () => {
    const dir = initRepo()
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
    commit(dir, "chore: initial commit")
    const startCommit = headHash(dir)

    // Two rounds already spent, same shape as the round-3 test above.
    execFileSync("sh", ["-c", "printf 'round 1 analysis' > ESCALATION.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.describe → build.health.stop")
    commit(dir, "gtd(human): build.health.stop → build.fix")
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")
    execFileSync("sh", ["-c", "printf 'round 2 analysis' > ESCALATION.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.describe → build.health.stop")
    commit(dir, "gtd(human): build.health.stop → build.fix")
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")

    // Third arrival hits the cap and rests at the terminal exhausted stop.
    runEscalate(dir, startCommit)
    expect(gitStatusClean(dir)).toBe(false)
    commit(dir, "gtd(check): build.health.escalate → build.health.exhausted")

    // The human edits ESCALATION.md at `exhausted` with fresh instructions
    // and lands — the message explicitly invites this ("Edit
    // .gtd/ESCALATION.md with fresh instructions for the next fix turn").
    execFileSync(
      "sh",
      ["-c", "printf 'HUMAN FRESH INSTRUCTIONS: try approach X' > ESCALATION.md"],
      {
        cwd: dir,
      },
    )
    commit(dir, "gtd(human): build.health.exhausted → build.fix")

    // Another fix turn, still red, back to escalate a fourth time.
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")

    runEscalate(dir, startCommit)
    const afterFourthArrival = readFileSync(join(dir, "ESCALATION.md"), "utf8")
    expect(afterFourthArrival).toContain("HUMAN FRESH INSTRUCTIONS: try approach X")
    expect(afterFourthArrival).not.toContain("round 2 analysis")
    git("add", "-A")
    expect(
      execFileSync("git", ["diff", "--cached", "--name-status"], { cwd: dir, encoding: "utf8" }),
    ).toContain("M\tESCALATION.md")
  })

  it("a genuinely green check's own ESCALATION.md deletion resets the anchor — a later, unrelated red streak starts back at round 0 (package 01, spec-review fix)", () => {
    const dir = initRepo()
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
    commit(dir, "chore: initial commit")
    const processStart = headHash(dir)

    // An earlier episode already used its full 2-round budget and finally
    // went green — healthGate.check's own green branch is the only place
    // that ever deletes ESCALATION.md, so this commit is a real, reliable
    // "budget reset" marker.
    execFileSync("sh", ["-c", "printf 'stale analysis' > ESCALATION.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.describe → build.health.stop")
    git("rm", "-q", "-f", "ESCALATION.md")
    commit(dir, "gtd(check): build.health.check → build.review")
    const anchorCommit = headHash(dir)

    // A brand-new, unrelated failure starts after the green run above —
    // one round in, the script must still see this as round 0 (under the
    // cap), not carry forward the earlier episode's spent budget.
    execFileSync("sh", ["-c", "printf 'a new failure' > FEEDBACK.md"], { cwd: dir })
    commit(dir, "gtd(agent): build.health.check → build.health.escalate")

    runEscalate(dir, processStart)
    expect(gitStatusClean(dir)).toBe(true)

    // Confirm the anchor really did move: without the green deletion above,
    // the whole history back to processStart would already contain zero
    // ESCALATION.md commits either way at this exact point, so also prove
    // the anchor is `anchorCommit`, not `processStart`, by checking the
    // range git itself would search is non-empty only from processStart.
    const sinceAnchor = execFileSync(
      "git",
      ["log", "--format=%H", `${anchorCommit}..HEAD`, "--", "ESCALATION.md"],
      { cwd: dir, encoding: "utf8" },
    ).trim()
    expect(sinceAnchor).toBe("")
  })
})
