/**
 * Unit tests for src/program.ts — behavioral coverage of `land` /
 * `next` / `--entry` against an in-memory repo, plus the pure
 * refusal-classifier functions (`classifyReviewSignoff`,
 * `classifyFeedbackProgress`, `classifyAnswerCompleteness`) and
 * `computeNextMatch`. Argv parsing, flags, help/version, and the envelope
 * shape are `src/Cli.ts`'s job now — pinned in `src/Cli.test.ts` — so this
 * file no longer touches any of that; every scenario here runs a resolved
 * command through the real `runCli` shell over an in-memory repo, exactly
 * like the `@inmem` e2e tier (`tests/integration/support/inmem/cliIo.ts`).
 */

import { Effect, Exit, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { runCli, type Command } from "./Cli.js"
import { stallDiagnosis } from "./Beat.js"
import { computeNextMatch, needsOf, runCommand } from "./program.js"
import type { OnEdge, PendingChange } from "./PatternMachine.js"
import { renderInitConfig } from "./workflows/templates.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { makeCapturingCliIo } from "./testing/cliIo.js"
import { testLayers } from "./testing/Layers.js"
import { applyEmittedScript } from "./testing/EmittedScriptRecognizer.js"
import { commitAll, shellQuote } from "./GitScript.js"
import { HISTORY_REF } from "./RetainedHistory.js"
import { abandonNoopOutcome, noopText, noteOutcome, restoredOutcome } from "./OutcomeScript.js"

/** Runs `args` through the real CLI shell (`runCli`) against an in-memory repo, returning the captured stdout/stderr/exit code — the same shape `tests/integration/support/world.ts`'s `@inmem` tier observes. */
const run = async (
  repo: InMemRepo,
  ...args: string[]
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> => {
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
  return result()
}

describe("gtd --entry <state> — a custom workflow declaring `entry: true`", () => {
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
    const { stdout, exitCode } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(0)
    // `gtd --entry` is now a pure emitter — no commit lands until the
    // external driver runs the printed script. Plain text prints the script
    // itself, not a result line — the subject lives inside it. `--entry`
    // carries no `--json`/`--sh` of its own (only `next`/`land` do) — the
    // combined script IS the whole of stdout.
    expect(stdout).toContain(shellQuote(commitAll("gtd(human): side-entry")))
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("--entry naming an undeclared state refuses, listing every enterable state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(repo, "--entry", "bogus-state")
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
    const { exitCode, stderr } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("already underway")
  })

  it("an undeclared --var name refuses, listing the declared names", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(repo, "--entry", "side-entry", "--var", "bogus=1")
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("bogus")
    expect(stderr).toContain("greeting")
  })

  it("a declared --var override renders as a Gtd-Var trailer in the emitted commit script", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { exitCode, stdout } = await run(repo, "--entry", "side-entry", "--var", "greeting=world")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Gtd-Var: greeting=world")
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a dirty working tree does not refuse entry — the emitted script would capture it (commitAll, unlike the old commitAsIs-based gtd review/gtd fix)", async () => {
    const repo = seededRepo()
    repo.writeFile("scratch.txt", "uncommitted\n")
    const before = repo.commitHistory().length
    const { exitCode, stdout } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(stdout.length).toBeGreaterThan(0)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("the subcommand-less short form `gtd --entry <state>` dispatches as human, emitting the same script", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(shellQuote(commitAll("gtd(human): side-entry")))
  })
})

describe("gtd --entry <state> — the bundled unified template", () => {
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
      "--entry",
      "review-gate.check",
      "--var",
      `reviewBase=${base}`,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain("gtd(human): review-gate.check")
    expect(stdout).toContain(`Gtd-Review-Base: ${base}`)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("--entry fix-precheck emits a script that would start a fix process at the template's own fix-entry state", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(repo, "--entry", "fix-precheck")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("gtd(human): fix-precheck")
    expect(repo.commitHistory()).toHaveLength(before)
  })
})

describe("gtd next --json — label emission", () => {
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

  // `gtd next`'s plain encoding suppresses the whole header at a `prompt`
  // rest (the bytes ARE the agent's input — see `Beat.ts`'s
  // `renderBeatPlain`), so a plain-text `Label:` line can only be exercised
  // at a non-`prompt` rest — a dedicated message-kind fixture, below.
  it("gtd next shows the state's declared label hint as a plain-text Label: line at a non-prompt rest", async () => {
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
      "          message: write NOTE.md to start a process",
      "          on:",
      '            "* **": reviewing',
      "        reviewing:",
      "          actor: human",
      "          label: planning",
      "          message: check the note",
      "          on:",
      '            "* **": idle',
      "",
    ].join("\n")
    const repo = new InMemRepo()
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): reviewing")
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("State: reviewing")
    expect(stdout).toContain("Label: planning")
  })

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
})

describe("gtd next --json — log path emission (gtd#169)", () => {
  // `log` is the per-worktree loop log path (src/WorktreeState.ts's
  // `loopLogPath`) — always present, unlike the omit-when-unset keys above.

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd: init")
    return repo
  }

  it("defaults to .git/gtd-loop.log", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.log).toBe(".git/gtd-loop.log")
  })

  it("GTD_LOOP_LOG overrides it verbatim", async () => {
    const repo = seededRepo()
    const { io, result } = makeCapturingCliIo(repo, { GTD_LOOP_LOG: "/elsewhere/run.log" })
    await Effect.runPromise(runCli(["node", "gtd.js", "next", "--json"], io))
    const { stdout, exitCode } = result()
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.log).toBe("/elsewhere/run.log")
  })
})

describe("gtd next --json — memory key emission", () => {
  // `memory` is now COMPUTED (src/Edge.ts's `memoryKeyFor`, package 05/06)
  // from the resting state's scope (`ConfigOperations.stateScopes`) and a
  // commit-anchored hash — there is no authored `memory:` state key at all
  // (package 10 removed it outright) — pinned end-to-end for a realistic
  // nested-scope, repeated-entry trace in
  // tests/integration/features/derived-sessions.feature; these mirror that
  // coverage at the unit level. This workflow is a single flat "root" machine (no
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

  // A plain-text `Memory:` line is no longer reachable: memory is only ever
  // computed for a `prompt` rest, and `gtd next`'s plain encoding suppresses
  // the whole header there (the bytes ARE the agent's input) — the `--json`
  // coverage above is the only surface left that can observe this key.

  it("gtd next --json omits memory entirely for a non-prompt rest", async () => {
    const repo = seededRepoAt(workflowNonPrompt, "gtd(human): checking")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("memory")
  })

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  type WithSession = { readonly session?: { readonly id: string; readonly resume: boolean } }

  it("gtd next --json derives a session for a prompt rest, resume: false on the fresh scope-run", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as WithSession
    expect(parsed.session?.id).toMatch(UUID)
    expect(parsed.session?.resume).toBe(false)
  })

  it("two next --json calls back-to-back, with no step in between, yield the SAME id and resume — nothing is written, so a peek can never poison a beat", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const first = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    const second = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    expect(second.session?.id).toBe(first.session?.id)
    expect(first.session?.resume).toBe(false)
    expect(second.session?.resume).toBe(false)
  })

  it("purity property: three consecutive next --json calls at a prompt rest are byte-identical and leave the commit count unchanged", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const before = repo.commitHistory().length
    const first = (await run(repo, "next", "--json")).stdout
    const second = (await run(repo, "next", "--json")).stdout
    const third = (await run(repo, "next", "--json")).stdout
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(repo.commitHistory().length).toBe(before)
  })

  // A separate 3-state workflow — working (prompt) → check (script) → working
  // — mirroring the bundled template's own `implement → check → implement`
  // shape: unlike `workflowPrompt` (whose only round trip is THROUGH the
  // initial state, itself a fresh process boundary — see
  // `computeProcessRun`'s doc comment — and would wrongly reset the run), a
  // script excursion that never touches the initial state keeps the SAME
  // scope-run throughout, so this is what actually exercises "a turn commit
  // lands and resume flips true" rather than "a new process began".
  const workflowPromptThenCheck = [
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
    '            "* **": check',
    "        check:",
    "          actor: check",
    "          script: echo hi",
    "          on:",
    '            "* **": working',
    "",
  ].join("\n")

  it("resume flips false → true once a turn commit lands back at the same prompt state, id unchanged", async () => {
    const repo = seededRepoAt(workflowPromptThenCheck, "gtd(human): working")
    const first = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    expect(first.session?.resume).toBe(false)

    const applyLand = async (): Promise<void> => {
      const { stdout, exitCode } = await run(repo, "land")
      expect(exitCode).toBe(0)
      expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    }

    repo.writeFile("NOTE.md", "the agent did the work\n")
    await applyLand()
    repo.writeFile("FEEDBACK.md", "check ran\n")
    await applyLand()

    const second = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    expect(second.session?.id).toBe(first.session?.id)
    expect(second.session?.resume).toBe(true)
  })

  it("gtd next --json includes session at a prompt rest — the beat document merged into next (AGENTS.md's one structured surface)", async () => {
    const repo = seededRepoAt(workflowPrompt, "gtd(human): working")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as WithSession
    expect(parsed.session?.id).toMatch(UUID)
  })

  it("gtd next --json omits session for a non-prompt rest", async () => {
    const repo = seededRepoAt(workflowNonPrompt, "gtd(human): checking")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).not.toHaveProperty("session")
  })
})

describe("gtd next --json — stall detection (attempt commits)", () => {
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
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": checking',
    "        checking:",
    "          actor: check",
    "          script: echo hi",
    "          on:",
    '            "C": idle',
    "",
  ].join("\n")

  const seededAtIdle = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  const seededAt = (lastCommitSubject: string): InMemRepo => {
    const repo = seededAtIdle()
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  const landAgentStep = async (repo: InMemRepo): Promise<void> => {
    const { stdout } = await run(repo, "land")
    const applied = applyEmittedScript(repo, new Map(), stdout)
    expect(applied.ok).toBe(true)
  }

  it("is not kind stalled before the attempt lands", async () => {
    const repo = seededAt("gtd(human): working")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).not.toBe("stalled")
  })

  it("is kind stalled once `gtd land` has landed an empty attempt, with the diagnosis as content and no session/validate key", async () => {
    const repo = seededAt("gtd(human): working")
    await landAgentStep(repo)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): working")

    const { stdout } = await run(repo, "next", "--json")
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.kind).toBe("stalled")
    expect(parsed.content).toBe(stallDiagnosis("working", "agent"))
    expect(parsed).not.toHaveProperty("session")
    expect(parsed).not.toHaveProperty("validate")
  })

  it("a clean-tree entry commit at a prompt rest is NOT a stall — the actor differs (human entered, agent acts)", async () => {
    // An EMPTY human commit at the resting state — the exact shape a
    // clean-tree `gtd --entry working` leaves behind. Same state, same
    // emptiness as an attempt; only the actor tells them apart.
    const repo = seededAtIdle()
    repo.commitAllWithPrefix("gtd(human): working")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).toBe("prompt")
  })

  it("plain gtd next renders the stall diagnosis too — a human peek must not see the prompt that went nowhere", async () => {
    const repo = seededAt("gtd(human): working")
    await landAgentStep(repo)

    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    // `stalled` shows the header like every other non-`prompt` kind (see
    // `Beat.ts`'s `renderBeatPlain`) — the diagnosis rides in `content`,
    // after a blank line, not as the whole output any more.
    expect(stdout.startsWith("State: working\nAwaits: agent\n")).toBe(true)
    expect(stdout).toContain(`\n\n${stallDiagnosis("working", "agent")}`)
  })

  it("stays stalled on a repeat — sticky, unlike the old marker's single-shot report", async () => {
    const repo = seededAt("gtd(human): working")
    await landAgentStep(repo)

    const first = await run(repo, "next", "--json")
    expect(JSON.parse(first.stdout).kind).toBe("stalled")
    const second = await run(repo, "next", "--json")
    expect(JSON.parse(second.stdout).kind).toBe("stalled")
  })

  it("is not kind stalled with a dirty tree", async () => {
    const repo = seededAt("gtd(human): working")
    await landAgentStep(repo)
    repo.writeFile("scratch.txt", "x\n")

    const { stdout } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).not.toBe("stalled")
  })

  it("is never stalled at a script rest — a clean step there is a plain no-op, not an attempt", async () => {
    const repo = seededAtIdle()
    repo.commitAllWithPrefix("gtd(check): checking")

    const { stdout } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("script")
  })

  it("is never stalled at a message rest — a clean step there is a plain no-op, not an attempt", async () => {
    const repo = seededAtIdle()

    const { stdout } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("message")
  })
})

describe("gtd next --json — capture/message kinds at a human gate", () => {
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

  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it("is kind message at a clean message rest", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).toBe("message")
  })

  it("is kind capture at a dirty message rest — the human already acted", async () => {
    const repo = seededRepo()
    repo.writeFile("NOTE.md", "a note\n")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).toBe("capture")
  })
})

describe("gtd next — exit code is uniformly 0 across every rest shape (package 05)", () => {
  // `gtd next`'s exit code no longer names whose turn is next (that's
  // `kind` alone, off `--json`/`--sh`) — it's 0 on every one of these shapes:
  // idle (the initial state, clean tree), a dirty tree at the same state, a
  // clean `message` gate past the initial state, and a non-initial
  // prompt/script rest.
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
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "A DONE.md": waiting',
    "        waiting:",
    "          actor: human",
    "          message: confirm before continuing",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const seededAtIdle = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it("a clean tree at the initial state is 0 (idle)", async () => {
    const repo = seededAtIdle()
    expect((await run(repo, "next")).exitCode).toBe(0)
    expect((await run(repo, "next", "--json")).exitCode).toBe(0)
  })

  it("a dirty tree at the initial state (kind capture) is still 0", async () => {
    const repo = seededAtIdle()
    repo.writeFile("NOTE.md", "a note\n")
    expect((await run(repo, "next")).exitCode).toBe(0)
    expect((await run(repo, "next", "--json")).exitCode).toBe(0)
  })

  it("a clean, NON-initial message gate (kind message) is still 0", async () => {
    const repo = seededAtIdle()
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    repo.writeFile("DONE.md", "done\n")
    repo.commitAllWithPrefix("gtd(agent): working → waiting")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("message")
    expect(exitCode).toBe(0)
    expect((await run(repo, "next")).exitCode).toBe(0)
  })

  it("a non-initial prompt/script rest (kind prompt) is still 0", async () => {
    const repo = seededAtIdle()
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("prompt")
    expect(exitCode).toBe(0)
    expect((await run(repo, "next")).exitCode).toBe(0)
  })
})

describe("gtd next --json — embedded validate script", () => {
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
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    '          file: "PLAN.md"',
    "          mode: qa",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "* **": idle',
    "",
  ].join("\n")

  const seededRepoAtWorking = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflow)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    return repo
  }

  it("embeds the same script gtd validate itself prints, when the declared file is present", async () => {
    const repo = seededRepoAtWorking()
    repo.writeFile(".gtd/PLAN.md", "- [ ] a question\n")

    const { stdout: nextStdout, exitCode: nextExit } = await run(repo, "next", "--json")
    expect(nextExit).toBe(0)
    const next = JSON.parse(nextStdout) as { validate?: string }

    const { stdout: validateStdout, exitCode: validateExit } = await run(repo, "validate")
    expect(validateExit).toBe(0)

    expect(next.validate).toBeDefined()
    expect(next.validate).toBe(validateStdout.replace(/\n$/, ""))
  })

  it("still embeds a validate script when the declared file is absent — the existence check moved INSIDE the script (package 2)", async () => {
    // A first-write beat (the declared file doesn't exist yet) used to
    // withhold `validate` entirely, silencing every driver's repair loop
    // (`while [ -n "$gtd_validate" ]`) at exactly the beat that needs it.
    // Existence is now a leading `[ -f <file> ] || exit 0` guard INSIDE the
    // emitted script instead, evaluated once the script actually runs.
    const repo = seededRepoAtWorking()
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty("validate")
    expect(parsed.validate).toContain(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    expect(parsed.validate).toContain(`gtd check qa '.gtd/PLAN.md'`)
  })
})

describe("gtd validate — the mode-contradiction round-trip (package 2, Requirement B)", () => {
  /** Same as `run`, but with an injected env — needed to pin the round-trip's scratch path deterministically (`TMPDIR`). */
  const runEnv = async (
    repo: InMemRepo,
    env: Readonly<Record<string, string | undefined>>,
    ...args: string[]
  ): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> => {
    const { io, result } = makeCapturingCliIo(repo, env)
    await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
    return result()
  }

  const workflowWithMode = (modesYaml: string, stateMode = "qa"): string =>
    [
      "workflow:",
      "  modes:",
      modesYaml,
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
      '          file: "PLAN.md"',
      `          mode: ${stateMode}`,
      "          prompt: do the work",
      "          on:",
      '            "* **": idle',
      "",
    ].join("\n")

  const seededRepoAtWorking = (modesYaml: string, stateMode = "qa"): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", workflowWithMode(modesYaml, stateMode))
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd(human): working")
    return repo
  }

  it("a live built-in validator (qa, with a declared format:) emits the round-trip BEFORE the existence guard, using the scratch path under TMPDIR", async () => {
    const repo = seededRepoAtWorking(
      ["    qa:", '      format: "my-formatter <%= it.file %>"'].join("\n"),
    )
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)

    const samplePath = `/fixture-scratch/gtd-mode-sample-qa-${process.pid}.md`
    const roundTripIndex = stdout.indexOf(`printf '%s' `)
    const guardIndex = stdout.indexOf(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    // The REAL format command, rendered against the real file — distinct
    // from the round-trip's OWN copy of "my-formatter" (rendered against the
    // scratch sample path), which appears earlier, inside the message text.
    const formatIndex = stdout.indexOf(`my-formatter .gtd/PLAN.md`)
    const validateIndex = stdout.indexOf(`gtd_validate_out=`)

    expect(roundTripIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(-1)
    // Ordering per the package's "How" section: round-trip/notice, guard, format:, validate:.
    expect(roundTripIndex).toBeLessThan(guardIndex)
    expect(guardIndex).toBeLessThan(formatIndex)
    expect(formatIndex).toBeLessThan(validateIndex)

    expect(stdout).toContain(samplePath)
    expect(stdout).toContain(`my-formatter ${samplePath}`)
    expect(stdout).toContain(`gtd check qa '${samplePath}' >/dev/null 2>&1 || {`)
    expect(stdout).toContain("CONFIGURATION BUG")
    expect(stdout).toContain("Do NOT edit the steering file")
  })

  it("an external validate: command (a genuine override, not gtd's own seeded string) prints a one-line skip notice instead of the round-trip", async () => {
    const repo = seededRepoAtWorking(
      ["    qa:", '      format: "my-formatter <%= it.file %>"', '      validate: "true"'].join(
        "\n",
      ),
    )
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain('mode "qa" has an external validate: command')
    expect(stdout).toContain("skipping")
    expect(stdout).not.toContain("printf '%s' ")
    expect(stdout).not.toContain("CONFIGURATION BUG")
  })

  it("a format-only mode (no validate at all) emits neither the round-trip nor the skip notice — just the guard and the format command", async () => {
    const repo = seededRepoAtWorking(
      ["    prose:", '      format: "my-formatter <%= it.file %>"'].join("\n"),
      "prose",
    )
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    expect(stdout).toContain("my-formatter .gtd/PLAN.md")
    expect(stdout).not.toContain("printf '%s' ")
    expect(stdout).not.toContain("CONFIGURATION BUG")
    expect(stdout).not.toContain("skipping")
  })

  it("no format: command at all emits neither — same as before this package", async () => {
    const repo = seededRepoAtWorking("    qa: {}")
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    expect(stdout).not.toContain("printf '%s' ")
    expect(stdout).not.toContain("skipping")
  })

  it("resolves the scratch dir from node:os's tmpdir() when TMPDIR is unset or empty", async () => {
    const repo = seededRepoAtWorking(
      ["    qa:", '      format: "my-formatter <%= it.file %>"'].join("\n"),
    )
    const { stdout, exitCode } = await runEnv(repo, {}, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`gtd-mode-sample-qa-${process.pid}.md`)
  })

  it("gtd validate the COMMAND still exits 0 even when the emitted SCRIPT would fail if run", async () => {
    // gtd itself never runs the script — it only prints it — so a
    // contradiction inside the printed script never surfaces as gtd
    // validate's own exit code (see docs/cli.md's closed five-number
    // exit-code table).
    const repo = seededRepoAtWorking(
      ["    qa:", '      format: "my-formatter <%= it.file %>"'].join("\n"),
    )
    const { exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
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

    // `gtd abandon` EMITS its mutation as plain text instead of performing it
    // — it carries no `--json`/`--sh` of its own (only `next`/`land` do), so
    // the combined script is the whole of stdout.
    const { stdout, exitCode } = await run(repo, "abandon")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("gtd_report_abandoned 'renamedAway'")
    expect(repo.commitHistory()).toHaveLength(before)

    const applied = applyEmittedScript(repo, new Map(), stdout)
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

    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(noteOutcome(noopText("idle")))

    const applied = applyEmittedScript(repo, new Map(), stdout)
    expect(applied.ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("gtd abandon with nothing underway emits a print-only required script carrying the same wording", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length

    const { stdout, exitCode } = await run(repo, "abandon")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(abandonNoopOutcome("idle"))

    const applied = applyEmittedScript(repo, new Map(), stdout)
    expect(applied.ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("gtd restore's script prints the post-hoc short hash/subject via gtd_report_restored", async () => {
    const repo = seededRepo()
    repo.commitAllWithPrefix("gtd(agent): working")
    const tip = repo.resolveRef("HEAD")!
    repo.updateRef(HISTORY_REF, tip)
    // Case (b) of `restorability`: HEAD is an ancestor of the retained tip —
    // e.g. an abandon happened after the squash this history retains.
    repo.hardResetTo(repo.resolveRef("HEAD~1")!)

    const { stdout, exitCode } = await run(repo, "restore")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(restoredOutcome(tip, "working"))

    const applied = applyEmittedScript(repo, new Map(), stdout)
    expect(applied.ok).toBe(true)
    expect(repo.resolveRef("HEAD")).toBe(tip)
  })
})

describe("gtd land — StepPayload.processTrace still receives plain state names", () => {
  // `ProcessRun.trace` widened to `TraceEntry[]` (state + commit hash, for
  // `memoryKeyFor` — package 05/06), but `PatternMachine.step`'s
  // `StepPayload.processTrace` stays `readonly StateName[]` — retry-entry
  // counting (`applyRetry`) only ever compares state NAMES. If the mapping
  // at the one call site (`planLanding`, src/program.ts) ever regressed to
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

    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    const applied = applyEmittedScript(repo, new Map(), stdout)
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

  it("invalid qa content prints each finding one per line on stderr, leaves stdout empty, and exits non-zero", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", invalidQaDoc)
    const { stdout, stderr, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain(
      "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
    )
  })

  it("invalid review content prints each finding one per line on stderr, leaves stdout empty, and exits non-zero", async () => {
    const repo = bareRepo()
    repo.writeFile("REVIEW.md", invalidReviewDoc)
    const { stdout, stderr, exitCode } = await run(repo, "check", "review", "REVIEW.md")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain(
      "Missing or malformed '# Review: <hash>' header as the document's first line",
    )
    expect(stderr).toContain("Missing '<!-- base: <hash> -->' comment")
    expect(stderr).toContain("REVIEW.md has no '##' chunks")
  })

  it("a positioned finding prints '<file>:<line>: <message>' with a 1-based line number, on stderr", async () => {
    const repo = bareRepo()
    const secondPointerDoc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [ ] ./src/calc.ts#1 — ./src/other.ts#2",
      "",
    ].join("\n")
    repo.writeFile("REVIEW.md", secondPointerDoc)
    const { stdout, stderr, exitCode } = await run(repo, "check", "review", "REVIEW.md")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    // The offending pointer is the 0-based 6th line (index 5) — printed 1-based as 6.
    expect(stderr).toContain(
      'REVIEW.md:6: Chunk "Add calculator" hunk ./src/calc.ts#1\'s note starts with a second pointer (./src/other.ts#2) — give it its own "- [ ]" line',
    )
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

  it("--json is out of scope for check — a usage error, never a JSON envelope (next/land are the only structured surfaces)", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", validQaDoc)
    const { stdout, stderr, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md", "--json")
    expect(exitCode).toBe(2)
    expect(stdout).toBe("")
    expect(stderr).toContain("only valid for `gtd next`")
  })
})

describe("gtd check <mode> <file> --open-questions", () => {
  // Shares the exact `unansweredQuestions` predicate the answer-completeness
  // step guard (`StepGuards.test.ts`) enforces at land — this is the leaf
  // command a workflow's own gate script calls to answer the same question
  // in-process, ahead of time.

  const docWithUnanswered = [
    "# Plan",
    "",
    "## Open Questions",
    "",
    "### Which operations?",
    "",
    "- [ ] add and subtract",
    "- [ ] _your answer_",
    "",
    "### What is the target platform?",
    "",
    "- [x] web only",
    "- [ ] _your answer_",
    "",
  ].join("\n")

  const docFullyAnswered = [
    "# Plan",
    "",
    "## Open Questions",
    "",
    "### What is the target platform?",
    "",
    "- [x] web only",
    "- [ ] _your answer_",
    "",
  ].join("\n")

  const docNoOpenQuestionsSection = [
    "# Plan",
    "",
    "## Answered Questions",
    "",
    "### What is the target platform?",
    "",
    "web only.",
    "",
  ].join("\n")

  const docNeitherSection = ["# Plan", "", "Just some prose, no questions at all.", ""].join("\n")

  const docFreeTextAnswered = [
    "# Plan",
    "",
    "## Open Questions",
    "",
    "### Which operations?",
    "",
    "- [ ] add and subtract",
    "- [x] multiply only",
    "",
  ].join("\n")

  const bareRepo = (): InMemRepo => new InMemRepo()

  it("lists each unanswered question on stderr, leaves stdout empty, and exits non-zero", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", docWithUnanswered)
    const { stdout, stderr, exitCode } = await run(
      repo,
      "check",
      "qa",
      "--open-questions",
      ".gtd/TODO.md",
    )
    expect(exitCode).not.toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain("Which operations?")
  })

  it("exits 0 with no output when every open question has a ticked box", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", docFullyAnswered)
    const { stdout, exitCode } = await run(repo, "check", "qa", "--open-questions", ".gtd/TODO.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("exits 0 with no output when the '## Open Questions' section is absent (an '## Answered Questions' section only)", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", docNoOpenQuestionsSection)
    const { stdout, exitCode } = await run(repo, "check", "qa", "--open-questions", ".gtd/TODO.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("exits 0 with no output for a document with neither section at all", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", docNeitherSection)
    const { stdout, exitCode } = await run(repo, "check", "qa", "--open-questions", ".gtd/TODO.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("a question answered via the free-text slot with the human's own text counts as answered", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", docFreeTextAnswered)
    const { stdout, exitCode } = await run(repo, "check", "qa", "--open-questions", ".gtd/TODO.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("a missing file exits non-zero with a message, not a silent zero", async () => {
    const repo = bareRepo()
    const { stderr, exitCode } = await run(repo, "check", "qa", "--open-questions", ".gtd/TODO.md")
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain(".gtd/TODO.md")
  })

  it("an existing-but-unreadable path (a directory at that name) exits non-zero with a message", async () => {
    // The in-memory fake has no real file descriptors/permissions, so
    // "unreadable" is simulated the one way it can be: a path that EXISTS
    // (`hasPath` sees the nested file) but has no content of its own
    // (`readFile` returns undefined for a directory), exactly like `gtd
    // check`'s existing `steeringFormatFor` path already treats a directory —
    // `readFileString` fails with ENOENT rather than returning a string.
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md/nested.txt", "not actually the file")
    const { stderr, exitCode } = await run(repo, "check", "qa", "--open-questions", ".gtd/TODO.md")
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain(".gtd/TODO.md")
  })

  it("check without the flag is unchanged: an absent file still exits 0 with no output", async () => {
    const repo = bareRepo()
    const { stdout, exitCode } = await run(repo, "check", "qa", ".gtd/TODO.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("--json is out of scope for check --open-questions too — a usage error, never a JSON envelope", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", docWithUnanswered)
    const { stdout, stderr, exitCode } = await run(
      repo,
      "check",
      "qa",
      "--open-questions",
      ".gtd/TODO.md",
      "--json",
    )
    expect(exitCode).toBe(2)
    expect(stdout).toBe("")
    expect(stderr).toContain("only valid for `gtd next`")
  })

  it("an unknown mode still fails with the usual unknown-mode usage error, even with --open-questions", async () => {
    const repo = bareRepo()
    repo.writeFile(".gtd/TODO.md", docFullyAnswered)
    const { stderr, exitCode } = await run(
      repo,
      "check",
      "bogus",
      "--open-questions",
      ".gtd/TODO.md",
    )
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('unknown mode "bogus"')
    expect(stderr).toContain("qa")
    expect(stderr).toContain("review")
  })

  it("a known but non-qa mode (e.g. review) refuses --open-questions instead of silently running the qa predicate", async () => {
    const repo = bareRepo()
    repo.writeFile("REVIEW.md", docWithUnanswered)
    const { stderr, exitCode } = await run(repo, "check", "review", "--open-questions", "REVIEW.md")
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("--open-questions")
    expect(stderr).toContain('"review"')
  })
})

describe("gtd visualize — flushes before blocking (package 04)", () => {
  it("flushes the URL line before Effect.never blocks, so a driver sees it without waiting for shutdown", async () => {
    const repo = new InMemRepo()
    const written: string[] = []
    let flushCount = 0
    const out = {
      write: (chunk: string) => written.push(chunk),
      flush: () => {
        flushCount++
      },
    }

    const fiber = Effect.runFork(
      runCommand({ kind: "visualize", port: 0, open: false }, false, false, out).pipe(
        Effect.provide(testLayers(repo)),
      ),
    )
    try {
      // The command blocks on Effect.never next — flush-on-success (`Cli.ts`'s
      // own, driven by the command's Effect completing) would never fire, so
      // this proves `runVisualizeCommand` flushes the URL line itself, ahead
      // of that block, rather than a driver having to wait for shutdown.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(written.some((chunk) => chunk.includes("gtd visualize running at"))).toBe(true)
      expect(flushCount).toBeGreaterThan(0)
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber))
    }
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

describe("gtd next — Next: preview", () => {
  // Exercises `computeNextMatch` wired through `gtd next`'s plain-text
  // `Next:` line and `--json`'s `next` key. The workflow below carries one
  // edge with an `action`, one without (falls back to the raw `pattern`),
  // and leaves a third change unmatched by either. A `message`-kind rest
  // (not `prompt`) is deliberate: `gtd next`'s plain encoding suppresses the
  // whole header — including `Next:` — at a `prompt` rest (see `Beat.ts`'s
  // `renderBeatPlain`), so the plain-text half of this coverage needs a
  // non-`prompt` rest to observe anything at all.

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
    "          message: do the work described in NOTE.md",
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

  it("gtd next shows `Next:` with the action when the matched edge carries one", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("PLAN.md", "the plan\n")
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Next: Accept plan → accepted")
  })

  it("gtd next --json's `next` carries the action when the matched edge has one", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("PLAN.md", "the plan\n")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.next).toEqual({
      action: "Accept plan",
      pattern: "A PLAN.md",
      target: "accepted",
    })
  })

  it("gtd next falls back to the raw pattern when the matched edge carries no action", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("REVIEW.md", "an updated review\n")
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Next: M REVIEW.md → idle")
  })

  it("gtd next --json's `next` omits `action` and falls back to `pattern` when the matched edge has none", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("REVIEW.md", "an updated review\n")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.next).toEqual({ pattern: "M REVIEW.md", target: "idle" })
  })

  it("gtd next shows the no-match line when the pending change matches no declared pattern", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("OTHER.md", "unrelated\n")
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Next: (no match — nothing would happen)")
  })

  it("gtd next --json's `next` is present-but-null (never omitted) on no match", async () => {
    const repo = seededRepoAt(workflowWithNextEdges)
    repo.writeFile("OTHER.md", "unrelated\n")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty("next")
    expect(parsed.next).toBeNull()
  })
})

describe("gtd land — the settled signal (exit code, script content, and now the --json/--sh settled field)", () => {
  // idle (message) -> working (prompt) -> checking (script, no C row) — the
  // shape #170 cares about: a script rest's no-op is the terminal "nothing
  // left to do" signal, a prompt rest's no-op is not (that's #167's stall).
  const SETTLED_WORKFLOW = [
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
    '            "* **": checking',
    "        checking:",
    "          actor: check",
    "          script: run-checks",
    "          on:",
    '            "A OUT.txt": idle',
    "",
  ].join("\n")

  const seededRepo = (lastCommitSubject: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", SETTLED_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  it("a clean tree at the script rest is settled, with a print-only required script", async () => {
    const repo = seededRepo("gtd(check): checking")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    // A genuine no-op still emits the outcome-printing script (gtd#165) — no
    // git write, just the `nothing to do at "<state>"` line.
    expect(stdout).toContain("nothing to do")
    expect(stdout).not.toContain("git commit")
  })

  it("a clean tree at a prompt rest is not settled — that's a stall, not a terminal state", async () => {
    const repo = seededRepo("gtd(agent): working")
    const { exitCode, stdout } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    expect((JSON.parse(stdout) as { readonly settled: boolean }).settled).toBe(false)
  })

  it("a dirty tree matching the script rest's own pattern is not settled — proves it's the no-op, not the state, that settles", async () => {
    const repo = seededRepo("gtd(check): checking")
    repo.writeFile("OUT.txt", "all green\n")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).not.toBe("")
    expect(stdout).toContain("git commit")
  })

  // Identical to SETTLED_WORKFLOW, but "checking" also declares a "C": idle
  // row — adding that row to SETTLED_WORKFLOW itself would turn its own no-op
  // tests above into commits, so the collapse gets its own workflow constant.
  const COLLAPSE_WORKFLOW = [
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
    '            "* **": checking',
    "        checking:",
    "          actor: check",
    "          script: run-checks",
    "          on:",
    '            "A OUT.txt": idle',
    '            "C": idle',
    "",
  ].join("\n")

  const seededCollapseRepo = (lastCommitSubject: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", COLLAPSE_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  it("a clean tree at `checking` after an empty commit collapses back to idle — settled, no commit", async () => {
    const repo = seededCollapseRepo("gtd(check): checking")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("git reset --mixed")
    expect(stdout).toContain("nothing to retain")
    expect(stdout).not.toContain("git commit")
  })

  it("the same rest with a pending change that retains something is not settled — proves it's the rewind, not the target state, that settles", async () => {
    const repo = seededCollapseRepo("gtd(check): checking")
    repo.writeFile("OUT.txt", "all green\n")
    const { stdout, exitCode } = await run(repo, "land")
    // Both this case and the one above target the initial state (`idle`) —
    // exit code is 0 either way, whether or not the landing settles — so exit
    // code alone can't tell a genuine collapse apart from an ordinary commit
    // that happens to land there; the script's own content (a real
    // `git commit`, no rewind) is what proves it's the REWIND, not the
    // target state, that settles.
    expect(exitCode).toBe(0)
    expect(stdout).toContain("git commit")
    expect(stdout).not.toContain("nothing to retain")
  })

  it("gtd land --sh's gtd_script is byte-identical to plain gtd land's stdout for the same rest", async () => {
    const repo = seededRepo("gtd(check): checking")
    const plain = await run(repo, "land")
    const sh = await run(repo, "land", "--sh")
    expect(sh.exitCode).toBe(plain.exitCode)
    // `shQuote` is total and deterministic — the exact quoted assignment gtd
    // land --sh must emit for `gtd_script` is reconstructible from plain
    // land's own stdout, so this is a byte-identity check, not a substring
    // heuristic.
    expect(sh.stdout).toContain(`gtd_script=${shellQuote(plain.stdout)}`)
  })

  it("gtd land --json a no-op at a script rest reports settled:true, idle:false (checking isn't the initial state)", async () => {
    const repo = seededRepo("gtd(check): checking")
    const { stdout, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as {
      readonly settled: boolean
      readonly idle: boolean
      readonly state: string
      readonly script: string
    }
    expect(parsed.settled).toBe(true)
    expect(parsed.idle).toBe(false)
    expect(parsed.state).toBe("checking")
    expect(parsed.script).toContain("nothing to do")
  })

  it("gtd land --json a decision that collapses back to the initial state reports settled:true, idle:true, state:idle", async () => {
    const repo = seededCollapseRepo("gtd(check): checking")
    const { stdout, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as {
      readonly settled: boolean
      readonly idle: boolean
      readonly state: string
    }
    expect(parsed.settled).toBe(true)
    expect(parsed.idle).toBe(true)
    expect(parsed.state).toBe("idle")
  })

  it("gtd land --json an ordinary commit reports settled:false", async () => {
    const repo = seededRepo("gtd(agent): working")
    repo.writeFile("OUT.txt", "all green\n")
    const { stdout } = await run(repo, "land", "--json")
    const parsed = JSON.parse(stdout) as { readonly settled: boolean; readonly idle: boolean }
    expect(parsed.settled).toBe(false)
    expect(parsed.idle).toBe(false)
  })

  it("gtd land --json --cost=<n> --model=<name> carries both verbatim, and a genuine no-op reports both null", async () => {
    const withCost = seededRepo("gtd(agent): working")
    withCost.writeFile("OUT.txt", "all green\n")
    const { stdout: withCostStdout } = await run(
      withCost,
      "land",
      "--json",
      "--cost=0.5",
      "--model=opus",
    )
    const parsedWithCost = JSON.parse(withCostStdout) as {
      readonly cost: number | null
      readonly model: string | null
    }
    expect(parsedWithCost.cost).toBe(0.5)
    expect(parsedWithCost.model).toBe("opus")

    const noop = seededRepo("gtd(check): checking")
    const { stdout: noopStdout } = await run(noop, "land", "--json")
    const parsedNoop = JSON.parse(noopStdout) as {
      readonly cost: number | null
      readonly model: string | null
      readonly subject: string | null
    }
    expect(parsedNoop.cost).toBeNull()
    expect(parsedNoop.model).toBeNull()
    expect(parsedNoop.subject).toBeNull()
  })
})

describe("gtd land — exit code no longer names the post-land rest's owner (package 05)", () => {
  // A landing's exit code is 0 on success regardless of what the post-land
  // rest is (a `script`/`prompt` target, a `message` target, or a squash that
  // resolves to the initial state) — and 1 on a refusal. Whose turn is next
  // now lives entirely in the following `gtd next --json`'s own `kind` field.
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
    "          message: write NOTE.md to start a process",
    "          on:",
    '            "* **": working',
    "        working:",
    "          actor: agent",
    "          prompt: do the work described in NOTE.md",
    "          on:",
    '            "A DONE.md": waiting',
    '            "A OUT.txt": checking',
    "        waiting:",
    "          actor: human",
    "          message: confirm before continuing",
    "        checking:",
    "          actor: check",
    "          script: run-checks",
    "",
  ].join("\n")

  const seededAt = (lastCommitSubject: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.commitAllWithPrefix(lastCommitSubject)
    return repo
  }

  it("a landing whose next rest is a prompt state exits 0", async () => {
    const repo = seededAt("gtd(human): idle")
    repo.writeFile("NOTE.md", "a note\n")
    const { exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
  })

  it("a landing whose next rest is a script state exits 0", async () => {
    const repo = seededAt("gtd(agent): working")
    repo.writeFile("OUT.txt", "all green\n")
    const { exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
  })

  it("a landing whose next rest is a message state exits 0", async () => {
    const repo = seededAt("gtd(agent): working")
    repo.writeFile("DONE.md", "done\n")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("gtd(agent): working → waiting")
  })

  it("a refusal exits 1 and emits nothing", async () => {
    // `checking` declares no `on:` rows at all, so any pending change there
    // matches nothing — a genuine refusal, not a transition.
    const repo = seededAt("gtd(check): checking")
    repo.writeFile("scratch.txt", "an unrelated pending change\n")
    const before = repo.commitHistory().length
    const { stdout, stderr, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr.length).toBeGreaterThan(0)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a refusal under --sh stays a plain `gtd: ...` on stderr with stdout byte-empty", async () => {
    const repo = seededAt("gtd(check): checking")
    repo.writeFile("scratch.txt", "an unrelated pending change\n")
    const { stdout, stderr, exitCode } = await run(repo, "land", "--sh")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toMatch(/^gtd\b/)
    expect(stderr).not.toContain('"state":"error"')
  })

  it("a refusal under --json stays stdout byte-empty (the error envelope is on stderr, matching gtd next --json)", async () => {
    const repo = seededAt("gtd(check): checking")
    repo.writeFile("scratch.txt", "an unrelated pending change\n")
    const { stdout, stderr, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('"state":"error"')
  })
})

describe("a step that DELETES its state's own steering file", () => {
  // The `format:`/`validate:` pair a state's `mode:` declares is emitted into
  // the step script ahead of the commit. When the step's own diff is that
  // file's DELETION — a legitimate outcome, e.g. the bundled template's review
  // sign-off, whose whole diff is a bare REVIEW.md deletion — there is nothing
  // left to format, and emitting the command anyway made the step UNLANDABLE:
  // it is the script's first command under `set -euo pipefail`, and a real
  // formatter (`prettier --write`) exits non-zero on a path that is not there.

  const NOTES_WORKFLOW = [
    "workflow:",
    "  modes:",
    "    notes:",
    "      format: fmt-notes <%= it.file %>",
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
    '            "* **": drafting',
    "        drafting:",
    "          actor: agent",
    "          prompt: write the notes",
    "          file: NOTES.md",
    "          mode: notes",
    "          on:",
    '            "D .gtd/NOTES.md": idle',
    '            "* **": drafting',
    "",
  ].join("\n")

  const restingAtDrafting = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", NOTES_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile(".gtd/NOTES.md", "# notes\n\nfirst draft\n")
    repo.commitAllWithPrefix("gtd(agent): drafting")
    return repo
  }

  it("emits no format command, and still lands the commit", async () => {
    const repo = restingAtDrafting()
    repo.deleteFile(".gtd/NOTES.md")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).not.toContain("fmt-notes")
    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): drafting → idle")
  })

  it("still emits it when the same step MODIFIES that file — the skip is the deletion, not the state", async () => {
    const repo = restingAtDrafting()
    repo.writeFile(".gtd/NOTES.md", "# notes\n\nsecond draft\n")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("fmt-notes .gtd/NOTES.md")
  })

  it("emits no format command when the file was never written at all — not deleted this step, genuinely absent since the process started", async () => {
    // NOTES.md never touches disk here: `drafting` is reached by a step whose
    // diff is some OTHER file entirely (still matched by the catch-all
    // `"* **": drafting` row, so the step still lands). `deletesFile` can't see
    // this case — NOTES.md is absent from `changes`, not present as a `D` row
    // — which is exactly why `steeringModeSteps` needs its own
    // `RepoFiles.working` check alongside it.
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", NOTES_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile("OTHER.md", "unrelated\n")
    repo.commitAllWithPrefix("gtd(agent): drafting")
    repo.writeFile("OTHER.md", "unrelated, again\n")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).not.toContain("fmt-notes")
    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): drafting")
  })
})

describe("runCommand — refuses in a repository with no commits", () => {
  // A minimal, type-checked `Command` for every kind — `Record<Command["kind"],
  // Command>` means a future kind added to `Cli.ts`'s `Command` union fails
  // this file's typecheck until it gets an entry here, so `stateKinds` below
  // (derived from `needsOf`, not hand-copied) picks up a new "state" kind
  // automatically rather than silently skipping it.
  const commandFor: Record<Command["kind"], Command> = {
    lsp: { kind: "lsp" },
    init: { kind: "init" },
    visualize: { kind: "visualize", port: 4000, open: false },
    land: { kind: "land" },
    entry: { kind: "entry", actor: "human", state: "idle", vars: {}, label: "" },
    abandon: { kind: "abandon" },
    restore: { kind: "restore" },
    next: { kind: "next" },
    validate: { kind: "validate" },
    check: { kind: "check", mode: "qa", file: ".gtd/TODO.md" },
    install: { kind: "install" },
  }

  const stateKinds = (Object.keys(commandFor) as Command["kind"][]).filter(
    (kind) => needsOf(kind) === "state",
  )

  const NO_COMMITS_MESSAGE =
    "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

  it("derives exactly the six non-standalone kinds — a canary for the table-driven cases below", () => {
    expect(stateKinds.sort()).toEqual(
      ["abandon", "entry", "land", "next", "restore", "validate"].sort(),
    )
  })

  it.each(stateKinds)(
    "%s refuses with the pinned message, creates no commit, and writes no script",
    async (kind) => {
      const repo = new InMemRepo()
      const before = repo.commitHistory().length
      const written: string[] = []
      const out = { write: (chunk: string) => written.push(chunk), flush: () => {} }

      const exit = await Effect.runPromiseExit(
        runCommand(commandFor[kind], false, false, out).pipe(Effect.provide(testLayers(repo))),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(String(exit.cause)).toContain(NO_COMMITS_MESSAGE)
      }
      expect(repo.hasCommits()).toBe(false)
      expect(repo.commitHistory()).toHaveLength(before)
      expect(written).toEqual([])
    },
  )

  it("a repository with a commit passes the guard and dispatches normally", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.json", renderInitConfig())
    repo.commitAllWithPrefix("chore: init gtd workflow")
    const written: string[] = []
    const out = { write: (chunk: string) => written.push(chunk), flush: () => {} }

    const exit = await Effect.runPromiseExit(
      runCommand({ kind: "next" }, false, false, out).pipe(Effect.provide(testLayers(repo))),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(written.length).toBeGreaterThan(0)
  })
})
