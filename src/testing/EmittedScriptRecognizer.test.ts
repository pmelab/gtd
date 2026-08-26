import { describe, expect, it } from "vitest"
import {
  commitAll,
  commitAsIs,
  deleteRef,
  discardPending,
  hardResetTo,
  mixedResetTo,
  softResetTo,
  updateRef,
} from "../GitScript.js"
import {
  combinedScript,
  emitScripts,
  fileExistsGuard,
  headAssertion,
  type EmitStep,
} from "../Emit.js"
import { commitOutcome, noteOutcome, OUTCOME_PREAMBLE } from "../OutcomeScript.js"
import { buildModeContradictionCheck, modeContradictionSkipNotice } from "../ModeContradiction.js"
import { applyEmittedScript, preconditionHeadEquals } from "./EmittedScriptRecognizer.js"
import { InMemRepo } from "./InMemRepo.js"
import type { ScriptedCommand } from "./Layers.js"

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const snapshot = (repo: InMemRepo) => ({
  head: repo.resolveRef("HEAD"),
  message: repo.lastCommitMessage(),
  status: repo.statusPorcelain(),
  files: repo.pathsUnder("").map((path) => [path, repo.readFile(path)]),
})

const NO_COMMANDS: ReadonlyMap<string, ScriptedCommand> = new Map()

describe("applyEmittedScript — the 8 GitScript builders", () => {
  it("commitAll: stages the worktree and commits, like commitAllWithPrefix", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")

    const result = applyEmittedScript(repo, NO_COMMANDS, commitAll("gtd(agent): building"))
    twin.commitAllWithPrefix("gtd(agent): building")

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
  })

  it("commitAsIs: commits whatever is already staged, without an implicit add", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.stageAll()
    repo.writeFile("a.txt", "2") // pending worktree change, left OUT of the index on purpose
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")
    twin.stageAll()
    twin.writeFile("a.txt", "2")

    const result = applyEmittedScript(repo, NO_COMMANDS, commitAsIs("gtd(agent): as-is"))
    twin.commitAsIs("gtd(agent): as-is")

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
  })

  it("softResetTo: moves HEAD only, leaving index and worktree untouched", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const first = repo.resolveRef("HEAD")!
    repo.writeFile("b.txt", "2")
    repo.commitAllWithPrefix("chore: second")
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")
    twin.commitAllWithPrefix("chore: first")
    twin.writeFile("b.txt", "2")
    twin.commitAllWithPrefix("chore: second")

    const result = applyEmittedScript(repo, NO_COMMANDS, softResetTo(first))
    twin.softResetTo(first)

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
    expect(repo.resolveRef("HEAD")).toBe(first)
  })

  it("mixedResetTo: moves HEAD and index, leaving the worktree untouched", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const first = repo.resolveRef("HEAD")!
    repo.writeFile("b.txt", "2")
    repo.commitAllWithPrefix("chore: second")
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")
    twin.commitAllWithPrefix("chore: first")
    twin.writeFile("b.txt", "2")
    twin.commitAllWithPrefix("chore: second")

    const result = applyEmittedScript(repo, NO_COMMANDS, mixedResetTo(first))
    twin.mixedResetTo(first)

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
  })

  it("hardResetTo: moves HEAD, index, AND worktree", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const first = repo.resolveRef("HEAD")!
    repo.writeFile("b.txt", "2")
    repo.commitAllWithPrefix("chore: second")
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")
    twin.commitAllWithPrefix("chore: first")
    twin.writeFile("b.txt", "2")
    twin.commitAllWithPrefix("chore: second")

    const result = applyEmittedScript(repo, NO_COMMANDS, hardResetTo(first))
    twin.hardResetTo(first)

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
    expect(repo.hasPath("b.txt")).toBe(false)
  })

  it("discardPending: drops every pending change, tracked or untracked", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    repo.writeFile("a.txt", "changed")
    repo.writeFile("untracked.txt", "new")
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")
    twin.commitAllWithPrefix("chore: first")
    twin.writeFile("a.txt", "changed")
    twin.writeFile("untracked.txt", "new")

    const result = applyEmittedScript(repo, NO_COMMANDS, discardPending())
    twin.discardPending()

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
    expect(repo.readFile("a.txt")).toBe("1")
    expect(repo.hasPath("untracked.txt")).toBe(false)
  })

  it("updateRef: points a repo-local ref at a commit hash", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const hash = repo.resolveRef("HEAD")!
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")
    twin.commitAllWithPrefix("chore: first")

    const result = applyEmittedScript(repo, NO_COMMANDS, updateRef("refs/gtd/base", hash))
    twin.updateRef("refs/gtd/base", hash)

    expect(result).toEqual({ ok: true })
    expect(repo.resolveRef("refs/gtd/base")).toBe(hash)
    expect(snapshot(repo)).toEqual(snapshot(twin))
  })

  it("deleteRef: removes a repo-local ref (idempotently)", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    repo.updateRef("refs/gtd/base", repo.resolveRef("HEAD")!)
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")
    twin.commitAllWithPrefix("chore: first")
    twin.updateRef("refs/gtd/base", twin.resolveRef("HEAD")!)

    const result = applyEmittedScript(repo, NO_COMMANDS, deleteRef("refs/gtd/base"))
    twin.deleteRef("refs/gtd/base")

    expect(result).toEqual({ ok: true })
    expect(repo.resolveRef("refs/gtd/base")).toBeNull()
    expect(snapshot(repo)).toEqual(snapshot(twin))
  })
})

describe("applyEmittedScript — gtd check <mode> <file>", () => {
  it("passes on valid qa-mode content", () => {
    const repo = new InMemRepo()
    repo.writeFile(
      ".gtd/TODO.md",
      ["## Open Questions", "", "### What color?", "", "- [ ] Red", "- [ ] Blue"].join("\n"),
    )

    const result = applyEmittedScript(repo, NO_COMMANDS, "gtd check qa '.gtd/TODO.md'")

    expect(result).toEqual({ ok: true })
  })

  it("fails on invalid qa-mode content (a bare ### heading with no question text)", () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtd/TODO.md", ["## Open Questions", "", "### "].join("\n"))

    const result = applyEmittedScript(repo, NO_COMMANDS, "gtd check qa '.gtd/TODO.md'")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("gtd check qa")
  })
})

describe("applyEmittedScript — Emit.ts's fileExistsGuard", () => {
  it("is a no-op continuation when the file is present", () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtd/PLAN.md", "content")

    const result = applyEmittedScript(repo, NO_COMMANDS, fileExistsGuard(".gtd/PLAN.md"))

    expect(result).toEqual({ ok: true })
  })

  it("stops the whole script (successfully) when the file is absent — unlike every other guard, it does not fail", () => {
    const repo = new InMemRepo()

    const script = [fileExistsGuard(".gtd/PLAN.md"), "gtd check qa '.gtd/PLAN.md'"].join("\n\n")
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
  })

  it("a subsequent block after the guard trips is never applied", () => {
    const repo = new InMemRepo()
    const commands: ReadonlyMap<string, ScriptedCommand> = new Map([
      ["./should-not-run.sh", { kind: "rewrite", file: "MARKER.md", content: "ran" }],
    ])

    const script = [fileExistsGuard(".gtd/PLAN.md"), "./should-not-run.sh"].join("\n\n")
    applyEmittedScript(repo, commands, script)

    expect(repo.readFile("MARKER.md")).toBeUndefined()
  })
})

describe("applyEmittedScript — ModeContradiction.ts's skip notice", () => {
  it("is an inert no-op — a mode with an external validator prints a notice and continues", () => {
    const repo = new InMemRepo()

    const result = applyEmittedScript(repo, NO_COMMANDS, modeContradictionSkipNotice("adr"))

    expect(result).toEqual({ ok: true })
  })
})

describe("applyEmittedScript — ModeContradiction.ts's contradiction round-trip", () => {
  const samplePath = "/fixture-scratch/gtd-mode-sample-qa-1234.md"
  const sample = "Sample plan.\n\n## Open Questions\n\n### Which?\n\n- [ ] A\n- [ ] B\n"

  it("passes (and cleans up the scratch file) when the formatter leaves the sample valid", () => {
    const repo = new InMemRepo()
    const commands: ReadonlyMap<string, ScriptedCommand> = new Map([
      ["my-formatter " + samplePath, { kind: "exit", status: 0, output: "" }],
    ])
    const block = buildModeContradictionCheck({
      mode: "qa",
      samplePath,
      sample,
      formatCommand: `my-formatter ${samplePath}`,
    })

    const result = applyEmittedScript(repo, commands, block)

    expect(result).toEqual({ ok: true })
    expect(repo.readFile(samplePath)).toBeUndefined()
  })

  it("fails (and cleans up the scratch file) when the formatter breaks the sample under its own parser", () => {
    const repo = new InMemRepo()
    const commands: ReadonlyMap<string, ScriptedCommand> = new Map([
      [
        "my-formatter " + samplePath,
        {
          kind: "rewrite",
          file: samplePath,
          content: "## Open Questions\n\n### \n\nblank heading, invalid",
        },
      ],
    ])
    const block = buildModeContradictionCheck({
      mode: "qa",
      samplePath,
      sample,
      formatCommand: `my-formatter ${samplePath}`,
    })

    const result = applyEmittedScript(repo, commands, block)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("CONFIGURATION BUG")
    expect(result.error).toContain("### ")
    expect(repo.readFile(samplePath)).toBeUndefined()
  })

  it("fails loudly on an unscripted format: command rather than silently passing", () => {
    const repo = new InMemRepo()
    const block = buildModeContradictionCheck({
      mode: "qa",
      samplePath,
      sample,
      formatCommand: "unregistered-formatter " + samplePath,
    })

    const result = applyEmittedScript(repo, NO_COMMANDS, block)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("unscripted command")
    expect(repo.readFile(samplePath)).toBeUndefined()
  })

  it("leaves nothing in the repo either way — no untracked path for changedPaths to report", () => {
    const repo = new InMemRepo()
    const commands: ReadonlyMap<string, ScriptedCommand> = new Map([
      ["my-formatter " + samplePath, { kind: "exit", status: 0, output: "" }],
    ])
    const block = buildModeContradictionCheck({
      mode: "qa",
      samplePath,
      sample,
      formatCommand: `my-formatter ${samplePath}`,
    })

    applyEmittedScript(repo, commands, block)

    expect(repo.pathsUnder("").includes(samplePath)).toBe(false)
  })
})

describe("applyEmittedScript — the scripted-command table", () => {
  it("an 'exit' hit with status 0 continues", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const commands: ReadonlyMap<string, ScriptedCommand> = new Map([
      ["./run-check.sh", { kind: "exit", status: 0, output: "ok" }],
    ])

    const result = applyEmittedScript(repo, commands, "./run-check.sh")

    expect(result).toEqual({ ok: true })
  })

  it("an 'exit' hit with a non-zero status fails the script", () => {
    const repo = new InMemRepo()
    const commands: ReadonlyMap<string, ScriptedCommand> = new Map([
      ["./run-check.sh", { kind: "exit", status: 1, output: "boom" }],
    ])

    const result = applyEmittedScript(repo, commands, "./run-check.sh")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("./run-check.sh")
  })

  it("a 'rewrite' hit mutates the repo's file", () => {
    const repo = new InMemRepo()
    repo.writeFile("FEEDBACK.md", "old")
    const commands: ReadonlyMap<string, ScriptedCommand> = new Map([
      ["./format-feedback.sh", { kind: "rewrite", file: "FEEDBACK.md", content: "new" }],
    ])

    const result = applyEmittedScript(repo, commands, "./format-feedback.sh")

    expect(result).toEqual({ ok: true })
    expect(repo.readFile("FEEDBACK.md")).toBe("new")
  })
})

describe("applyEmittedScript — unrecognized blocks fail loudly", () => {
  it("names the offending line in the error and applies nothing", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const before = snapshot(repo)

    const result = applyEmittedScript(repo, NO_COMMANDS, "curl -X POST https://example.com/hook")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("curl -X POST https://example.com/hook")
    expect(snapshot(repo)).toEqual(before)
  })
})

describe("applyEmittedScript — a tripped precondition stops the script", () => {
  it("fails at the precondition and never applies a subsequent recognizable block", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const actualHead = repo.resolveRef("HEAD")!
    const wrongHash = "0".repeat(40)
    expect(wrongHash).not.toBe(actualHead)

    const script = [
      preconditionHeadEquals(wrongHash),
      commitAll("gtd(agent): should never land"),
    ].join("\n\n")

    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("precondition failed")
    expect(repo.resolveRef("HEAD")).toBe(actualHead)
    expect(repo.lastCommitMessage()).toBe("chore: first")
  })

  it("a satisfied precondition is a no-op and lets the rest of the script run", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const actualHead = repo.resolveRef("HEAD")!

    const script = [preconditionHeadEquals(actualHead), commitAll("gtd(agent): lands")].join("\n\n")

    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(agent): lands")
  })
})

describe("applyEmittedScript — a realistic assembled multi-block script", () => {
  it("parses set -eu and a satisfied precondition alongside real builder blocks", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const first = repo.resolveRef("HEAD")!

    const script = [
      "set -eu",
      preconditionHeadEquals(first),
      commitAll("gtd(agent): second"),
      updateRef("refs/gtd/base", first),
    ].join("\n\n")

    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(agent): second")
    expect(repo.resolveRef("refs/gtd/base")).toBe(first)
  })
})

describe("applyEmittedScript — src/Emit.ts's real head assertion", () => {
  it("a satisfied assertion is a no-op and lets the rest of the script run", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const head = repo.resolveRef("HEAD")!

    const script = [headAssertion(head), commitAll("gtd(agent): second")].join("\n\n")
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(agent): second")
  })

  it("a tripped assertion stops the script before any subsequent block applies", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const actualHead = repo.resolveRef("HEAD")!
    const staleHead = "0".repeat(40)
    expect(staleHead).not.toBe(actualHead)

    const script = [headAssertion(staleHead), commitAll("gtd(agent): should never land")].join(
      "\n\n",
    )
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("repository changed")
    expect(repo.resolveRef("HEAD")).toBe(actualHead)
    expect(repo.lastCommitMessage()).toBe("chore: first")
  })
})

describe("applyEmittedScript — a realistic src/Emit.ts-assembled script (gtd_retry-wrapped)", () => {
  it("commitAll wrapped in gtd_retry applies exactly like commitAllWithPrefix", () => {
    const repo = new InMemRepo()
    repo.writeFile("base.txt", "0")
    repo.commitAllWithPrefix("chore: first")
    const head = repo.resolveRef("HEAD")!
    repo.writeFile("a.txt", "1")
    const twin = new InMemRepo()
    twin.writeFile("base.txt", "0")
    twin.commitAllWithPrefix("chore: first")
    twin.writeFile("a.txt", "1")

    const steps: readonly EmitStep[] = [
      { kind: "gitWrite", command: commitAll("gtd(agent): building") },
    ]
    const { required } = emitScripts({ expectedHead: head }, steps)
    const result = applyEmittedScript(repo, NO_COMMANDS, required)
    twin.commitAllWithPrefix("gtd(agent): building")

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
  })

  it("a squash's four gitWrite steps (retain, soft-reset, commit-as-is, discard) apply in order", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("gtd(agent): building")
    const tip = repo.resolveRef("HEAD")!
    // Untracked, never staged — the index still matches the tip's own tree
    // exactly, mirroring the real flow where nothing `git add`s between the
    // last turn commit and a squash decision. `commitAsIs` commits the INDEX
    // as-is (no implicit staging), so this file is absent from the squashed
    // commit's tree; `discardPending`'s `git add -A && git reset --hard HEAD`
    // then drops it from the working tree too (staged-but-not-in-HEAD).
    repo.writeFile(".gtd/TODO.md", "leftover plumbing")

    const steps: readonly EmitStep[] = [
      { kind: "gitWrite", command: updateRef("refs/worktree/gtd/history", tip) },
      { kind: "gitWrite", command: softResetTo(EMPTY_TREE) },
      { kind: "gitWrite", command: commitAsIs("chore: squashed") },
      { kind: "gitWrite", command: discardPending() },
    ]
    const { required } = emitScripts({ expectedHead: tip }, steps)
    const result = applyEmittedScript(repo, NO_COMMANDS, required)

    expect(result).toEqual({ ok: true })
    expect(repo.resolveRef("refs/worktree/gtd/history")).toBe(tip)
    expect(repo.lastCommitMessage()).toBe("chore: squashed")
    expect(repo.hasPath(".gtd/TODO.md")).toBe(false)
  })
})

describe("applyEmittedScript — outcome blocks are inert (no git effect to miss)", () => {
  it("the OUTCOME_PREAMBLE block applies as a no-op", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const before = snapshot(repo)

    const result = applyEmittedScript(repo, NO_COMMANDS, OUTCOME_PREAMBLE)

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(before)
  })

  it("a bare gtd_report_* call applies as a no-op", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const before = snapshot(repo)

    const result = applyEmittedScript(repo, NO_COMMANDS, commitOutcome("gtd(agent): x"))

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(before)
  })

  it("a realistic assembled script — commitAll's gitWrite plus a trailing outcome step — applies exactly like commitAllWithPrefix, the outcome step contributing nothing", () => {
    const repo = new InMemRepo()
    repo.writeFile("base.txt", "0")
    repo.commitAllWithPrefix("chore: first")
    const head = repo.resolveRef("HEAD")!
    repo.writeFile("a.txt", "1")
    const twin = new InMemRepo()
    twin.writeFile("base.txt", "0")
    twin.commitAllWithPrefix("chore: first")
    twin.writeFile("a.txt", "1")

    const steps: readonly EmitStep[] = [
      { kind: "gitWrite", command: commitAll("gtd(agent): building") },
      { kind: "outcome", command: commitOutcome("gtd(agent): building") },
    ]
    const { required } = emitScripts({ expectedHead: head }, steps)
    const result = applyEmittedScript(repo, NO_COMMANDS, required)
    twin.commitAllWithPrefix("gtd(agent): building")

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
  })

  it("a print-only no-op script (a single outcome step, no gitWrite) applies as a no-op", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const before = snapshot(repo)

    const { required } = emitScripts({}, [
      { kind: "outcome", command: noteOutcome('nothing to do at "idle"') },
    ])
    const result = applyEmittedScript(repo, NO_COMMANDS, required)

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(before)
  })
})

describe("applyEmittedScript — the gtd_retry function definition is an inert no-op", () => {
  it("a bare 'gtd_retry() { ... }' block applies as a no-op", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const before = snapshot(repo)

    const script = ["gtd_retry() {", "  echo hi", "}"].join("\n")
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(before)
  })
})

describe("applyEmittedScript — Emit.ts's combinedScript (the whole stdout of a plain-text write command)", () => {
  it("recognizes the leading 'did not run it' comment and applies the required half that follows it", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")

    const required = emitScripts({}, [
      { kind: "gitWrite", command: commitAll("gtd(human): idle") },
    ]).required
    const script = combinedScript(required, "")
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(human): idle")
  })

  it("applies a non-empty optional half wrapped in the presentation-only subshell, even though the optional script itself carries a blank line between its own sections", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")

    const required = emitScripts({}, [
      { kind: "gitWrite", command: commitAll("gtd(human): idle") },
    ]).required
    // A gitWrite optional half is itself multi-section (assembleScript joins
    // "set -eu", the gtd_retry definition, and the retry-wrapped
    // command with blank lines) — the realistic shape this recognizer must
    // keep intact as ONE block.
    const optional = emitScripts({}, [
      { kind: "gitWrite", command: updateRef("refs/gtd/marker", "HEAD") },
    ]).required
    expect(optional).toContain("\n\n")
    const script = combinedScript(required, optional)

    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(human): idle")
    expect(repo.resolveRef("refs/gtd/marker")).toBe(repo.resolveRef("HEAD"))
  })

  it("a failing optional half is swallowed — the combined script as a whole still applies ok", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")

    const required = emitScripts({}, [
      { kind: "gitWrite", command: commitAll("gtd(human): idle") },
    ]).required
    // An optional half whose own block is unrecognizable — a stand-in for a
    // real optional script failing at run time — must not fail the OUTER
    // script: `combinedScript` wraps the optional half in a subshell whose
    // failure it deliberately swallows.
    const script = combinedScript(required, "totally-unrecognized-command")

    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(human): idle")
  })

  it("still fails loudly on an unrecognized block outside the presentation-only subshell", () => {
    const repo = new InMemRepo()
    const script = `${combinedScript("totally-unrecognized-required-command", "")}`
    const result = applyEmittedScript(repo, NO_COMMANDS, script)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("totally-unrecognized-required-command")
  })
})
