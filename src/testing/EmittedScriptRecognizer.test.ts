import { describe, expect, it } from "vitest"
import {
  commitAll,
  commitAsIs,
  deleteRef,
  discardPending,
  hardResetTo,
  mixedResetTo,
  restoreStagedFrom,
  softResetTo,
  updateRef,
} from "../GitScript.js"
import { emitScripts, headAssertion, reviewWindowAssertion, type EmitStep } from "../Emit.js"
import {
  buildCloseWindowScript,
  buildOpenWindowScript,
  REVIEW_BASE_REF,
  REVIEW_HEAD_REF,
} from "../ReviewWindow.js"
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

describe("applyEmittedScript — the 9 GitScript builders", () => {
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

  it("restoreStagedFrom: resets index entries under given paths to their content at source, leaving HEAD and worktree untouched", () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtd/TODO.md", "base")
    repo.commitAllWithPrefix("chore: base")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile(".gtd/TODO.md", "changed")
    repo.stageAll()
    const twin = new InMemRepo()
    twin.writeFile(".gtd/TODO.md", "base")
    twin.commitAllWithPrefix("chore: base")
    twin.writeFile(".gtd/TODO.md", "changed")
    twin.stageAll()

    const result = applyEmittedScript(repo, NO_COMMANDS, restoreStagedFrom(base, [".gtd/"]))
    twin.restoreStagedFrom(base, [".gtd/"])

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(snapshot(twin))
    // Index restored to base content, worktree still holds the pending edit.
    expect(repo.statusPorcelain()).toContain(".gtd/TODO.md")
    expect(repo.readFile(".gtd/TODO.md")).toBe("changed")
  })

  it("restoreStagedFrom emits nothing for an empty paths list — an empty script applies cleanly as a no-op", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const before = snapshot(repo)

    const result = applyEmittedScript(repo, NO_COMMANDS, restoreStagedFrom("HEAD", []))

    expect(result).toEqual({ ok: true })
    expect(snapshot(repo)).toEqual(before)
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
  it("parses set -euo pipefail and a satisfied precondition alongside real builder blocks", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const first = repo.resolveRef("HEAD")!

    const script = [
      "set -euo pipefail",
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

  it("EMPTY_TREE matches a repo with no commits yet", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")

    const script = [headAssertion(EMPTY_TREE), commitAll("gtd(agent): first")].join("\n\n")
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(agent): first")
  })
})

describe("applyEmittedScript — src/Emit.ts's review-window-ref assertion", () => {
  it("a satisfied assertion is a no-op", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const head = repo.resolveRef("HEAD")!
    repo.updateRef(REVIEW_HEAD_REF, head)

    const script = [
      headAssertion(head),
      reviewWindowAssertion(REVIEW_HEAD_REF, head),
      commitAll("gtd(agent): second"),
    ].join("\n\n")
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.lastCommitMessage()).toBe("gtd(agent): second")
  })

  it("a moved/missing ref fails the script", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: first")
    const head = repo.resolveRef("HEAD")!
    // REVIEW_HEAD_REF deliberately left unset — the assertion expects a hash.

    const script = [
      headAssertion(head),
      reviewWindowAssertion(REVIEW_HEAD_REF, head),
      commitAll("gtd(agent): should never land"),
    ].join("\n\n")
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("review window ref")
    expect(repo.lastCommitMessage()).toBe("chore: first")
  })
})

describe("applyEmittedScript — a realistic src/Emit.ts-assembled script (gtd_retry-wrapped)", () => {
  it("commitAll wrapped in gtd_retry applies exactly like commitAllWithPrefix", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    const twin = new InMemRepo()
    twin.writeFile("a.txt", "1")

    const steps: readonly EmitStep[] = [
      { kind: "gitWrite", command: commitAll("gtd(agent): building") },
    ]
    const { required } = emitScripts({ expectedHead: EMPTY_TREE }, steps)
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

describe("applyEmittedScript — src/ReviewWindow.ts's compound open/close scripts", () => {
  it("buildCloseWindowScript (bare) restores HEAD and drops both refs", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: base")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("b.txt", "2")
    repo.commitAllWithPrefix("chore: real head")
    const realHead = repo.resolveRef("HEAD")!
    repo.updateRef(REVIEW_BASE_REF, base)
    repo.updateRef(REVIEW_HEAD_REF, realHead)
    repo.mixedResetTo(base) // simulate an already-open window

    const script = buildCloseWindowScript({
      headRef: REVIEW_HEAD_REF,
      baseRef: REVIEW_BASE_REF,
      headHash: realHead,
      legacy: false,
    })
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.resolveRef("HEAD")).toBe(realHead)
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBeNull()
    expect(repo.resolveRef(REVIEW_BASE_REF)).toBeNull()
  })

  it("buildCloseWindowScript wrapped in gtd_retry applies identically", () => {
    const repo = new InMemRepo()
    repo.writeFile("a.txt", "1")
    repo.commitAllWithPrefix("chore: base")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("b.txt", "2")
    repo.commitAllWithPrefix("chore: real head")
    const realHead = repo.resolveRef("HEAD")!
    repo.updateRef(REVIEW_BASE_REF, base)
    repo.updateRef(REVIEW_HEAD_REF, realHead)
    repo.mixedResetTo(base)

    const steps: readonly EmitStep[] = [
      {
        kind: "gitWrite",
        command: buildCloseWindowScript({
          headRef: REVIEW_HEAD_REF,
          baseRef: REVIEW_BASE_REF,
          headHash: realHead,
          legacy: false,
        }),
      },
    ]
    const { required } = emitScripts({ expectedHead: base }, steps)
    const result = applyEmittedScript(repo, NO_COMMANDS, required)

    expect(result).toEqual({ ok: true })
    expect(repo.resolveRef("HEAD")).toBe(realHead)
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBeNull()
    expect(repo.resolveRef(REVIEW_BASE_REF)).toBeNull()
  })

  it("buildOpenWindowScript (bare) with the literal 'HEAD' head resolves against the repo's own current head", () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtd/REVIEW.md", "base copy")
    repo.commitAllWithPrefix("chore: base")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("a.txt", "1")
    repo.writeFile(".gtd/REVIEW.md", "head copy")
    repo.commitAllWithPrefix("gtd(agent): await-review")
    const realHead = repo.resolveRef("HEAD")!

    const script = buildOpenWindowScript({ base, head: "HEAD" })
    const result = applyEmittedScript(repo, NO_COMMANDS, script)

    expect(result).toEqual({ ok: true })
    expect(repo.resolveRef(REVIEW_BASE_REF)).toBe(base)
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBe(realHead)
    expect(repo.resolveRef("HEAD")).toBe(base)
    // `.gtd/`'s index entry is pinned back to the real head's content, which
    // still reads as staged-modified relative to the rewound (base) HEAD —
    // exactly like `review-window.feature`'s own scenarios, this only asserts
    // it's never UNTRACKED (an editor's default unstaged-diff view stays
    // clean for it either way, since worktree already matches the pinned
    // index). The new file added since the base surfaces as an ORDINARY
    // UNTRACKED file (see `openReviewWindow`'s own doc comment on why this is
    // deliberate).
    expect(repo.statusPorcelain()).toContain("?? a.txt")
    expect(repo.statusPorcelain()).not.toContain("?? .gtd/REVIEW.md")
  })

  it("buildOpenWindowScript wrapped in gtd_retry applies identically", () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtd/REVIEW.md", "base copy")
    repo.commitAllWithPrefix("chore: base")
    const base = repo.resolveRef("HEAD")!
    repo.writeFile("a.txt", "1")
    repo.writeFile(".gtd/REVIEW.md", "head copy")
    repo.commitAllWithPrefix("gtd(agent): await-review")
    const realHead = repo.resolveRef("HEAD")!

    const steps: readonly EmitStep[] = [
      { kind: "gitWrite", command: buildOpenWindowScript({ base, head: "HEAD" }) },
    ]
    const { required } = emitScripts({ expectedHead: realHead }, steps)
    const result = applyEmittedScript(repo, NO_COMMANDS, required)

    expect(result).toEqual({ ok: true })
    expect(repo.resolveRef(REVIEW_BASE_REF)).toBe(base)
    expect(repo.resolveRef(REVIEW_HEAD_REF)).toBe(realHead)
    expect(repo.resolveRef("HEAD")).toBe(base)
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
