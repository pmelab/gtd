/**
 * Unit tests for src/program.ts — behavioral coverage of `step <actor>` /
 * `next` / `status` / `--entry` against an in-memory repo, plus the pure
 * refusal-classifier functions (`classifyReviewSignoff`,
 * `classifyFeedbackProgress`, `classifyAnswerCompleteness`) and
 * `computeNextMatch`. Argv parsing, flags, help/version, and the envelope
 * shape are `src/Cli.ts`'s job now — pinned in `src/Cli.test.ts` — so this
 * file no longer touches any of that; every scenario here runs a resolved
 * command through the real `runCli` shell over an in-memory repo, exactly
 * like the `@inmem` e2e tier (`tests/integration/support/inmem/cliIo.ts`).
 */

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { runCli } from "./Cli.js"
import { computeNextMatch } from "./program.js"
import type { OnEdge, PendingChange } from "./PatternMachine.js"
import { renderInitConfig } from "./workflows/templates.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { makeCapturingCliIo } from "./testing/cliIo.js"
import { applyEmittedScript } from "./testing/EmittedScriptRecognizer.js"
import { commitAll, shellQuote } from "./GitScript.js"
import { HISTORY_REF } from "./RetainedHistory.js"
import {
  abandonNoopOutcome,
  abandonNoopText,
  noopText,
  noteOutcome,
  restoredOutcome,
  restoredText,
} from "./OutcomeScript.js"

/** Runs `args` through the real CLI shell (`runCli`) against an in-memory repo, returning the captured stdout/stderr/exit code — the same shape `tests/integration/support/world.ts`'s `@inmem` tier observes. */
const run = async (
  repo: InMemRepo,
  ...args: string[]
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> => {
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
  return result()
}

describe("gtd step <actor> --entry <state> — a custom workflow declaring `entry: true`", () => {
  // The generic entry mechanism that replaced `gtd review`/`gtd fix`: any
  // declared, non-commit state may be entered directly via `--entry`, not
  // just one flagged `entry: true` (that narrower set only seeds the
  // workflow's OWN `entries.manual` reachability roots — see
  // `PatternMachine.enterableStates`'s doc comment). Needs a real (in-memory)
  // repo, like the old review/fix guard tests it replaces — mirrors the
  // InMemRepo + testLayers precedent in src/Git.test.ts.

  const CUSTOM_WORKFLOW = [
    "workflow:",
    "  vars:",
    "    greeting: hello",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: go",
    "          on:",
    '            "* **": idle',
    "        side-entry:",
    "          entry: true",
    "          actor: human",
    "          message: entering",
    "          on:",
    '            "* **": working',
    "",
  ].join("\n")

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", CUSTOM_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it("the happy path previews the resulting subject and emits a required script — gtd itself writes nothing", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(repo, "step", "human", "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("committed: gtd(human): side-entry")
    // `gtd step --entry` is now a pure emitter — no commit lands until the
    // external driver runs the printed script.
    expect(repo.commitHistory()).toHaveLength(before)

    const { stdout: jsonOut, exitCode: jsonExit } = await run(
      repo,
      "step",
      "human",
      "--entry",
      "side-entry",
      "--json",
    )
    expect(jsonExit).toBe(0)
    const parsed = JSON.parse(jsonOut) as { subject: string; required: string }
    expect(parsed.subject).toBe("gtd(human): side-entry")
    expect(parsed.required).toContain(shellQuote(commitAll("gtd(human): side-entry")))
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("--entry naming an undeclared state refuses, listing every enterable state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(repo, "step", "human", "--entry", "bogus-state")
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("enterable states")
    expect(stderr).toContain("idle")
    expect(stderr).toContain("side-entry")
    expect(stderr).toContain("working")
  })

  it("a process already underway (not resting at the initial state) refuses", async () => {
    const repo = seededRepo()
    repo.writeFile(".gtd/TODO.md", "sketch\n")
    repo.commitAllWithPrefix("gtd(agent): working")
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(repo, "step", "human", "--entry", "side-entry")
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("already underway")
  })

  it("an undeclared --var name refuses, listing the declared names", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(
      repo,
      "step",
      "human",
      "--entry",
      "side-entry",
      "--var",
      "bogus=1",
    )
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("bogus")
    expect(stderr).toContain("greeting")
  })

  it("a declared --var override renders as a Gtd-Var trailer in the emitted commit script", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exitCode, stdout } = await run(
      repo,
      "step",
      "human",
      "--entry",
      "side-entry",
      "--var",
      "greeting=world",
      "--json",
    )
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { required: string }
    expect(parsed.required).toContain("Gtd-Var: greeting=world")
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a dirty working tree does not refuse entry — the emitted script would capture it (commitAll, unlike the old commitAsIs-based gtd review/gtd fix)", async () => {
    const repo = seededRepo()
    repo.writeFile("scratch.txt", "uncommitted\n")
    const before = repo.commitHistory().length
    const { exitCode, stdout } = await run(repo, "step", "human", "--entry", "side-entry", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { required: string }
    expect(parsed.required.length).toBeGreaterThan(0)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("the subcommand-less short form `gtd --entry <state>` dispatches as human, emitting the same script", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "--entry", "side-entry", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { subject: string; required: string }
    expect(parsed.subject).toBe("gtd(human): side-entry")
    expect(parsed.required).toContain(shellQuote(commitAll("gtd(human): side-entry")))
  })
})

describe("gtd step <actor> --entry <state> — the bundled unified template", () => {
  // Full downstream coverage (the review checkout window, feedback laps, the
  // fix-precheck green-baseline gate) lives in entry.feature/
  // fix-entry.feature; these pin only the entry commit itself — the same
  // happy-path shape the old `gtd review`/`gtd fix` tests pinned.

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
    return repo
  }

  it("--entry review-gate.check --var reviewBase=<base> emits a script that would start a review process anchored to that base", async () => {
    // review-gate.check declares a template-form `reviewBase:` (fixing the
    // whole process's diff base) — entering it requires a `--var
    // reviewBase=<commitish>` that resolves to an ancestor of HEAD distinct
    // from HEAD; the blank-default/no-ancestor refusals are covered in
    // entry.feature.
    const repo = seededRepo()
    const base = repo.commitHistory().at(-1)!.hash
    repo.writeFile("scratch.txt", "more work\n")
    repo.commitAllWithPrefix("chore: more work")
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(
      repo,
      "step",
      "human",
      "--entry",
      "review-gate.check",
      "--var",
      `reviewBase=${base}`,
      "--json",
    )
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { subject: string; required: string }
    expect(parsed.subject).toBe("gtd(human): review-gate.check")
    expect(parsed.required).toContain("gtd(human): review-gate.check")
    expect(parsed.required).toContain(`Gtd-Review-Base: ${base}`)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("--entry fix-precheck emits a script that would start a fix process at the template's own fix-entry state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(
      repo,
      "step",
      "human",
      "--entry",
      "fix-precheck",
      "--json",
    )
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { subject: string; required: string }
    expect(parsed.subject).toBe("gtd(human): fix-precheck")
    expect(parsed.required).toContain("gtd(human): fix-precheck")
    expect(repo.commitHistory()).toHaveLength(before)
  })
})

describe("gtd next --json / gtd status — label emission", () => {
  // `label:` is a display-only state hint rendered/emitted exactly like
  // `model:`/`memory:` (see src/Edge.ts's renderLabel) — pinned end-to-end in
  // tests/integration/features/driver-json-status.feature for `model:`; these
  // mirror that coverage for `label:` at the unit level.

  const workflowWithLabel = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          label: planning",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const workflowWithoutLabel = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const seededRepoAt = (workflowYaml: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.writeFile(".gtdrc.yaml", workflowYaml)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    return repo
  }

  it("gtd next --json carries the state's declared label hint", async () => {
    const repo = seededRepoAt(workflowWithLabel)
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.label).toBe("planning")
  })

  it("gtd next --json omits label entirely when the state declares none", async () => {
    const repo = seededRepoAt(workflowWithoutLabel)
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("label")
  })

  it("gtd status shows the state's declared label hint as a plain-text Label: line", async () => {
    const repo = seededRepoAt(workflowWithLabel)
    const { stdout, exitCode } = await run(repo, "status")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("State: working")
    expect(stdout).toContain("Label: planning")
  })

  it("gtd status --json carries the state's declared label hint", async () => {
    const repo = seededRepoAt(workflowWithLabel)
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.label).toBe("planning")
  })

  it("gtd status --json omits label entirely when the state declares none", async () => {
    const repo = seededRepoAt(workflowWithoutLabel)
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("label")
  })
})

describe("gtd next --json / gtd status — memory key emission", () => {
  // `memory` is now COMPUTED (src/Edge.ts's `memoryKeyFor`, package 05/06)
  // from the resting state's scope (`ConfigOperations.stateScopes`) and a
  // commit-anchored hash — there is no authored `memory:` state key at all
  // (package 10 removed it outright) — pinned end-to-end for a realistic
  // nested-scope, repeated-entry trace in
  // tests/integration/features/gtd-loop.feature; these mirror that coverage
  // at the unit level. This workflow is a single flat "root" machine (no
  // sub-machine references), so every one of its states' scope is `""` — the
  // root — displayed as `memoryKeyFor`'s `"root"` fallback name.

  const workflowPrompt = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const workflowNonPrompt = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": checking',
    "        checking:",
    "          actor: check",
    "          script: echo hi",
    "          on:",
    '            "C": idle',
    "",
  ].join("\n")

  const seededRepoAt = (workflowYaml: string, lastCommitSubject: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.writeFile(".gtdrc.yaml", workflowYaml)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  const MEMORY_KEY = /^root#[0-9a-f]{7}$/

  it("gtd next --json computes a <scope>#<hash7> memory key for a prompt rest", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.memory).toMatch(MEMORY_KEY)
  })

  it("gtd status --json computes the same memory key shape", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.memory).toMatch(MEMORY_KEY)
  })

  it("gtd status shows the computed memory key as a plain-text Memory: line", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { stdout, exitCode } = await run(repo, "status")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("State: working")
    expect(stdout).toMatch(/Memory: root#[0-9a-f]{7}/)
  })

  it("gtd next --json omits memory entirely for a non-prompt rest", async () => {
    const repo = seededRepoAt(workflowNonPrompt, "gtd(human): checking")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("memory")
  })

  it("gtd status --json omits memory entirely for a non-prompt rest", async () => {
    const repo = seededRepoAt(workflowNonPrompt, "gtd(human): checking")
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("memory")
  })

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  it("gtd next --json mints a fresh sessionId for a prompt rest, resume: false", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.sessionId).toMatch(UUID)
    expect(parsed.resume).toBe(false)
  })

  it("gtd next --json resumes the SAME sessionId once a step has confirmed it", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const first = JSON.parse((await run(repo, "next", "--json")).stdout) as Record<string, unknown>
    const { exitCode: stepExit } = await run(repo, "step", "agent")
    expect(stepExit).toBe(0)
    const second = JSON.parse((await run(repo, "next", "--json")).stdout) as Record<string, unknown>
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.resume).toBe(true)
  })

  it("two gtd next --json calls with no step in between mint DIFFERENT ids, both resume: false", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const first = JSON.parse((await run(repo, "next", "--json")).stdout) as Record<string, unknown>
    const second = JSON.parse((await run(repo, "next", "--json")).stdout) as Record<string, unknown>
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.resume).toBe(false)
    expect(second.resume).toBe(false)
  })

  it("gtd status --json omits sessionId/resume even at a prompt rest", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("sessionId")
    expect(parsed).not.toHaveProperty("resume")
  })

  it("gtd next --json omits sessionId/resume for a non-prompt rest", async () => {
    const repo = seededRepoAt(workflowNonPrompt, "gtd(human): checking")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("sessionId")
    expect(parsed).not.toHaveProperty("resume")
  })
})

describe("gtd next — refuses when HEAD names a state the current workflow no longer declares", () => {
  // A workflow upgrade that renames/removes a state out from under an
  // in-flight process must not look like a fresh, idle repo (silently
  // falling back to the initial state) — it must refuse loudly, pointing at
  // `gtd abandon` as the escape hatch, exactly like the earlier
  // `entry.review`/`entry.fix` removal's courtesy message. Distinct from a
  // state merely missing from `scopes` (package 04's `memoryScopeAt`, a
  // compiler bug) — this is a state absent from `definition.states` entirely.

  const workflow = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: go",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const seededRepoAt = (lastCommitSubject: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  it("refuses, naming the vanished state and pointing at `gtd abandon`", async () => {
    const repo = seededRepoAt("gtd(agent): renamedAway")
    const { exitCode, stderr } = await run(repo, "next")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("renamedAway")
    expect(stderr).toContain("gtd abandon")
  })

  it("a state that IS declared, resting normally, is unaffected", async () => {
    const repo = seededRepoAt("gtd(human): working")
    const { exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
  })

  it("`gtd abandon` itself still works for a renamed-away rest — the escape hatch it points to must not refuse right alongside everything else", async () => {
    const repo = seededRepoAt("gtd(agent): renamedAway")
    const before = repo.commitHistory().length

    // Plain text keeps today's friendly wording (abandon now EMITS its
    // mutation instead of performing it, so this call alone changes nothing).
    const plain = await run(repo, "abandon")
    expect(plain.exitCode).toBe(0)
    expect(plain.stdout).toContain('abandoned the process resting at "renamedAway"')
    expect(repo.commitHistory()).toHaveLength(before)

    // Applying the emitted required script is what actually performs it.
    const { stdout, exitCode } = await run(repo, "abandon", "--json")
    expect(exitCode).toBe(0)
    const { required } = JSON.parse(stdout) as { required: string }
    const applied = applyEmittedScript(repo, new Map(), required)
    expect(applied.ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before - 1)
  })
})

describe("outcome scripts — step no-op / abandon no-op / restore", () => {
  const WORKFLOW = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: go",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it("a clean-tree step is a no-op whose required script is print-only, naming the resting state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length

    const plain = await run(repo, "step", "human")
    expect(plain.exitCode).toBe(0)
    expect(plain.stdout).toBe(noopText("idle"))

    const { stdout, exitCode } = await run(repo, "step", "human", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { subject: string | null; required: string }
    expect(parsed.subject).toBeNull()
    expect(parsed.required).toContain(noteOutcome(noopText("idle")))

    const applied = applyEmittedScript(repo, new Map(), parsed.required)
    expect(applied.ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("gtd abandon with nothing underway emits a print-only required script carrying the same wording", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length

    const plain = await run(repo, "abandon")
    expect(plain.exitCode).toBe(0)
    expect(plain.stdout).toBe(abandonNoopText("idle"))

    const { stdout, exitCode } = await run(repo, "abandon", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { abandoned: boolean; required: string }
    expect(parsed.abandoned).toBe(false)
    expect(parsed.required).toContain(abandonNoopOutcome("idle"))

    const applied = applyEmittedScript(repo, new Map(), parsed.required)
    expect(applied.ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("gtd restore's script prints the post-hoc short hash/subject via gtd_report_restored", async () => {
    const repo = seededRepo()
    repo.commitAllWithPrefix("gtd(agent): working")
    const tip = repo.resolveRef("HEAD")!
    const tipSubject = repo.lastCommitMessage()!
    repo.updateRef(HISTORY_REF, tip)
    // Case (b) of `restorability`: HEAD is an ancestor of the retained tip —
    // e.g. an abandon happened after the squash this history retains.
    repo.hardResetTo(repo.resolveRef("HEAD~1")!)

    const plain = await run(repo, "restore")
    expect(plain.exitCode).toBe(0)
    expect(plain.stdout).toBe(restoredText(tip.slice(0, 7), tipSubject, "working"))

    const { stdout, exitCode } = await run(repo, "restore", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as { to: string; required: string }
    expect(parsed.required).toContain(restoredOutcome(tip, "working"))

    const applied = applyEmittedScript(repo, new Map(), parsed.required)
    expect(applied.ok).toBe(true)
    expect(repo.resolveRef("HEAD")).toBe(tip)
  })
})

describe("gtd step — StepPayload.processTrace still receives plain state names", () => {
  // `ProcessRun.trace` widened to `TraceEntry[]` (state + commit hash, for
  // `memoryKeyFor` — package 05/06), but `PatternMachine.step`'s
  // `StepPayload.processTrace` stays `readonly StateName[]` — retry-entry
  // counting (`applyRetry`) only ever compares state NAMES. If the mapping
  // at the one call site (`stepAsActor`, src/program.ts) ever regressed to
  // pass `TraceEntry` objects through instead, retry redirection would never
  // trigger (an object never `===` a string), so this pins the real
  // end-to-end behavior, not just the type.

  const workflow = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": looping',
    "        looping:",
    "          actor: agent",
    "          prompt: go",
    "          retry:",
    "            max: 1",
    "            otherwise: idle",
    "          on:",
    '            "* **": looping',
    "",
  ].join("\n")

  it("redirects via `retry.otherwise` once the prior-visit count in the trace reaches `max`", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    // Simulates having already entered "looping" once this process — the
    // ONE prior visit `retry.max: 1` allows before redirecting.
    repo.commitAllWithPrefix("gtd(human): looping")
    repo.writeFile("src/fix.ts", "export const x = 1\n")

    const { stdout, exitCode } = await run(repo, "step", "agent", "--json")
    expect(exitCode).toBe(0)
    const { required } = JSON.parse(stdout) as { required: string }
    const applied = applyEmittedScript(repo, new Map(), required)
    expect(applied.ok).toBe(true)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): looping → idle")
  })
})

describe("gtd check <mode> <file>", () => {
  // Fully standalone (needsOf("check") === "none") — no config, no commit, no
  // git state at all is required; the file just needs to exist in the
  // in-memory worktree. Sample valid/invalid content mirrors
  // OpenQuestions.test.ts's `questionsDoc`/`malformed` and
  // ReviewDoc.test.ts's `reviewDoc`.

  const validQaDoc = [
    "# Plan",
    "",
    "## Open Questions",
    "",
    "### Which operations?",
    "",
    "add and subtract.",
    "",
    "## Answered Questions",
    "",
    "### What is the target platform?",
    "",
    "web only.",
    "",
  ].join("\n")

  const invalidQaDoc = ["## Open Questions", "", "###", "", "no question text.", ""].join("\n")

  const validReviewDoc = [
    "# Review: abc1234",
    "<!-- base: abc1234def5678901234567890123456789abcd -->",
    "",
    "## Add calculator",
    "",
    "- [x] ./src/calc.ts#1",
    "",
  ].join("\n")

  const invalidReviewDoc = "Just some text\n"

  const bareRepo = (): InMemRepo => new InMemRepo()

  it("exits 0 with no output for valid qa content", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", validQaDoc)
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("exits 0 with no output for valid review content", async () => {
    const repo = bareRepo()
    repo.writeFile("REVIEW.md", validReviewDoc)
    const { stdout, exitCode } = await run(repo, "check", "review", "REVIEW.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("invalid qa content prints each finding one per line and exits non-zero", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", invalidQaDoc)
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md")
    expect(exitCode).toBe(1)
    expect(stdout.trim().split("\n")).toEqual([
      "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
    ])
  })

  it("invalid review content prints each finding one per line and exits non-zero", async () => {
    const repo = bareRepo()
    repo.writeFile("REVIEW.md", invalidReviewDoc)
    const { stdout, exitCode } = await run(repo, "check", "review", "REVIEW.md")
    expect(exitCode).toBe(1)
    const lines = stdout.trim().split("\n")
    expect(lines).toContain(
      "Missing or malformed '# Review: <hash>' header as the document's first line",
    )
    expect(lines).toContain("Missing '<!-- base: <hash> -->' comment")
    expect(lines).toContain("REVIEW.md has no '##' chunks")
  })

  it("an absent file exits 0 with no output", async () => {
    const repo = bareRepo()
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("an unknown mode is a usage-style error naming the known modes", async () => {
    const repo = bareRepo()
    repo.writeFile("TODO.md", validQaDoc)
    const { stderr, exitCode } = await run(repo, "check", "bogus", "TODO.md")
    expect(exitCode).toBe(1)
    expect(stderr).toContain('unknown mode "bogus"')
    expect(stderr).toContain("qa")
    expect(stderr).toContain("review")
  })

  it("--json reports {valid: true, errors: []} for valid content", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", validQaDoc)
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.trim().split("\n")[0]!)).toEqual({ valid: true, errors: [] })
  })

  it("--json reports {valid: true, errors: []} for an absent file", async () => {
    const repo = bareRepo()
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.trim().split("\n")[0]!)).toEqual({ valid: true, errors: [] })
  })

  it("--json reports {valid: false, errors} for invalid content, still exiting non-zero", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", invalidQaDoc)
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md", "--json")
    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout.trim().split("\n")[0]!)).toEqual({
      valid: false,
      errors: [
        "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
      ],
    })
  })

  it("--json invalid content emits stdout as TWO newline-delimited JSON documents: the body, then Cli.ts's generic error envelope", async () => {
    // `runCheckCommand` writes its own {valid,errors} body before failing the
    // Effect; `Cli.ts`'s single envelope writer ALSO puts a {state:"error",prompt}
    // object on stdout for any failing --json invocation — so this handler is
    // the one command whose --json stdout is line-delimited JSON, not a single
    // document. Pinned here because the first-line-only reads above wouldn't
    // notice a regression on the second line.
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", invalidQaDoc)
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md", "--json")
    expect(exitCode).toBe(1)
    const lines = stdout.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toEqual({
      valid: false,
      errors: [
        "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
      ],
    })
    expect(JSON.parse(lines[1]!)).toEqual({
      state: "error",
      prompt: 'gtd check: .gtd/TODO.md is not valid under mode "qa" (1 finding(s))',
    })
  })
})

describe("computeNextMatch", () => {
  // Pure unit coverage — mirrors `PatternMachine.step`'s own `matchOn`
  // first-match-wins semantics, but over the WHOLE change list at once
  // (unlike `computeStatusChanges`, which checks each change in isolation).

  it("picks the first matching edge in declaration order, ignoring later matches", () => {
    const onEdges: readonly OnEdge[] = [
      ["* NOTE.md", "first-target", undefined, "First action"],
      ["M **/*.md", "second-target", undefined, "Second action"],
    ]
    const changes: readonly PendingChange[] = [{ status: "M", path: "NOTE.md" }]
    expect(computeNextMatch(onEdges, changes)).toEqual({
      action: "First action",
      pattern: "* NOTE.md",
      target: "first-target",
    })
  })

  it("returns null when no declared pattern matches the pending changes", () => {
    const onEdges: readonly OnEdge[] = [["A NOTE.md", "planned"]]
    const changes: readonly PendingChange[] = [{ status: "M", path: "OTHER.md" }]
    expect(computeNextMatch(onEdges, changes)).toBeNull()
  })

  it("returns null on a clean tree when the state declares no `C` row", () => {
    const onEdges: readonly OnEdge[] = [["A NOTE.md", "planned"]]
    expect(computeNextMatch(onEdges, [])).toBeNull()
  })

  it("matches a declared `C` row against a clean tree", () => {
    const onEdges: readonly OnEdge[] = [["C", "idle", undefined, "Loop"]]
    expect(computeNextMatch(onEdges, [])).toEqual({
      action: "Loop",
      pattern: "C",
      target: "idle",
    })
  })
})

describe("gtd status — Next: preview", () => {
  // Exercises `computeNextMatch` wired through `gtd status`'s plain-text
  // `Next:` line and `--json`'s `next` key. The workflow below carries one
  // edge with an `action`, one without (falls back to the raw `pattern`),
  // and leaves a third change unmatched by either.

  const workflowWithNextEdges = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "A PLAN.md":',
    "              to: accepted",
    "              action: Accept plan",
    '            "M REVIEW.md": idle',
    "        accepted:",
    "          actor: human",
    "          message: plan accepted",
    "",
  ].join("\n")

  const seededRepoAt = (workflowYaml: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.writeFile(".gtdrc.yaml", workflowYaml)
    repo.writeFile("REVIEW.md", "old review\n")
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    return repo
  }

  it("gtd status shows `Next:` with the action when the matched edge carries one", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("PLAN.md", "the plan\n")
    const { stdout, exitCode } = await run(repo, "status")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Next: Accept plan → accepted")
  })

  it("gtd status --json's `next` carries the action when the matched edge has one", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("PLAN.md", "the plan\n")
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.next).toEqual({
      action: "Accept plan",
      pattern: "A PLAN.md",
      target: "accepted",
    })
  })

  it("gtd status falls back to the raw pattern when the matched edge carries no action", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("REVIEW.md", "an updated review\n")
    const { stdout, exitCode } = await run(repo, "status")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Next: M REVIEW.md → idle")
  })

  it("gtd status --json's `next` omits `action` and falls back to `pattern` when the matched edge has none", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("REVIEW.md", "an updated review\n")
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.next).toEqual({ pattern: "M REVIEW.md", target: "idle" })
  })

  it("gtd status shows the no-match line when the pending change matches no declared pattern", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("OTHER.md", "unrelated\n")
    const { stdout, exitCode } = await run(repo, "status")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Next: (no match — nothing would happen)")
  })

  it("gtd status --json's `next` is present-but-null (never omitted) on no match", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("OTHER.md", "unrelated\n")
    const { stdout, exitCode } = await run(repo, "status", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty("next")
    expect(parsed.next).toBeNull()
  })
})
