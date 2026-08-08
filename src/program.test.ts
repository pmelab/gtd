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
import {
  classifyAnswerCompleteness,
  classifyFeedbackProgress,
  classifyReviewSignoff,
  computeNextMatch,
} from "./program.js"
import type { OnEdge, PendingChange } from "./PatternMachine.js"
import { renderInitConfig } from "./workflows/templates.js"
import { InMemRepo } from "../tests/integration/support/inmem/Repo.js"
import { makeCapturingCliIo } from "../tests/integration/support/inmem/cliIo.js"

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
  // InMemRepo + inMemoryLayers precedent in src/Git.test.ts.

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

  it("the happy path writes one turn commit resting at the entered state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(repo, "step", "human", "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("committed: gtd(human): side-entry")
    expect(repo.commitHistory()).toHaveLength(before + 1)
    expect(repo.lastCommitSubject()).toBe("gtd(human): side-entry")
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

  it("a declared --var override is recorded as a Gtd-Var trailer on the entry commit", async () => {
    const repo = seededRepo()
    const { exitCode } = await run(
      repo,
      "step",
      "human",
      "--entry",
      "side-entry",
      "--var",
      "greeting=world",
    )
    expect(exitCode).toBe(0)
    const message = repo.commitHistory().at(-1)!.message
    expect(message).toContain("Gtd-Var: greeting=world")
  })

  it("a dirty working tree is CAPTURED, not refused (commitAllWithPrefix, unlike the old commitAsIs-based gtd review/gtd fix)", async () => {
    const repo = seededRepo()
    repo.writeFile("scratch.txt", "uncommitted\n")
    const before = repo.commitHistory().length
    const { exitCode } = await run(repo, "step", "human", "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(repo.commitHistory()).toHaveLength(before + 1)
  })

  it("the subcommand-less short form `gtd --entry <state>` dispatches as human", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("committed: gtd(human): side-entry")
    expect(repo.lastCommitSubject()).toBe("gtd(human): side-entry")
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

  it("--entry review-gate.check --var reviewBase=<base> starts a review process anchored to that base", async () => {
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
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain("committed: gtd(human): review-gate.check")
    expect(repo.commitHistory()).toHaveLength(before + 1)
    expect(repo.lastCommitSubject()).toBe("gtd(human): review-gate.check")
  })

  it("--entry fix-precheck starts a fix process at the template's own fix-entry state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(repo, "step", "human", "--entry", "fix-precheck")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("committed: gtd(human): fix-precheck")
    expect(repo.commitHistory()).toHaveLength(before + 1)
    expect(repo.lastCommitSubject()).toBe("gtd(human): fix-precheck")
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
    const { stdout, exitCode } = await run(repo, "abandon")
    expect(exitCode).toBe(0)
    expect(stdout).toContain('abandoned the process resting at "renamedAway"')
    expect(repo.commitHistory()).toHaveLength(before - 1)
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

    const { exitCode } = await run(repo, "step", "agent")
    expect(exitCode).toBe(0)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): looping → idle")
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

describe("classifyReviewSignoff", () => {
  const base = {
    file: ".gtd/REVIEW.md",
    stateName: "await-review",
    invoker: "human",
    reviewDocDeleted: false,
    hasCodeChange: false,
  }
  const twoUnticked = "## C\n- [ ] ./a.ts#1\n- [ ] ./b.ts#1\n"
  const allTicked = "## C\n- [x] ./a.ts#1\n- [x] ./b.ts#1\n"

  it("refuses a deleted review doc", () => {
    const v = classifyReviewSignoff({
      ...base,
      reviewDocDeleted: true,
      original: twoUnticked,
      current: "",
    })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") expect(v.reason).toContain("was deleted")
  })

  it("allows a code edit (a comment) even with boxes unticked", () => {
    const v = classifyReviewSignoff({
      ...base,
      hasCodeChange: true,
      original: twoUnticked,
      current: twoUnticked,
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a note — the doc differs beyond a tick — even with a box left unticked", () => {
    const v = classifyReviewSignoff({
      ...base,
      original: twoUnticked,
      current: "## C\n- [x] ./a.ts#1\n- [ ] ./b.ts#1 — please rename\n",
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a clean sign-off: every box ticked, no note, no code", () => {
    const v = classifyReviewSignoff({ ...base, original: twoUnticked, current: allTicked })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses an unfinished review: only tick-flips, a box still unticked, no comment", () => {
    const v = classifyReviewSignoff({
      ...base,
      original: twoUnticked,
      current: "## C\n- [x] ./a.ts#1\n- [ ] ./b.ts#1\n",
    })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") expect(v.reason).toContain("1 review item(s) still unticked")
  })
})

describe("classifyFeedbackProgress", () => {
  const base = {
    file: ".gtd/REVIEW_FEEDBACK.md",
    stateName: "feedback-building",
    invoker: "agent",
    deletedContent: "1. ./a.ts#1 — rename the export\n",
  }
  const del = { path: ".gtd/REVIEW_FEEDBACK.md", status: "D" } as const

  it("refuses deleting the instructions file with no code change (the original bug)", () => {
    const v = classifyFeedbackProgress({ ...base, changes: [del] })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") expect(v.reason).toContain("without addressing its instructions")
  })

  it("allows deleting the file when a code change accompanies it (real work done)", () => {
    const v = classifyFeedbackProgress({
      ...base,
      changes: [del, { path: "src/a.ts", status: "M" }],
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a NOTHING ACTIONABLE sentinel to be deleted with no code change", () => {
    const v = classifyFeedbackProgress({
      ...base,
      changes: [del],
      deletedContent: "NOTHING ACTIONABLE — the human left only an approving remark.\n",
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows a turn that does not delete the instructions file", () => {
    const v = classifyFeedbackProgress({ ...base, changes: [{ path: "src/a.ts", status: "M" }] })
    expect(v).toEqual({ kind: "allow" })
  })

  it("treats other .gtd/ churn alongside the delete as no code change (still refused)", () => {
    const v = classifyFeedbackProgress({
      ...base,
      changes: [del, { path: ".gtd/REVIEW_RAW.md", status: "D" }],
    })
    expect(v.kind).toBe("refuse")
  })
})

describe("classifyAnswerCompleteness", () => {
  const base = { file: ".gtd/REQUIREMENTS.md", stateName: "product-answer", invoker: "human" }
  const doc = (options: readonly string[]): string =>
    ["Build a thing.", "", "## Open Questions", "", "### Which API?", "", ...options, ""].join("\n")

  it("allows when there are no open questions (agent surfaced none / accept-all)", () => {
    const v = classifyAnswerCompleteness({ ...base, content: "Build a thing. Plan: do it.\n" })
    expect(v).toEqual({ kind: "allow" })
  })

  it("allows when the whole Open Questions section was deleted", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: "Build a thing.\n\n## Answered Questions\n\n### Which API?\n\nUse tRPC.\n",
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses when an open question has no ticked option", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [ ] GraphQL", "- [ ] _your answer_"]),
    })
    expect(v.kind).toBe("refuse")
    if (v.kind === "refuse") {
      expect(v.reason).toContain("1 open question(s)")
      expect(v.reason).toContain("Which API?")
    }
  })

  it("allows when every open question has exactly one tick", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [x] GraphQL", "- [ ] _your answer_"]),
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses a ticked-but-empty free-text slot", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [ ] GraphQL", "- [x] _your answer_"]),
    })
    expect(v.kind).toBe("refuse")
  })

  it("allows a ticked free-text slot with text", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [ ] REST", "- [ ] GraphQL", "- [x] use tRPC"]),
    })
    expect(v).toEqual({ kind: "allow" })
  })

  it("refuses when two options are ticked (ambiguous)", () => {
    const v = classifyAnswerCompleteness({
      ...base,
      content: doc(["- [x] REST", "- [x] GraphQL", "- [ ] _your answer_"]),
    })
    expect(v.kind).toBe("refuse")
  })

  it("refuses an open question that has no checkbox options at all", () => {
    const v = classifyAnswerCompleteness({ ...base, content: doc(["some prose, no boxes"]) })
    expect(v.kind).toBe("refuse")
  })
})
