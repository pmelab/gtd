/**
 * Behavioural coverage of `src/program.ts`'s commands, each run through the
 * real `runCli` shell over an in-memory repo — the same shape the `@inmem`
 * e2e tier observes. Argv parsing is pinned in `src/cli/Cli.test.ts`.
 */

import { Cause, Effect, Exit } from "effect"
import { PassThrough } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"

// `gtd ui`'s bind-host lookup reads the real `os.networkInterfaces()` — a host
// on a tailnet would make the "no Tailscale interface" refusal below succeed.
// `vi.mock` must name the module the loader resolves, not the barrel.
vi.mock("./ui/BindSystem.js", () => ({ pickBindHostFromSystem: () => undefined }))

import { runCli, type Command, EXIT_USAGE_ERROR } from "./cli/index.js"
import { stallDiagnosis, noopText } from "./wire/index.js"
import { formatFinding, needsOf, runCommand, SelectorUsageError } from "./program.js"
import { InMemRepo, makeCapturingCliIo, testLayers, applyEmittedScript } from "./testing/index.js"
import { commitAll } from "./GitScript.js"
import { DID_NOT_RUN_COMMENT } from "./Emit.js"
import { HISTORY_REF } from "./RetainedHistory.js"
import { abandonNoopOutcome, noteOutcome, restoredOutcome } from "./OutcomeScript.js"

const run = async (
  repo: InMemRepo,
  ...args: string[]
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> => {
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
  return result()
}

/** Lands via `gtd land --json` and applies the emitted script, as a driver would. */
const landAndApply = async (
  repo: InMemRepo,
): Promise<{ readonly exitCode: number; readonly script: string }> => {
  const { stdout, exitCode } = await run(repo, "land", "--json")
  const script = exitCode === 0 ? (JSON.parse(stdout) as { readonly script: string }).script : ""
  if (exitCode === 0) expect(applyEmittedScript(repo, new Map(), script).ok).toBe(true)
  return { exitCode, script }
}

/** Writes `files` into the tree, then lands them as one turn. */
const landTurn = async (repo: InMemRepo, files: Record<string, string> = {}): Promise<void> => {
  for (const [path, content] of Object.entries(files)) repo.writeFile(path, content)
  expect((await landAndApply(repo)).exitCode).toBe(0)
}

/** A repo whose only commit adds `gtd.config.ts` (and any `extra` files). */
const seed = (source: string, extra: Record<string, string> = {}): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile("gtd.config.ts", source)
  for (const [path, content] of Object.entries(extra)) repo.writeFile(path, content)
  repo.commitAllWithPrefix("chore: add custom workflow")
  return repo
}

/** A repo running the bundled workflow. */
const seedBundled = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile("README.md", "# test project\n")
  repo.commitAllWithPrefix("chore: init")
  return repo
}

const IDLE_THEN_WORKING = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await agent("working", "do the work described in NOTE.md")
  },
})
`

describe("gtd --entry <name> — a custom workflow's manual entry", () => {
  const WORKFLOW = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await human("idle", { message: "hi" })
      await agent("working", "go")
    },
    "side-entry": async () => {
      await agent("working", "go")
    },
  },
  { vars: { greeting: "hello" } },
)
`

  it("the happy path emits the opening commit's script — gtd itself writes nothing", async () => {
    const repo = seed(WORKFLOW)
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(commitAll("gtd(human): side-entry"))
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("--entry naming no declared entry refuses, listing every enterable entry", async () => {
    const repo = seed(WORKFLOW)
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(repo, "--entry", "bogus-state")
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("enterable states")
    expect(stderr).toContain("side-entry")
  })

  it("--entry naming a step that is not an entry refuses too", async () => {
    const repo = seed(WORKFLOW)
    const { exitCode, stderr } = await run(repo, "--entry", "working")
    expect(exitCode).toBe(1)
    expect(stderr).toContain('"working" is not an enterable state')
  })

  it("a process already underway refuses", async () => {
    const repo = seed(WORKFLOW)
    await landTurn(repo, { ".gtd/TODO.md": "sketch\n" })
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("already underway")
  })

  it("an undeclared --var name refuses, listing the declared names", async () => {
    const repo = seed(WORKFLOW)
    const before = repo.commitHistory().length
    const { exitCode, stderr } = await run(repo, "--entry", "side-entry", "--var", "bogus=1")
    expect(exitCode).toBe(1)
    expect(repo.commitHistory()).toHaveLength(before)
    expect(stderr).toContain("bogus")
    expect(stderr).toContain("greeting")
  })

  it("a declared --var override renders as a Gtd-Var trailer in the emitted commit script", async () => {
    const repo = seed(WORKFLOW)
    const before = repo.commitHistory().length
    const { exitCode, stdout } = await run(repo, "--entry", "side-entry", "--var", "greeting=world")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Gtd-Var: greeting=world")
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a dirty working tree does not refuse entry — the emitted script captures it", async () => {
    const repo = seed(WORKFLOW)
    repo.writeFile("scratch.txt", "uncommitted\n")
    const before = repo.commitHistory().length
    const { exitCode, stdout } = await run(repo, "--entry", "side-entry")
    expect(exitCode).toBe(0)
    expect(stdout.length).toBeGreaterThan(0)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("applying the entry script opens the entry's episode at its first step", async () => {
    const repo = seed(WORKFLOW)
    const { stdout } = await run(repo, "--entry", "side-entry")
    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.lastCommitSubject()).toBe("gtd(human): side-entry")
    const next = JSON.parse((await run(repo, "next", "--json")).stdout) as Record<string, unknown>
    expect(next.kind).toBe("prompt")
    expect(next.state).toBe("working")
  })
})

describe("gtd --entry <name> — the bundled workflow", () => {
  it("--entry review-gate.check --var reviewBase=<base> emits a script anchoring the process to that base", async () => {
    const repo = seedBundled()
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

  it("--entry fix-precheck emits a script that would start a fix process", async () => {
    const repo = seedBundled()
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(repo, "--entry", "fix-precheck")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("gtd(human): fix-precheck")
    expect(repo.commitHistory()).toHaveLength(before)
  })
})

describe("config loading", () => {
  it("a .gtdrc `workflow:` key is a load error — the workflow lives in gtd.config.ts", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", "workflow:\n  entry:\n    default: root\n")
    repo.commitAllWithPrefix("chore: add a stale config")
    const { exitCode, stderr } = await run(repo, "next")
    expect(exitCode).toBe(1)
    expect(stderr).toContain('"workflow" is no longer read from a .gtdrc file')
  })

  it('gtd next --verbose narrates "config: layer" exactly once — the extra load that surfaces warnings is silent', async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.json", "{}\n")
    repo.commitAllWithPrefix("chore: add config")
    const { stderr, exitCode } = await run(repo, "next", "--verbose")
    expect(exitCode).toBe(0)
    expect(stderr.match(/config: layer/g)).toHaveLength(1)
  })
})

describe("gtd next --json — label emission", () => {
  const workflowWith = (
    options: string,
  ): string => `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await agent("working", "do the work described in NOTE.md"${options})
  },
})
`

  // Plain `gtd next` prints no header at a `prompt` rest, so the plain
  // `Label:` line needs a message rest.
  it("gtd next shows the step's declared label as a plain-text Label: line at a non-prompt rest", async () => {
    const repo = seed(`import { human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await human("reviewing", { label: "planning", message: "check the note" })
  },
})
`)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("State: reviewing")
    expect(stdout).toContain("Label: planning")
  })

  it("gtd next --json carries the step's declared label", async () => {
    const repo = seed(workflowWith(', { label: "planning" }'))
    await landTurn(repo, { "NOTE.md": "a note\n" })
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect((JSON.parse(stdout) as Record<string, unknown>).label).toBe("planning")
  })

  it("gtd next --json omits label entirely when the step declares none", async () => {
    const repo = seed(workflowWith(""))
    await landTurn(repo, { "NOTE.md": "a note\n" })
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout) as Record<string, unknown>).not.toHaveProperty("label")
  })
})

describe("gtd next --json — log path emission", () => {
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
  const CHECKING = `import { human, run, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await run("checking", "echo hi")
  },
})
`

  // Loops through a script step without touching the initial step, so the
  // agent's scope-run is never broken by a new process.
  const PROMPT_THEN_CHECK = `import { agent, human, run, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    for (;;) {
      await agent("working", "do the work described in NOTE.md")
      await run("check", "echo hi")
    }
  },
})
`

  const atWorking = async (source = IDLE_THEN_WORKING): Promise<InMemRepo> => {
    const repo = seed(source)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  const MEMORY_KEY = /^root#[0-9a-f]{7}$/
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  type WithSession = { readonly session?: { readonly id: string; readonly resume: boolean } }

  it("gtd next --json computes a <scope>#<hash7> memory key for a prompt rest", async () => {
    const repo = await atWorking()
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect((JSON.parse(stdout) as Record<string, unknown>).memory).toMatch(MEMORY_KEY)
  })

  it("gtd next --json omits memory entirely for a non-prompt rest", async () => {
    const repo = await atWorking(CHECKING)
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout) as Record<string, unknown>).not.toHaveProperty("memory")
  })

  it("gtd next --json derives a session for a prompt rest, resume: false on the fresh scope-run", async () => {
    const repo = await atWorking()
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as WithSession
    expect(parsed.session?.id).toMatch(UUID)
    expect(parsed.session?.resume).toBe(false)
  })

  it("two next --json calls back-to-back yield the SAME id and resume — a peek writes nothing", async () => {
    const repo = await atWorking()
    const first = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    const second = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    expect(second.session?.id).toBe(first.session?.id)
    expect(first.session?.resume).toBe(false)
    expect(second.session?.resume).toBe(false)
  })

  it("three consecutive next --json calls at a prompt rest are byte-identical and leave the commit count unchanged", async () => {
    const repo = await atWorking()
    const before = repo.commitHistory().length
    const first = (await run(repo, "next", "--json")).stdout
    const second = (await run(repo, "next", "--json")).stdout
    const third = (await run(repo, "next", "--json")).stdout
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(repo.commitHistory().length).toBe(before)
  })

  it("resume flips false → true once a turn lands back at the same prompt step, id unchanged", async () => {
    const repo = await atWorking(PROMPT_THEN_CHECK)
    const first = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    expect(first.session?.resume).toBe(false)

    await landTurn(repo, { "NOTE.md": "the agent did the work\n" })
    await landTurn(repo, { "FEEDBACK.md": "check ran\n" })

    const second = JSON.parse((await run(repo, "next", "--json")).stdout) as WithSession
    expect(second.session?.id).toBe(first.session?.id)
    expect(second.session?.resume).toBe(true)
  })

  it("gtd next --json omits session for a non-prompt rest", async () => {
    const repo = await atWorking(CHECKING)
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout) as Record<string, unknown>).not.toHaveProperty("session")
  })
})

describe("gtd next --json — stall detection (attempt commits)", () => {
  const WORKFLOW = `import { agent, human, run, workflow } from "@pmelab/gtd/flows"

const work = async () => {
  await agent("working", "do the work described in NOTE.md")
  await run("checking", "echo hi")
}

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await work()
  },
  resume: work,
})
`

  const atWorking = async (): Promise<InMemRepo> => {
    const repo = seed(WORKFLOW)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  const attempted = async (): Promise<InMemRepo> => {
    const repo = await atWorking()
    await landTurn(repo)
    return repo
  }

  it("is not kind stalled before the attempt lands", async () => {
    const repo = await atWorking()
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).not.toBe("stalled")
  })

  it("is kind stalled once `gtd land` has landed an empty attempt, with the diagnosis as content and no session/validate key", async () => {
    const repo = await attempted()
    expect(repo.lastCommitSubject()).toBe("gtd(agent): working")
    expect(repo.lastCommitMessage()).not.toContain("Gtd-Step:")

    const { stdout } = await run(repo, "next", "--json")
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.kind).toBe("stalled")
    expect(parsed.content).toBe(stallDiagnosis("working", "agent"))
    expect(parsed).not.toHaveProperty("session")
    expect(parsed).not.toHaveProperty("validate")
  })

  it("a clean-tree entry commit resting at a prompt step is NOT a stall — the actor differs (human entered, agent acts)", async () => {
    const repo = seed(WORKFLOW)
    const { stdout: entry } = await run(repo, "--entry", "resume")
    expect(applyEmittedScript(repo, new Map(), entry).ok).toBe(true)
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).toBe("prompt")
  })

  it("plain gtd next renders the stall diagnosis too — a human peek must not see the prompt that went nowhere", async () => {
    const repo = await attempted()
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout.startsWith("State: working\nAwaits: agent\n")).toBe(true)
    expect(stdout).toContain(`\n\n${stallDiagnosis("working", "agent")}`)
  })

  it("stays stalled on a repeat", async () => {
    const repo = await attempted()
    expect(JSON.parse((await run(repo, "next", "--json")).stdout).kind).toBe("stalled")
    expect(JSON.parse((await run(repo, "next", "--json")).stdout).kind).toBe("stalled")
  })

  it("is not kind stalled with a dirty tree", async () => {
    const repo = await attempted()
    repo.writeFile("scratch.txt", "x\n")
    const { stdout } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).not.toBe("stalled")
  })

  it("is never stalled at a script rest", async () => {
    const repo = await atWorking()
    await landTurn(repo, { "WORK.md": "done\n" })
    const { stdout } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("script")
  })

  it("is never stalled at a message rest", async () => {
    const repo = seed(WORKFLOW)
    const { stdout } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("message")
  })
})

describe("gtd next --json — capture/message kinds at a human gate", () => {
  it("is kind message at a clean message rest", async () => {
    const repo = seed(IDLE_THEN_WORKING)
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).toBe("message")
  })

  it("is kind capture at a dirty message rest — the human already acted", async () => {
    const repo = seed(IDLE_THEN_WORKING)
    repo.writeFile("NOTE.md", "a note\n")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).kind).toBe("capture")
  })
})

describe("gtd next — exit code is uniformly 0 across every rest shape", () => {
  const WORKFLOW = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await agent("working", "do the work described in NOTE.md")
    await human("waiting", { message: "confirm before continuing" })
  },
})
`

  it("a clean tree at the initial step is 0 (idle)", async () => {
    const repo = seed(WORKFLOW)
    expect((await run(repo, "next")).exitCode).toBe(0)
    expect((await run(repo, "next", "--json")).exitCode).toBe(0)
  })

  it("a dirty tree at the initial step (kind capture) is still 0", async () => {
    const repo = seed(WORKFLOW)
    repo.writeFile("NOTE.md", "a note\n")
    expect((await run(repo, "next")).exitCode).toBe(0)
    expect((await run(repo, "next", "--json")).exitCode).toBe(0)
  })

  it("a clean, NON-initial message gate (kind message) is still 0", async () => {
    const repo = seed(WORKFLOW)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    await landTurn(repo, { "DONE.md": "done\n" })
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("message")
    expect(exitCode).toBe(0)
    expect((await run(repo, "next")).exitCode).toBe(0)
  })

  it("a non-initial prompt rest (kind prompt) is still 0", async () => {
    const repo = seed(WORKFLOW)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(JSON.parse(stdout).kind).toBe("prompt")
    expect(exitCode).toBe(0)
    expect((await run(repo, "next")).exitCode).toBe(0)
  })
})

const WITH_STEERING_FILE = (
  mode: string,
): string => `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await agent("working", "do the work", { file: ".gtd/PLAN.md", mode: "${mode}" })
  },
})
`

describe("gtd next --json — embedded validate script", () => {
  const atWorking = async (): Promise<InMemRepo> => {
    const repo = seed(WITH_STEERING_FILE("qa"))
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  it("embeds the same script gtd validate itself prints, when the declared file is present", async () => {
    const repo = await atWorking()
    repo.writeFile(".gtd/PLAN.md", "- [ ] a question\n")

    const { stdout: nextStdout, exitCode: nextExit } = await run(repo, "next", "--json")
    expect(nextExit).toBe(0)
    const next = JSON.parse(nextStdout) as { validate?: string }

    const { stdout: validateStdout, exitCode: validateExit } = await run(repo, "validate")
    expect(validateExit).toBe(0)

    expect(next.validate).toBeDefined()
    expect(next.validate).toBe(validateStdout.replace(/\n$/, ""))
  })

  it("still embeds a validate script when the declared file is absent — the existence check lives inside the script", async () => {
    const repo = await atWorking()
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty("validate")
    expect(parsed.validate).toContain(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    expect(parsed.validate).toContain(`gtd check qa '.gtd/PLAN.md'`)
  })
})

describe("gtd validate — the mode-contradiction round-trip", () => {
  const runEnv = async (
    repo: InMemRepo,
    env: Readonly<Record<string, string | undefined>>,
    ...args: string[]
  ): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> => {
    const { io, result } = makeCapturingCliIo(repo, env)
    await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
    return result()
  }

  const atWorking = async (modes: readonly string[], stateMode = "qa"): Promise<InMemRepo> => {
    const repo = seed(WITH_STEERING_FILE(stateMode), {
      ".gtdrc.yaml": ["modes:", ...modes, ""].join("\n"),
    })
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  it("a live built-in validator (qa, with a declared format:) emits the round-trip BEFORE the existence guard, using the scratch path under TMPDIR", async () => {
    const repo = await atWorking(["  qa:", '    format: "my-formatter <%= it.file %>"'])
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)

    const samplePath = `/fixture-scratch/gtd-mode-sample-qa-${process.pid}.md`
    const roundTripIndex = stdout.indexOf(`printf '%s' `)
    const guardIndex = stdout.indexOf(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    // The real format command, distinct from the round-trip's own copy
    // (rendered against the scratch sample path) earlier in the script.
    const formatIndex = stdout.indexOf(`my-formatter .gtd/PLAN.md`)
    const validateIndex = stdout.indexOf(`gtd_validate_out=`)

    expect(roundTripIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(-1)
    expect(roundTripIndex).toBeLessThan(guardIndex)
    expect(guardIndex).toBeLessThan(formatIndex)
    expect(formatIndex).toBeLessThan(validateIndex)

    expect(stdout).toContain(samplePath)
    expect(stdout).toContain(`my-formatter ${samplePath}`)
    expect(stdout).toContain(`gtd check qa '${samplePath}' >/dev/null 2>&1 || {`)
    expect(stdout).toContain("CONFIGURATION BUG")
    expect(stdout).toContain("Do NOT edit the steering file")
  })

  it("an external validate: command prints a one-line skip notice instead of the round-trip", async () => {
    const repo = await atWorking([
      "  qa:",
      '    format: "my-formatter <%= it.file %>"',
      '    validate: "true"',
    ])
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain('mode "qa" has an external validate: command')
    expect(stdout).toContain("skipping")
    expect(stdout).not.toContain("printf '%s' ")
    expect(stdout).not.toContain("CONFIGURATION BUG")
  })

  it("a format-only mode (no validate at all) emits neither the round-trip nor the skip notice — just the guard and the format command", async () => {
    const repo = await atWorking(["  prose:", '    format: "my-formatter <%= it.file %>"'], "prose")
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    expect(stdout).toContain("my-formatter .gtd/PLAN.md")
    expect(stdout).not.toContain("printf '%s' ")
    expect(stdout).not.toContain("CONFIGURATION BUG")
    expect(stdout).not.toContain("skipping")
  })

  it("no format: command at all emits neither", async () => {
    const repo = await atWorking(["  qa: {}"])
    const { stdout, exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`[ -f '.gtd/PLAN.md' ] || exit 0`)
    expect(stdout).not.toContain("printf '%s' ")
    expect(stdout).not.toContain("skipping")
  })

  it("resolves the scratch dir from node:os's tmpdir() when TMPDIR is unset or empty", async () => {
    const repo = await atWorking(["  qa:", '    format: "my-formatter <%= it.file %>"'])
    const { stdout, exitCode } = await runEnv(repo, {}, "validate")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`gtd-mode-sample-qa-${process.pid}.md`)
  })

  it("gtd validate the COMMAND exits 0 even when the emitted SCRIPT would fail if run — gtd only prints it", async () => {
    const repo = await atWorking(["  qa:", '    format: "my-formatter <%= it.file %>"'])
    const { exitCode } = await runEnv(repo, { TMPDIR: "/fixture-scratch" }, "validate")
    expect(exitCode).toBe(0)
  })
})

describe("gtd next — refuses when history diverges from what replay reaches", () => {
  const atWorking = async (): Promise<InMemRepo> => {
    const repo = seed(IDLE_THEN_WORKING)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  /** A step commit recording a step the workflow never reaches there. */
  const diverged = async (): Promise<InMemRepo> => {
    const repo = await atWorking()
    repo.writeFile("WORK.md", "done\n")
    repo.commitAllWithPrefix("gtd(agent): elsewhere → review\n\nGtd-Step: elsewhere#1")
    return repo
  }

  it("refuses, saying the workflow changed and pointing at `gtd abandon`", async () => {
    const repo = await diverged()
    const { exitCode, stderr } = await run(repo, "next")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("the workflow changed under this process")
    expect(stderr).toContain("gtd abandon")
  })

  it("a workflow edited under an in-flight process refuses the same way", async () => {
    const repo = await atWorking()
    repo.writeFile("gtd.config.ts", IDLE_THEN_WORKING.replace('"working"', '"building"'))
    const { exitCode, stderr } = await run(repo, "next")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("the workflow changed under this process")
  })

  it("a process whose history replays cleanly is unaffected", async () => {
    const repo = await atWorking()
    expect((await run(repo, "next")).exitCode).toBe(0)
  })

  it("`gtd abandon` still works on a diverged process — the escape hatch must not refuse alongside everything else", async () => {
    const repo = await diverged()
    const before = repo.commitHistory().length

    const { stdout, exitCode } = await run(repo, "abandon")
    expect(exitCode).toBe(0)
    expect(stdout).toContain('abandoned the process resting at "%s"')
    expect(stdout).toContain("'review'")
    expect(repo.commitHistory()).toHaveLength(before)

    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before - 2)
  })
})

describe("outcome scripts — step no-op / abandon no-op / restore", () => {
  it("a clean-tree step is a no-op whose required script is print-only, naming the resting step", async () => {
    const repo = seed(IDLE_THEN_WORKING)
    const before = repo.commitHistory().length

    const { stdout, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    const script = (JSON.parse(stdout) as { readonly script: string }).script
    expect(script).toContain(noteOutcome(noopText("idle")))

    expect(applyEmittedScript(repo, new Map(), script).ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("plain gtd land at the same clean-tree no-op prints the prose no-op line, not the script", async () => {
    const repo = seed(IDLE_THEN_WORKING)
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).toBe(noopText("idle"))
  })

  it("gtd abandon with nothing underway emits a print-only required script carrying the same wording", async () => {
    const repo = seed(IDLE_THEN_WORKING)
    const before = repo.commitHistory().length

    const { stdout, exitCode } = await run(repo, "abandon")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(abandonNoopOutcome("idle"))

    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("gtd restore's script resolves the post-hoc short hash/subject in-script", async () => {
    const repo = seed(IDLE_THEN_WORKING)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    const tip = repo.resolveRef("HEAD")!
    repo.updateRef(HISTORY_REF, tip)
    // HEAD an ancestor of the retained tip, as after an abandon.
    repo.hardResetTo(repo.resolveRef("HEAD~1")!)

    const { stdout, exitCode } = await run(repo, "restore")
    expect(exitCode).toBe(0)
    expect(stdout).toContain(restoredOutcome(tip, "working"))

    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.resolveRef("HEAD")).toBe(tip)
  })
})

describe("gtd check <mode> <file>", () => {
  // Fully standalone (needsOf("check") === "none") — no config, no commit, no
  // git state at all is required; the file just needs to exist in the
  // in-memory worktree. Sample valid/invalid content mirrors
  // src/steering/index.test.ts's own qa/review fixtures.

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

  it("a positioned finding prints '<file>:<line>:<col>: <message>', 1-based, on stderr", async () => {
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
    // The offending pointer is the 0-based 6th line (index 5) — printed
    // 1-based as 6 — and the second pointer token itself starts at the
    // 0-based column 24, printed 1-based as 25.
    expect(stderr).toContain(
      'REVIEW.md:6:25: Chunk "Add calculator" hunk ./src/calc.ts#1\'s note starts with a second pointer (./src/other.ts#2) — give it its own "- [ ]" line',
    )
  })

  it("a line-carrying finding with no range prints '<file>:<line>: <message>' — the flat-shape fallback no built-in format reaches", async () => {
    expect(formatFinding("FAKE.md", { message: "positioned but rangeless", line: 4 })).toBe(
      "FAKE.md:5: positioned but rangeless",
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

  // Regression pin: `ModeContradiction.ts`'s round-trip renders `gtd check
  // <mode> <path>` against an ABSOLUTE scratch path under `Host.scratchDir`
  // (never repo-relative) — `Workspace`'s repo-relative `read` rejects an
  // absolute argument outright, so this command must read through `atPath`
  // instead, not `read`.
  it("reads an ABSOLUTE file path too — atPath, not the repo-relative read", async () => {
    const repo = bareRepo()
    repo.writeFile("outside.md", validQaDoc)
    const { stdout, exitCode } = await run(repo, "check", "qa", "/repo/outside.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })
})

describe("gtd uncheck <file>", () => {
  const bareRepo = (): InMemRepo => new InMemRepo()

  it("rewrites [x]/[X] pointer boxes to [ ], exit 0, no output", async () => {
    const repo = bareRepo()
    repo.writeFile(
      "REVIEW.md",
      ["# Review: abc1234", "", "## Chunk", "", "- [x] ./src/calc.ts#1", ""].join("\n"),
    )
    const { stdout, stderr, exitCode } = await run(repo, "uncheck", "REVIEW.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toBe("")
    expect(repo.readFile("REVIEW.md")).toBe(
      ["# Review: abc1234", "", "## Chunk", "", "- [ ] ./src/calc.ts#1", ""].join("\n"),
    )
  })

  it("does not write back when the bytes are unchanged (no ticks to clear)", async () => {
    const repo = bareRepo()
    const content = ["# Review: abc1234", "", "## Chunk", "", "- [ ] ./src/calc.ts#1", ""].join(
      "\n",
    )
    repo.writeFile("REVIEW.md", content)
    const writeSpy = vi.spyOn(repo, "writeFile")
    const { exitCode } = await run(repo, "uncheck", "REVIEW.md")
    expect(exitCode).toBe(0)
    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })

  it("a missing file writes nothing and exits 0", async () => {
    const repo = bareRepo()
    const { stdout, exitCode } = await run(repo, "uncheck", "REVIEW.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
    expect(repo.hasPath("REVIEW.md")).toBe(false)
  })

  it("bad arity (no file argument) exits 2", async () => {
    const repo = bareRepo()
    const { exitCode, stderr } = await run(repo, "uncheck")
    expect(exitCode).toBe(2)
    expect(stderr).toContain("missing file argument")
  })

  // Regression pin: `gtd uncheck` shares its file-reading shape with `gtd
  // check`, both of which take an arbitrary CLI-given `<file>` — not
  // necessarily repo-relative (see the sibling pin below, at `gtd check`'s
  // own describe block, for the case this actually matters in production:
  // `ModeContradiction.ts`'s round-trip invokes `gtd check qa <absolute
  // scratch path>`). `Workspace`'s repo-relative `read`/`write` reject an
  // absolute path outright — only `atPath`/`writeAtPath` may see one.
  it("rewrites ticks at an ABSOLUTE file path too — atPath/writeAtPath, not the repo-relative read/write", async () => {
    const repo = bareRepo()
    // Seeded/read back by the STRIPPED key: `atPath`'s in-memory adapter
    // (`testing/Layers.ts`) maps an absolute path rooted under `/repo` (the
    // default fake root) to its relative key, same as the live adapter maps
    // it to `join(root, …)` — the CLI argument is absolute, the storage key
    // isn't.
    repo.writeFile(
      "REVIEW.md",
      ["# Review: abc1234", "", "## Chunk", "", "- [x] ./src/calc.ts#1", ""].join("\n"),
    )
    const { stdout, stderr, exitCode } = await run(repo, "uncheck", "/repo/REVIEW.md")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toBe("")
    expect(repo.readFile("REVIEW.md")).toBe(
      ["# Review: abc1234", "", "## Chunk", "", "- [ ] ./src/calc.ts#1", ""].join("\n"),
    )
  })
})

describe("gtd check <mode> <file> --open-questions", () => {
  // Shares the exact `unansweredQuestions` predicate the answer-completeness
  // step guard (`src/step/Guards.test.ts`) enforces at land — this is the leaf
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
    expect(stderr).toContain(".gtd/TODO.md:5: Which operations?")
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

describe("gtd next — Next: preview of where landing the pending turn would go", () => {
  // A human rest past the initial step: plain `gtd next` prints no header at a
  // `prompt` rest, so the plain `Next:` line needs a non-prompt one.
  const WORKFLOW = `import { added, human, modified, refuse, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await human("working", { message: "do the work described in NOTE.md" })
    if (added("PLAN.md").length > 0) {
      await human("accepted", { message: "plan accepted" })
    } else if (modified("REVIEW.md").length === 0) {
      refuse("expected a new PLAN.md or an edited REVIEW.md")
    }
  },
})
`

  const atWorking = async (): Promise<InMemRepo> => {
    const repo = seed(WORKFLOW, { "REVIEW.md": "old review\n" })
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  const nextOf = async (repo: InMemRepo): Promise<unknown> => {
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty("next")
    return parsed.next
  }

  it("--json's `next` names the step replay reaches with the pending turn", async () => {
    const repo = await atWorking()
    repo.writeFile("PLAN.md", "the plan\n")
    expect(await nextOf(repo)).toEqual({ target: "accepted" })
  })

  it("a turn that finishes the flow targets the initial step", async () => {
    const repo = await atWorking()
    repo.writeFile("REVIEW.md", "an updated review\n")
    expect(await nextOf(repo)).toMatchObject({ target: "idle" })
  })

  it("plain gtd next shows the same preview as a `Next:` line", async () => {
    const repo = await atWorking()
    repo.writeFile("PLAN.md", "the plan\n")
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Next: → accepted")
  })

  it("a pending turn the flow would refuse previews as present-but-null, and plain says nothing would land", async () => {
    const repo = await atWorking()
    repo.writeFile("OTHER.md", "unrelated\n")
    expect(await nextOf(repo)).toBeNull()
    expect((await run(repo, "next")).stdout).toContain("Next: (nothing would land)")
  })

  it("a clean tree previews nothing", async () => {
    const repo = await atWorking()
    expect(await nextOf(repo)).toBeNull()
  })
})

describe("gtd land — the settled signal (exit code, script content, and the --json settled field)", () => {
  // `checking` re-runs until a run leaves OUT.txt behind: a clean run there
  // replays to the same step, which is the settled no-op.
  const SETTLED_WORKFLOW = `import { added, agent, human, run, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "hi" })
    await agent("working", "go")
    do {
      await run("checking", "run-checks")
    } while (added("OUT.txt").length === 0)
  },
})
`

  // `checking` runs once, so a clean run finishes the flow.
  const REENTRY_WORKFLOW = `import { agent, human, run, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "hi" })
    await agent("working", "go")
    await run("checking", "run-checks")
  },
})
`

  const atWorking = async (source: string): Promise<InMemRepo> => {
    const repo = seed(source)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  const atChecking = async (source = SETTLED_WORKFLOW): Promise<InMemRepo> => {
    const repo = await atWorking(source)
    await landTurn(repo, { "WORK.md": "done\n" })
    return repo
  }

  it("a clean tree at the script rest is settled, with a print-only required script", async () => {
    const repo = await atChecking()
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("nothing to do")
    expect(stdout).not.toContain("git commit")
  })

  it("a clean tree at a prompt rest is not settled — that's a stall, not a terminal state", async () => {
    const repo = await atWorking(SETTLED_WORKFLOW)
    const { exitCode, stdout } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    expect((JSON.parse(stdout) as { readonly settled: boolean }).settled).toBe(false)
  })

  it("a dirty tree at the script rest is not settled — it's the no-op that settles, not the step", async () => {
    const repo = await atChecking()
    repo.writeFile("OUT.txt", "all green\n")
    const { stdout, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    expect((JSON.parse(stdout) as { readonly script: string }).script).toContain("git commit")
  })

  it("a clean run that finishes the flow lands an ordinary commit re-entering the initial step", async () => {
    const repo = await atChecking(REENTRY_WORKFLOW)
    const { stdout, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    const script = (JSON.parse(stdout) as { readonly script: string }).script
    expect(script).toContain("git commit")
    expect(script).not.toContain("git reset --mixed")
    expect(script).not.toContain("nothing to retain")
    expect(applyEmittedScript(repo, new Map(), script).ok).toBe(true)
    expect(repo.lastCommitSubject()).toBe("gtd(check): checking → idle")
  })

  it("the same rest with a pending change lands an ordinary commit too", async () => {
    const repo = await atChecking(REENTRY_WORKFLOW)
    repo.writeFile("OUT.txt", "all green\n")
    const { stdout, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    const script = (JSON.parse(stdout) as { readonly script: string }).script
    expect(script).toContain("git commit")
    expect(script).not.toContain("nothing to retain")
  })

  it("plain gtd land prints the prose sentence and points at --json=script, never the script itself", async () => {
    const repo = await atChecking(REENTRY_WORKFLOW)
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).not.toContain("git commit")
    expect(stdout).toMatch(/^commit everything with this message: /)
    expect(stdout).toContain("--json=script")
  })

  it("gtd land --json a no-op at a script rest reports settled:true, idle:false", async () => {
    const repo = await atChecking()
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

  it("gtd land --json a decision that re-enters the initial step reports settled:false, idle:true, state:idle", async () => {
    const repo = await atChecking(REENTRY_WORKFLOW)
    const { stdout, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(0)
    const parsed = JSON.parse(stdout) as {
      readonly settled: boolean
      readonly idle: boolean
      readonly state: string
    }
    expect(parsed.settled).toBe(false)
    expect(parsed.idle).toBe(true)
    expect(parsed.state).toBe("idle")
  })

  it("gtd land --json an ordinary commit reports settled:false", async () => {
    const repo = await atWorking(SETTLED_WORKFLOW)
    repo.writeFile("OUT.txt", "all green\n")
    const { stdout } = await run(repo, "land", "--json")
    const parsed = JSON.parse(stdout) as { readonly settled: boolean; readonly idle: boolean }
    expect(parsed.settled).toBe(false)
    expect(parsed.idle).toBe(false)
  })

  it("gtd land --json --cost=<n> --model=<name> carries both verbatim, and a genuine no-op reports both null", async () => {
    const withCost = await atWorking(SETTLED_WORKFLOW)
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

    const noop = await atChecking()
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

describe("gtd land — exit code does not name the post-land rest's owner", () => {
  const WORKFLOW = `import { added, agent, human, refuse, run, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "write NOTE.md to start a process" })
    await agent("working", "do the work described in NOTE.md")
    if (added("DONE.md").length > 0) {
      await human("waiting", { message: "confirm before continuing" })
    } else {
      await run("checking", "run-checks")
      refuse("checking accepts no turn")
    }
  },
})
`

  const atWorking = async (): Promise<InMemRepo> => {
    const repo = seed(WORKFLOW)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  const atChecking = async (): Promise<InMemRepo> => {
    const repo = await atWorking()
    await landTurn(repo, { "OUT.txt": "all green\n" })
    return repo
  }

  it("a landing whose next rest is a prompt step exits 0", async () => {
    const repo = seed(WORKFLOW)
    repo.writeFile("NOTE.md", "a note\n")
    expect((await run(repo, "land")).exitCode).toBe(0)
  })

  it("a landing whose next rest is a script step exits 0", async () => {
    const repo = await atWorking()
    repo.writeFile("OUT.txt", "all green\n")
    expect((await run(repo, "land")).exitCode).toBe(0)
  })

  it("a landing whose next rest is a message step exits 0", async () => {
    const repo = await atWorking()
    repo.writeFile("DONE.md", "done\n")
    const { stdout, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("gtd(agent): working → waiting")
  })

  it("a refusal exits 1 and emits nothing", async () => {
    const repo = await atChecking()
    repo.writeFile("scratch.txt", "an unrelated pending change\n")
    const before = repo.commitHistory().length
    const { stdout, stderr, exitCode } = await run(repo, "land")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain("checking accepts no turn")
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("a refusal under --json stays stdout byte-empty (the error envelope is on stderr)", async () => {
    const repo = await atChecking()
    repo.writeFile("scratch.txt", "an unrelated pending change\n")
    const { stdout, stderr, exitCode } = await run(repo, "land", "--json")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('"state":"error"')
  })
})

describe("gtd land — the landing script is only the commit", () => {
  // A step's mode `format:`/`validate:` pair runs in the driver, off
  // `gtd next --json`'s `validate` field — never inside the landing script.
  const NOTES_WORKFLOW = `import { agent, deleted, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "hi" })
    do {
      await agent("drafting", "write the notes", { file: ".gtd/NOTES.md", mode: "notes" })
    } while (deleted(".gtd/NOTES.md").length === 0)
  },
})
`

  const atDrafting = async (): Promise<InMemRepo> => {
    const repo = seed(NOTES_WORKFLOW, {
      ".gtdrc.yaml": ["modes:", "  notes:", '    format: "fmt-notes <%= it.file %>"', ""].join(
        "\n",
      ),
    })
    await landTurn(repo, { ".gtd/NOTES.md": "# notes\n\nfirst draft\n" })
    return repo
  }

  it("at a dirty steering file (file + mode), the emitted script carries no format/validate command", async () => {
    const repo = await atDrafting()
    repo.writeFile(".gtd/NOTES.md", "# notes\n\nsecond draft\n")
    const { exitCode, script } = await landAndApply(repo)
    expect(exitCode).toBe(0)
    expect(script).not.toContain("fmt-notes")
    expect(script).not.toContain("oxfmt")
    expect(script).not.toContain("prettier")
    expect(script).not.toContain("gtd check")
    expect(repo.lastCommitSubject()).toBe("gtd(agent): drafting")
  })

  it("still lands a step that deletes that file, with no format command either", async () => {
    const repo = await atDrafting()
    repo.deleteFile(".gtd/NOTES.md")
    const { exitCode, script } = await landAndApply(repo)
    expect(exitCode).toBe(0)
    expect(script).not.toContain("fmt-notes")
    expect(repo.lastCommitSubject()).toBe("gtd(agent): drafting → idle")
  })

  it("`gtd next --json`'s `validate` field carries the mode's format command", async () => {
    const repo = await atDrafting()
    repo.writeFile(".gtd/NOTES.md", "# notes\n\nsecond draft\n")
    const { stdout, exitCode } = await run(repo, "next", "--json")
    expect(exitCode).toBe(0)
    expect((JSON.parse(stdout) as { validate?: string }).validate).toContain(
      "fmt-notes .gtd/NOTES.md",
    )
  })
})

describe("runCommand — refuses in a repository with no commits", () => {
  // Typed as a total record, so a new `Command` kind fails typecheck until it
  // gets an entry here and `stateKinds` picks it up.
  const commandFor: Record<Command["kind"], Command> = {
    lsp: { kind: "lsp" },
    init: { kind: "init" },
    ui: { kind: "ui", selfSigned: false, dev: false },
    land: { kind: "land" },
    entry: { kind: "entry", actor: "human", state: "idle", vars: {}, label: "" },
    abandon: { kind: "abandon" },
    restore: { kind: "restore" },
    next: { kind: "next" },
    validate: { kind: "validate" },
    check: { kind: "check", mode: "qa", file: ".gtd/TODO.md" },
    uncheck: { kind: "uncheck", file: ".gtd/REVIEW.md" },
    install: { kind: "install" },
    summary: { kind: "summary" },
    base: { kind: "base" },
    exec: { kind: "exec" },
    judge: { kind: "judge" },
    judgeAnswer: { kind: "judgeAnswer" },
  }

  const stateKinds = (Object.keys(commandFor) as Command["kind"][]).filter(
    (kind) => needsOf(kind) === "state",
  )

  const NO_COMMITS_MESSAGE =
    "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

  it("derives exactly the twelve non-standalone kinds — a canary for the table-driven cases below", () => {
    expect(stateKinds.sort()).toEqual(
      [
        "abandon",
        "base",
        "entry",
        "exec",
        "land",
        "next",
        "restore",
        "summary",
        "validate",
        "ui",
        "judge",
        "judgeAnswer",
      ].sort(),
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
        runCommand(commandFor[kind], { kind: "off" }, out).pipe(Effect.provide(testLayers(repo))),
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
    const repo = seedBundled()
    const written: string[] = []
    const out = { write: (chunk: string) => written.push(chunk), flush: () => {} }

    const exit = await Effect.runPromiseExit(
      runCommand({ kind: "next" }, { kind: "off" }, out).pipe(Effect.provide(testLayers(repo))),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(written.length).toBeGreaterThan(0)
  })

  it("gtd ui in a repository WITH commits reaches its own dispatch, past the guard", async () => {
    const repo = seedBundled()
    const written: string[] = []
    const out = { write: (chunk: string) => written.push(chunk), flush: () => {} }

    const exit = await Effect.runPromiseExit(
      runCommand({ kind: "ui", selfSigned: false, dev: false }, { kind: "off" }, out).pipe(
        Effect.provide(testLayers(repo)),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      // `gtd ui` spawns a real subprocess to read the served worktree's beat —
      // the in-memory repo has no directory behind it, so this is its refusal.
      expect(String(exit.cause)).not.toContain(NO_COMMITS_MESSAGE)
      expect(String(exit.cause)).toContain("gtd ui: refuses to start")
    }
  })
})

describe("gtd summary", () => {
  const SUMMARY_WORKFLOW = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await human("idle", { message: "hi" })
      await agent("working", "go")
      await human("reviewing", { message: "check it" })
      await agent("polishing", "polish")
    },
  },
  {
    summary: (c) =>
      \`entry=\${c.entryCommit} tip=\${c.processTip} humans=\${c.humanCommits.length}\`,
  },
)
`

  const reviewed = async (): Promise<InMemRepo> => {
    const repo = seed(SUMMARY_WORKFLOW)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    await landTurn(repo, { "WORK.md": "done\n" })
    await landTurn(repo, { "REVIEW.md": "looks fine\n" })
    return repo
  }

  it("refuses when the workflow declares no summary, even with an in-flight process", async () => {
    const repo = seed(IDLE_THEN_WORKING)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    const before = repo.commitHistory().length
    const { exitCode, stdout, stderr } = await run(repo, "summary")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("gtd summary: refused —")
    expect(stdout).toBe("")
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("refuses when no process is underway at HEAD — an empty trace", async () => {
    const repo = seed(SUMMARY_WORKFLOW)
    const before = repo.commitHistory().length
    const { exitCode, stdout, stderr } = await run(repo, "summary")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("gtd summary: refused —")
    expect(stdout).toBe("")
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("writes the rendered summary, with a trailing newline, counting the human turns after the entry commit", async () => {
    const repo = await reviewed()
    const history = repo.commitHistory()
    const entryHash = history[history.length - 3]!.hash
    const tipHash = history[history.length - 1]!.hash

    const { exitCode, stdout } = await run(repo, "summary")
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`entry=${entryHash} tip=${tipHash} humans=1\n`)
  })

  it("writes nothing to git and emits no script — the output is the prompt only", async () => {
    const repo = await reviewed()
    const before = repo.commitHistory()

    const { exitCode, stdout } = await run(repo, "summary")
    expect(exitCode).toBe(0)
    expect(stdout).not.toContain("git reset --mixed")
    expect(stdout).not.toContain("git commit")

    const after = repo.commitHistory()
    expect(after).toHaveLength(before.length)
    expect(after.at(-1)!.hash).toBe(before.at(-1)!.hash)
  })
})

describe("gtd base — prints the review anchor hash", () => {
  // `deciding` anchors the review window at the commit that enters it;
  // FEEDBACK.md sends the process round again, a clean accept finishes it.
  const BASE_WORKFLOW = `import { added, agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { message: "hi" })
    for (;;) {
      await agent("working", "go")
      await human("deciding", { message: "decide", reviewBase: true, acceptClean: true })
      if (added("FEEDBACK.md").length === 0) return
    }
  },
})
`

  const atWorking = async (): Promise<InMemRepo> => {
    const repo = seed(BASE_WORKFLOW)
    await landTurn(repo, { "NOTE.md": "a note\n" })
    return repo
  }

  const atDeciding = async (): Promise<InMemRepo> => {
    const repo = await atWorking()
    await landTurn(repo, { "WORK.md": "done\n" })
    return repo
  }

  it("refuses when no process is underway at HEAD", async () => {
    const repo = seed(BASE_WORKFLOW)
    const before = repo.commitHistory().length
    const { exitCode, stdout, stderr } = await run(repo, "base")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("gtd base: refused —")
    expect(stdout).toBe("")
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("prints the process's diff base before the first review round lands", async () => {
    const repo = seed(BASE_WORKFLOW)
    const boundaryHash = repo.commitHistory().at(-1)!.hash
    await landTurn(repo, { "NOTE.md": "a note\n" })

    const { exitCode, stdout } = await run(repo, "base")
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${boundaryHash}\n`)
  })

  it("prints the commit entering the reviewBase step once one has landed this process", async () => {
    const repo = await atDeciding()
    const decidingHash = repo.commitHistory().at(-1)!.hash

    const { exitCode, stdout } = await run(repo, "base")
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${decidingHash}\n`)
  })

  it("on a second, incremental round prints the previous round's boundary, not the process start", async () => {
    const repo = await atDeciding()
    const firstDecidingHash = repo.commitHistory().at(-1)!.hash
    await landTurn(repo, { "FEEDBACK.md": "please change this\n" })

    const { exitCode, stdout } = await run(repo, "base")
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${firstDecidingHash}\n`)
  })

  it("refuses once the process has closed and HEAD rests at the initial step again", async () => {
    const repo = await atDeciding()
    await landTurn(repo)
    expect(repo.lastCommitSubject()).toBe("gtd(human): deciding → idle")

    const { exitCode, stdout, stderr } = await run(repo, "base")
    expect(exitCode).toBe(1)
    expect(stderr).toContain("gtd base: refused —")
    expect(stdout).toBe("")
  })

  it("writes nothing to git, and prints a bare hash plus a trailing newline", async () => {
    const repo = await atWorking()
    const before = repo.commitHistory()

    const { exitCode, stdout } = await run(repo, "base")
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/^[0-9a-f-]+\n$/)

    const after = repo.commitHistory()
    expect(after).toHaveLength(before.length)
    expect(after.at(-1)!.hash).toBe(before.at(-1)!.hash)
  })
})

describe("gtd next/land --json=<path> — the select branch", () => {
  const seededRepo = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile("NOTE.md", "a note\n")
    repo.commitAllWithPrefix("gtd: init")
    return repo
  }

  it("gtd next --json=kind reduces the SAME fields object gtd next --json renders — matches the document's own kind", async () => {
    const repo = seededRepo()
    const { stdout: documentOut, exitCode: documentExit } = await run(repo, "next", "--json")
    expect(documentExit).toBe(0)
    const parsedKind = (JSON.parse(documentOut) as { readonly kind: string }).kind

    const { stdout: selectOut, exitCode: selectExit } = await run(repo, "next", "--json=kind")
    expect(selectExit).toBe(0)
    expect(selectOut).toBe(`${parsedKind}\n`)
  })

  it("gtd land --json=state reduces the SAME fields object gtd land --json renders — matches the document's own state", async () => {
    const repo = seededRepo()
    const { stdout: documentOut, exitCode: documentExit } = await run(repo, "land", "--json")
    expect(documentExit).toBe(0)
    const parsedState = (JSON.parse(documentOut) as { readonly state: string }).state

    const { stdout: selectOut, exitCode: selectExit } = await run(repo, "land", "--json=state")
    expect(selectExit).toBe(0)
    expect(selectOut).toBe(`${parsedState}\n`)
  })

  it("a value selection is written with exactly one trailing newline, nothing else", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "next", "--json=kind")
    expect(exitCode).toBe(0)
    expect(stdout.endsWith("\n")).toBe(true)
    expect(stdout.endsWith("\n\n")).toBe(false)
  })

  it("an absent selector writes zero bytes to stdout and exits EXIT_OK", async () => {
    const repo = seededRepo()
    // The built-in workflow's initial `idle` state declares no `mode:` —
    // `mode` is a real, present-but-`undefined` field on the beat document
    // there (see `src/wire/BeatStatus.ts`'s `statusOf`), not merely an
    // unknown path.
    const { stdout, exitCode } = await run(repo, "next", "--json=mode")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it('a null-valued leaf (the beat document\'s next, on a clean tree) reads as absent — zero bytes, exit 0, never the string "null"', async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "next", "--json=next")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("--json=next.target descends through a null next without going fatal — absent, not unknown, per the absent-parent rule", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "next", "--json=next.target")
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it('gtd land\'s | null LandFields (subject/cost/model) at a no-op landing read as absent — never the string "null"', async () => {
    const repo = seededRepo()
    const { stdout: subjectOut, exitCode: subjectExit } = await run(repo, "land", "--json=subject")
    expect(subjectExit).toBe(0)
    expect(subjectOut).toBe("")

    const { stdout: costOut, exitCode: costExit } = await run(repo, "land", "--json=cost")
    expect(costExit).toBe(0)
    expect(costOut).toBe("")

    const { stdout: modelOut, exitCode: modelExit } = await run(repo, "land", "--json=model")
    expect(modelExit).toBe(0)
    expect(modelOut).toBe("")
  })

  it("an unknown selector fails with exit code EXIT_USAGE_ERROR, not a generic runtime error", async () => {
    const repo = seededRepo()
    const { exitCode } = await run(repo, "next", "--json=does.not.exist")
    expect(exitCode).toBe(EXIT_USAGE_ERROR)
  })

  it("an unknown selector writes its message to stderr and nothing to stdout", async () => {
    const repo = seededRepo()
    const { stdout, stderr, exitCode } = await run(repo, "next", "--json=does.not.exist")
    expect(exitCode).toBe(EXIT_USAGE_ERROR)
    expect(stdout).toBe("")
    expect(stderr).toContain("does.not.exist")
  })

  it("an unknown selector on gtd land also exits EXIT_USAGE_ERROR", async () => {
    const repo = seededRepo()
    const { stdout, stderr, exitCode } = await run(repo, "land", "--json=does.not.exist")
    expect(exitCode).toBe(EXIT_USAGE_ERROR)
    expect(stdout).toBe("")
    expect(stderr).toContain("does.not.exist")
  })

  it("the underlying failure program.ts raises for an unknown selector is a SelectorUsageError", async () => {
    const repo = seededRepo()
    const exit = await Effect.runPromiseExit(
      runCommand(
        { kind: "next" },
        { kind: "select", path: "does.not.exist" },
        {
          write: () => {},
          flush: () => {},
        },
      ).pipe(Effect.provide(testLayers(repo))),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)
      expect(failure._tag).toBe("Some")
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SelectorUsageError)
      }
    }
  })

  it("the self-validation-command resolution still runs only on the plain branch under JsonMode", async () => {
    // A degrade-on-error smoke check: a plain gtd next still succeeds (and
    // includes the resolved rest's rendered content) even though nothing here
    // declares a mode:/file: pair for the self-validate instruction to
    // resolve against.
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "next")
    expect(exitCode).toBe(0)
    expect(stdout.length).toBeGreaterThan(0)
  })
})

describe("gtd judge / gtd judge answer", () => {
  const JUDGE_DOCUMENT =
    '{"state":"idle","questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}'

  const QUESTION = `{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }`

  const judgeWorkflow = (evidence: string, then: string, vars = "{}"): string =>
    `import { agent, human, judge, tail, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await judge("idle", ${QUESTION}, ${evidence})
      await ${then}
    },
  },
  { vars: ${vars} },
)
`

  const seededRepo = (): InMemRepo => seed(judgeWorkflow('"idle"', 'agent("working", "go")'))

  const seededRepoWithoutJudge = (): InMemRepo => seed(IDLE_THEN_WORKING)

  const seededLandingRepo = (): InMemRepo =>
    seed(judgeWorkflow('"idle"', 'human("landed", { message: "done" })'))

  it("gtd judge prints the judge document verbatim, plus exactly one trailing newline", async () => {
    const repo = seededRepo()
    const { stdout, exitCode } = await run(repo, "judge")
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${JUDGE_DOCUMENT}\n`)
  })

  it("gtd judge --json prints the same document — a read-only peek, no mutation", async () => {
    const repo = seededRepo()
    const before = repo.commitHistory().length
    const { stdout, exitCode } = await run(repo, "judge", "--json")
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${JUDGE_DOCUMENT}\n`)
    expect(repo.commitHistory()).toHaveLength(before)
  })

  it("gtd judge refuses through the ordinary error envelope when the rest is no judge step", async () => {
    const repo = seededRepoWithoutJudge()
    const { exitCode, stderr, stdout } = await run(repo, "judge")
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('declares no "judge:"')
  })

  it("polling gtd judge twice reads byte-identical output — a peek, not a dispatch", async () => {
    const repo = seededRepo()
    const first = await run(repo, "judge")
    const second = await run(repo, "judge")
    expect(first.stdout).toBe(second.stdout)
  })

  let savedStdin: PropertyDescriptor | undefined
  afterEach(() => {
    if (savedStdin) {
      Object.defineProperty(process, "stdin", savedStdin)
      savedStdin = undefined
    }
  })

  const withStdin = async <T>(content: string, fn: () => Promise<T>): Promise<T> => {
    savedStdin = Object.getOwnPropertyDescriptor(process, "stdin")
    const stdin = new PassThrough()
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true })
    stdin.end(content)
    try {
      return await fn()
    } finally {
      if (savedStdin) Object.defineProperty(process, "stdin", savedStdin)
      savedStdin = undefined
    }
  }

  const VERDICT = JSON.stringify([{ id: "q1", answer: true, p: 0.97 }])

  it("gtd judge answer decodes a verdict on stdin against the pending question ids and succeeds", async () => {
    const repo = seededRepo()
    const { exitCode, stdout } = await withStdin(VERDICT, () => run(repo, "judge", "answer"))
    expect(exitCode).toBe(0)
    expect(stdout.length).toBeGreaterThan(0)
  })

  it("gtd judge answer refuses a verdict naming a question id the pending judgment never declared, with the usage-error exit code", async () => {
    const repo = seededRepo()
    const { exitCode, stderr } = await withStdin(
      JSON.stringify([{ id: "not-a-real-question", answer: true, p: 0.97 }]),
      () => run(repo, "judge", "answer"),
    )
    expect(exitCode).toBe(2)
    expect(stderr).toContain("does not match the pending questions")
  })

  it("gtd judge answer refuses when stdin is not valid JSON at all, with the usage-error exit code", async () => {
    const repo = seededRepo()
    const { exitCode, stderr } = await withStdin("not json", () => run(repo, "judge", "answer"))
    expect(exitCode).toBe(2)
    expect(stderr).toContain("stdin is not valid JSON")
  })

  it("gtd judge answer refuses a verdict whose p is above 1 — an unvalidated p would clear every minP", async () => {
    const repo = seededRepo()
    const { exitCode, stderr } = await withStdin(
      JSON.stringify([{ id: "q1", answer: true, p: 5 }]),
      () => run(repo, "judge", "answer"),
    )
    expect(exitCode).toBe(2)
    expect(stderr).toContain("does not match the pending questions")
  })

  it("gtd judge answer refuses a verdict whose p is negative", async () => {
    const repo = seededRepo()
    const { exitCode, stderr } = await withStdin(
      JSON.stringify([{ id: "q1", answer: true, p: -0.1 }]),
      () => run(repo, "judge", "answer"),
    )
    expect(exitCode).toBe(2)
    expect(stderr).toContain("does not match the pending questions")
  })

  it("gtd judge answer refuses through the ordinary error envelope when the rest is no judge step", async () => {
    const repo = seededRepoWithoutJudge()
    const { exitCode, stderr } = await withStdin("[]", () => run(repo, "judge", "answer"))
    expect(exitCode).toBe(1)
    expect(stderr).toContain('declares no "judge:"')
  })

  it("gtd judge answer --json=script emits a POSIX sh script carrying a Gtd-Judge: trailer on the step commit", async () => {
    const repo = seededLandingRepo()
    const { stdout, exitCode } = await withStdin(VERDICT, () =>
      run(repo, "judge", "answer", "--json=script"),
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain(DID_NOT_RUN_COMMENT)
    expect(stdout).toContain('Gtd-Judge: {"id":"q1","answer":true,"p":0.97}')

    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.lastCommitSubject()).toBe("gtd(judge): idle → landed")
    expect(repo.lastCommitMessage()).toContain('Gtd-Judge: {"id":"q1","answer":true,"p":0.97}')
  })

  it("gtd judge answer --json=script opens with the same leading comment as land's script", async () => {
    const repo = seededLandingRepo()
    const { stdout: script } = await withStdin(VERDICT, () =>
      run(repo, "judge", "answer", "--json=script"),
    )
    const { stdout: landScript } = await run(repo, "land", "--json=script")
    expect(script.split("\n")[0]).toBe(landScript.split("\n")[0])
  })

  it("plain gtd judge answer (no --json) names the commit and points at --json=script, never the script itself", async () => {
    const repo = seededLandingRepo()
    const { stdout, exitCode } = await withStdin(VERDICT, () => run(repo, "judge", "answer"))
    expect(exitCode).toBe(0)
    expect(stdout).toContain("--json=script")
    expect(stdout).not.toContain(DID_NOT_RUN_COMMENT)
  })

  // The judged render's own truncation flag must reach the landing commit —
  // not a fresh re-resolve of the rest.
  const seededTruncatingLandingRepo = (judgeBudgetBytes: string, bigContent: string): InMemRepo =>
    seed(
      judgeWorkflow(
        'tail(".gtd/BIG.md", 1)',
        'human("landed", { message: "done" })',
        `{ judgeBudgetBytes: "${judgeBudgetBytes}" }`,
      ),
      { ".gtd/BIG.md": bigContent },
    )

  it('gtd judge answer stamps Gtd-Payload: {"truncated":true} on the landing commit when the evidence was cut to fit the budget', async () => {
    const repo = seededTruncatingLandingRepo("20", "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n")
    const { stdout, exitCode } = await withStdin(VERDICT, () =>
      run(repo, "judge", "answer", "--json=script"),
    )
    expect(exitCode).toBe(0)
    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.lastCommitMessage()).toContain('Gtd-Payload: {"truncated":true}')
  })

  it("gtd judge answer stamps no Gtd-Payload: trailer when the evidence fit the budget", async () => {
    const repo = seededTruncatingLandingRepo("500", "short\n")
    const { stdout, exitCode } = await withStdin(VERDICT, () =>
      run(repo, "judge", "answer", "--json=script"),
    )
    expect(exitCode).toBe(0)
    expect(applyEmittedScript(repo, new Map(), stdout).ok).toBe(true)
    expect(repo.lastCommitMessage()).not.toContain("Gtd-Payload:")
  })
})
