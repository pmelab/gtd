import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  abandonedOutcome,
  combinedScript,
  commitAll,
  commitAsIs,
  deleteBranch,
  emitScripts,
  failRestScript,
  failurePromptWrapper,
  switchBranchTo,
  switchBack,
  switchTo,
  transitionOutcome,
  type EmitStep,
} from "../emit/index.js"
import { Effect, Option } from "effect"
import { ScriptSurface } from "../emit/index.js"
import { GitService, shippedRef } from "../platform/index.js"
import { gitTiers, type GitTier, type ScriptedCommand } from "./index.js"

// Every case runs through real `sh` — with this build's `gtd` on PATH — and
// through `applyEmittedScript`. A command a case runs is declared for the
// in-memory twin; Live runs it for real, so a declaration that lies fails here.
const FILE = ".gtd/a.md"
const COPY = `cp '${FILE}' copy.md`
const FAILING = `printf "bad: %s\\n" '${FILE}'; exit 2`

const commands = new Map<string, ScriptedCommand>([
  [`cp '${FILE}' copy.md`, { kind: "rewrite", file: "copy.md", content: "a\n" }],
  [`printf "bad: %s\\n" '${FILE}'; exit 2`, { kind: "exit", status: 2, output: `bad: ${FILE}\n` }],
  ["false", { kind: "exit", status: 1, output: "" }],
])

const commandSteps = (...cmds: string[]): EmitStep[] =>
  cmds.map((command) => ({ kind: "command", command }))

const script = (...cmds: string[]): string => emitScripts(commandSteps(...cmds)).required

for (const makeTier of gitTiers) {
  describe(`emitted scripts [${makeTier().name}]`, () => {
    let t: GitTier
    const run = (text: string) => t.runScript(text, commands)
    const read = (path: string) =>
      t.observe.existsPath(path) ? t.observe.readWorktreeFile(path) : undefined

    beforeEach(() => {
      t = makeTier()
    })

    afterEach(() => {
      t.dispose()
    })

    it("stops at the first failing step, with its status", () => {
      t.seed.writeFile(FILE, "a\n")
      const result = run(script("false", COPY))
      expect(result).toMatchObject({ ok: false, status: 1 })
      expect(read("copy.md")).toBeUndefined()
    })

    describe("failurePromptWrapper", () => {
      it("prints the prompt and the captured output, and exits with the command's status", () => {
        const wrapped = failurePromptWrapper(FAILING, "Fix the file.")
        expect(run(script(wrapped))).toEqual({
          ok: false,
          status: 2,
          output: `Fix the file.\n\nbad: ${FILE}\n`,
        })
      })

      it("is silent when the command passes", () => {
        t.seed.writeFile(FILE, "a\n")
        const wrapped = failurePromptWrapper(COPY, "Fix the file.")
        expect(run(script(wrapped))).toEqual({ ok: true, status: 0, output: "" })
      })
    })

    it("prints an outcome line, looking up the hash and subject it names", () => {
      const head = t.observe.resolveRef("HEAD")
      const outcome = emitScripts([
        { kind: "outcome", command: transitionOutcome("idle", "working") },
        { kind: "outcome", command: abandonedOutcome("working", head, "idle") },
      ]).required
      const result = run(outcome)
      expect(result.ok).toBe(true)
      expect(result.output).toBe(
        "-> idle → working\n" +
          `abandoned the process resting at "working" — HEAD is back at ${head.slice(0, 7)} ("init: first commit"), resting at "idle".\n` +
          "Everything the process produced is kept as uncommitted changes (`git status`); discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.\n",
      )
    })

    it("swallows a failing presentation-only half with a warning", () => {
      const { required, optional } = emitScripts(
        [{ kind: "outcome", command: transitionOutcome("a", "b") }],
        commandSteps("false"),
      )
      expect(run(combinedScript(required, optional))).toEqual({
        ok: true,
        status: 0,
        output: "-> a → b\ngtd: presentation-only follow-up failed — continuing\n",
      })
    })

    describe("gtd check --write", () => {
      it("rewrites a steering file in its canonical form", () => {
        t.seed.writeFile(FILE, "One\nparagraph.\n")
        expect(run(script(`gtd check --write '${FILE}' >/dev/null 2>&1 || :`)).ok).toBe(true)
        expect(read(FILE)).toBe("One paragraph.\n")
      })
    })

    // The hook output carries the marker the emitted case retries on.
    const RETRYABLE = "rejected: empty git commit"

    describe("keepTurn", () => {
      const PREFIX = "refs/gtd/kept/entry/build.naive"
      const MESSAGE =
        "gtd(agent): build.naive → build.next\n\nGtd-Step: build.naive#1\nGtd-Format: 1"
      // As a landing renders it: under `set -eu`, which a failing update-ref relies on to stop.
      const keepTurn = (ref: string, message: string) =>
        ScriptSurface.render([{ kind: "gitWrite", write: { kind: "keepTurn", ref, message } }])
      const git = <A>(f: (g: GitService["Service"]) => Effect.Effect<A, Error>) =>
        t.provide(Effect.flatMap(GitService, f))
      const keptTip = async () => {
        const marker = await git((g) => g.lastCommitMessage())
        return /Gtd-Kept: ([0-9a-f]+)/.exec(marker)?.[1] ?? ""
      }

      it("keeps the turn off the branch: HEAD's tree is the pre-turn tree, the marker carries the kept tip", async () => {
        const before = t.observe.resolveRef("HEAD")
        t.seed.writeFile("naive.txt", "naive\n")
        expect(run(keepTurn(PREFIX, MESSAGE))).toMatchObject({ ok: true })

        expect(read("naive.txt")).toBeUndefined()
        expect(read("readme.txt")).toBe("hello")
        expect(t.observe.statusPorcelain()).toBe("")
        const kept = await keptTip()
        expect(t.observe.resolveRef(`${PREFIX}/${kept}`)).toBe(kept)
        expect(t.observe.resolveRef(`${kept}^`)).toBe(before)
        expect(await git((g) => g.readFileAtRef(kept, "naive.txt"))).toBe("naive\n")
        expect(t.observe.resolveRef("HEAD^")).toBe(before)
        expect(t.observe.headTouchedPaths()).toEqual([])
        const marker = await git((g) => g.lastCommitMessage())
        expect(marker.trim()).toBe(`${MESSAGE}\nGtd-Kept: ${kept}`)
      })

      it("a re-keep files a second ref and leaves the first pass's", async () => {
        t.seed.writeFile("naive.txt", "one\n")
        expect(run(keepTurn(PREFIX, MESSAGE)).ok).toBe(true)
        const first = await keptTip()
        t.seed.writeFile("naive.txt", "two\n")
        expect(run(keepTurn(PREFIX, MESSAGE)).ok).toBe(true)
        const second = await keptTip()
        expect(second).not.toBe(first)
        expect(t.observe.refExists(`${PREFIX}/${first}`)).toBe(true)
        expect(t.observe.refExists(`${PREFIX}/${second}`)).toBe(true)
      })

      it("an unwritable ref exits non-zero with HEAD and the working tree unchanged", () => {
        const head = t.observe.resolveRef("HEAD")
        t.seed.writeFile("naive.txt", "naive\n")
        const result = run(keepTurn("refs/gtd/kept/entry/bad..name", MESSAGE))
        expect(result.ok).toBe(false)
        expect(result.status).not.toBe(0)
        expect(t.observe.resolveRef("HEAD")).toBe(head)
        expect(read("naive.txt")).toBe("naive\n")
      })

      it("a staging hook does not reach the marker: HEAD's tree stays the pre-turn tree", async () => {
        const before = t.observe.resolveRef("HEAD")
        t.seed.stagingHook("readme.txt", "hooked")
        t.seed.writeFile("naive.txt", "naive\n")
        expect(run(keepTurn(PREFIX, MESSAGE))).toMatchObject({ ok: true })

        expect(t.observe.headTouchedPaths()).toEqual([])
        expect(t.observe.resolveRef("HEAD^")).toBe(before)
        expect(read("readme.txt")).toBe("hello")
        expect(t.observe.statusPorcelain()).toBe("")
        const kept = await keptTip()
        expect(t.observe.resolveRef(`${PREFIX}/${kept}`)).toBe(kept)
        expect(t.observe.resolveRef(`${kept}^`)).toBe(before)
        expect(await git((g) => g.readFileAtRef(kept, "readme.txt"))).toBe("hello")
        expect(await git((g) => g.readFileAtRef(kept, "naive.txt"))).toBe("naive\n")
      })

      for (const output of ["rejected", "lint error"]) {
        it(`a rejecting hook ("${output}") does not stop the marker`, async () => {
          const before = t.observe.resolveRef("HEAD")
          t.seed.rejectingHook(output)
          t.seed.writeFile("naive.txt", "naive\n")
          expect(run(keepTurn(PREFIX, MESSAGE))).toMatchObject({ ok: true })

          const kept = await keptTip()
          expect(kept).not.toBe("")
          expect(t.observe.resolveRef(`${PREFIX}/${kept}`)).toBe(kept)
          expect(t.observe.resolveRef("HEAD^")).toBe(before)
          expect(t.observe.headTouchedPaths()).toEqual([])
          expect(t.observe.statusPorcelain()).toBe("")
          expect(await git((g) => g.readFileAtRef(kept, "naive.txt"))).toBe("naive\n")
        })
      }

      it("a failing signer alone puts the turn back in the working tree and drops its kept ref", async () => {
        const head = t.observe.resolveRef("HEAD")
        t.seed.failingSigner()
        t.seed.writeFile("naive.txt", "naive\n")
        const status = t.observe.statusPorcelain()
        const result = run(keepTurn(PREFIX, MESSAGE))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(1)
        expect(result.output).toContain("failed to sign")
        expect(t.observe.statusPorcelain()).toBe(status)
        expect(t.observe.resolveRef("HEAD")).toBe(head)
        expect(read("naive.txt")).toBe("naive\n")
        expect(await git((g) => g.listRefs(`${PREFIX}/`))).toEqual([])
      })
    })

    it("a mkdir + printf write lands one line per token, whatever the token holds", () => {
      const lines = String.raw`mkdir -p .gtd/packages
printf '%s\n' 'a' '' 'it'\''s' '100%' '-x' 'a\b' '.gtd/packages/00-x.md' > '.gtd/packages/00-x.md'`
      expect(run(lines).ok).toBe(true)
      expect(read(".gtd/packages/00-x.md")).toBe(
        "a\n\nit's\n100%\n-x\na\\b\n.gtd/packages/00-x.md\n",
      )
    })

    describe("branch scripts", () => {
      it("switchBranchTo creates the branch at HEAD and moves onto it", () => {
        const head = t.observe.resolveRef("HEAD")
        expect(run(switchBranchTo("gtd/x")).ok).toBe(true)
        expect(t.observe.resolveRef("gtd/x")).toBe(head)
        t.seed.writeFile("a.txt", "a\n")
        expect(run(commitAll("gtd(agent): building")).ok).toBe(true)
        expect(t.observe.resolveRef("gtd/x")).toBe(t.observe.resolveRef("HEAD"))
        expect(t.observe.resolveRef("gtd/x")).not.toBe(head)
      })

      it("switchTo moves onto an existing branch and fails for a missing one", () => {
        expect(run(switchBranchTo("gtd/x")).ok).toBe(true)
        expect(run(switchTo("nope")).ok).toBe(false)
        expect(run(switchBranchTo("gtd/y")).ok).toBe(true)
        expect(run(switchTo("gtd/x")).ok).toBe(true)
      })

      const branch = () =>
        t.provide(Effect.flatMap(GitService, (g) => g.currentBranch())).then(Option.getOrUndefined)

      it("switchBack carries a change to a path both branches agree on", async () => {
        expect(run(switchBranchTo("gtd/x")).ok).toBe(true)
        t.seed.commit("feat: on gtd/x", { "b.txt": "b\n" })
        expect(run(switchBranchTo("x", "HEAD~1")).ok).toBe(true)
        expect(run(switchTo("gtd/x")).ok).toBe(true)
        t.seed.writeFile("a.txt", "changed\n")
        const result = run(switchBack("x"))
        expect(result.ok).toBe(true)
        expect(result.output).toBe("")
        expect(await branch()).toBe("x")
        expect(read("a.txt")).toBe("changed\n")
        expect(read("b.txt")).toBeUndefined()
      })

      it("switchBack stays put, saying so, when a change would be overwritten", async () => {
        expect(run(switchBranchTo("gtd/x")).ok).toBe(true)
        t.seed.commit("feat: on gtd/x", { "b.txt": "b\n" })
        expect(run(switchBranchTo("x", "HEAD~1")).ok).toBe(true)
        expect(run(switchTo("gtd/x")).ok).toBe(true)
        t.seed.writeFile("b.txt", "changed\n")
        const result = run(switchBack("x"))
        expect(result.ok).toBe(true)
        expect(result.output).toContain("pending changes keep HEAD off x")
        expect(await branch()).toBe("gtd/x")
        expect(read("b.txt")).toBe("changed\n")
      })

      it("deleteBranch removes another branch and refuses the checked-out one", () => {
        expect(run(switchBranchTo("gtd/x")).ok).toBe(true)
        expect(run(deleteBranch("gtd/x")).ok).toBe(false)
        expect(run(switchBranchTo("gtd/y")).ok).toBe(true)
        expect(run(deleteBranch("gtd/x")).ok).toBe(true)
        expect(t.observe.refExists("refs/heads/gtd/x")).toBe(false)
      })
    })

    describe("shipCommit", () => {
      const HISTORY = "refs/gtd/history/0123456789012345678901234567890123456789"
      const LANDING = "gtd(check): shipping → after\n\nGtd-Format: 5"
      const git = <A>(f: (g: GitService["Service"]) => Effect.Effect<A, Error>) =>
        t.provide(Effect.flatMap(GitService, f))
      // As a landing renders it: under `set -eu`.
      const ship = (branch: string, parent: string, shipMessage: string) =>
        ScriptSurface.render([
          {
            kind: "gitWrite",
            write: {
              kind: "ship",
              branch,
              parent,
              shipMessage,
              historyRef: HISTORY,
              message: LANDING,
            },
          },
        ])

      it("squashes the staged tree minus .gtd/ onto the branch, then lands naming it", async () => {
        const branch = await git((g) => g.currentBranch())
        const user = Option.getOrElse(branch, () => "main")
        const parent = t.observe.resolveRef("HEAD")
        expect(run(switchBranchTo(`gtd/${user}`)).ok).toBe(true)
        t.seed.writeFile("a.txt", "shipped\n")
        t.seed.writeFile(".gtd/notes.md", "kept back\n")
        const result = run(ship(user, parent, "feat: it's shipped"))
        expect(result.ok).toBe(true)
        const shipped = t.observe.resolveRef(user)
        expect(shipped).not.toBe(parent)
        expect(t.observe.resolveRef(`${shipped}~1`)).toBe(parent)
        expect(await git((g) => g.readFileAtRef(shipped, "a.txt"))).toBe("shipped\n")
        expect(await git((g) => g.diffPaths(parent, shipped))).toEqual(["a.txt"])
        const message = await git((g) => g.lastCommitMessage(shipped))
        expect(message.trim()).toBe("feat: it's shipped")
        expect(await git((g) => g.readRefOption(shippedRef(shipped)))).toEqual(Option.some(parent))
        expect(await git((g) => g.lastCommitMessage("HEAD"))).toContain(`Gtd-Shipped: ${shipped}`)
        expect(t.observe.statusPorcelain()).toBe("")
      })

      it("keeps the .gtd/ files the branch tracks as it has them", async () => {
        const user = Option.getOrElse(await git((g) => g.currentBranch()), () => "main")
        t.seed.commit("chore: track", { ".gtd/keep.md": "tracked\n" })
        const parent = t.observe.resolveRef("HEAD")
        expect(run(switchBranchTo(`gtd/${user}`)).ok).toBe(true)
        t.seed.writeFile("a.txt", "shipped\n")
        t.seed.writeFile(".gtd/keep.md", "process\n")
        expect(run(ship(user, parent, "feat: x")).ok).toBe(true)
        const shipped = t.observe.resolveRef(user)
        expect(await git((g) => g.readFileAtRef(shipped, ".gtd/keep.md"))).toBe("tracked\n")
        expect(await git((g) => g.diffPaths(parent, shipped))).toEqual(["a.txt"])
      })

      it("fails before landing when the branch moved since the decision", () => {
        const head = t.observe.resolveRef("HEAD")
        expect(run(switchBranchTo("gtd/x")).ok).toBe(true)
        expect(run(switchBranchTo("x")).ok).toBe(true)
        t.seed.commit("feat: moved", { "b.txt": "b\n" })
        expect(run(switchTo("gtd/x")).ok).toBe(true)
        t.seed.writeFile("a.txt", "a\n")
        expect(run(ship("x", head, "feat: x")).ok).toBe(false)
        expect(t.observe.resolveRef("HEAD")).toBe(head)
      })
    })

    describe("failRestScript", () => {
      const FAIL_PATH = ".gtd/run-failed.txt"
      const wrapped = (body: string) => failRestScript(body, FAIL_PATH)

      it("records the status and output, without the output's trailing newline, and succeeds", () => {
        expect(run(wrapped(FAILING)).ok).toBe(true)
        expect(read(FAIL_PATH)).toBe(`exit 2\nbad: ${FILE}\n`)
      })

      it("leaves no record when the body passes, and clears an earlier one", () => {
        t.seed.writeFile(FAIL_PATH, "exit 1\nold\n")
        t.seed.writeFile(FILE, "a\n")
        expect(run(wrapped(COPY)).ok).toBe(true)
        expect(read(FAIL_PATH)).toBeUndefined()
      })
    })

    describe("commitAll", () => {
      it("a staging hook's edit lands in the commit", () => {
        t.seed.stagingHook("readme.txt", "hooked")
        t.seed.writeFile("a.txt", "a\n")
        expect(run(commitAll("gtd(agent): building")).ok).toBe(true)
        expect(t.observe.headTouchedPaths().toSorted()).toEqual(["a.txt", "readme.txt"])
        expect(read("readme.txt")).toBe("hooked")
      })

      it("hook output with shell metacharacters reaches stderr verbatim", () => {
        const output = "bad $HOME $(echo x) `id`"
        t.seed.rejectingHook(output)
        t.seed.writeFile("a.txt", "a\n")
        const result = run(commitAll("gtd(agent): building"))
        expect(result.ok).toBe(false)
        expect(result.output).toContain(output)
      })

      it("fails with status 1 and HEAD unchanged when the commit cannot be written even without hooks", () => {
        const head = t.observe.resolveRef("HEAD")
        t.seed.rejectingHook(RETRYABLE)
        t.seed.failingSigner()
        t.seed.writeFile("a.txt", "a\n")
        const result = run(commitAll("gtd(agent): building"))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(1)
        expect(result.output).toContain("failed to sign")
        expect(t.observe.resolveRef("HEAD")).toBe(head)
      })

      it("fails with status 1 when only the signer fails, no hook having triggered the retry", () => {
        const head = t.observe.resolveRef("HEAD")
        t.seed.failingSigner()
        t.seed.writeFile("a.txt", "a\n")
        const result = run(commitAll("gtd(agent): building"))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(1)
        expect(result.output).toContain("failed to sign")
        expect(t.observe.resolveRef("HEAD")).toBe(head)
      })
    })

    describe("commitAsIs", () => {
      it("a non-retryable hook rejection fails with status 1 and leaves HEAD and the index unchanged", () => {
        const head = t.observe.resolveRef("HEAD")
        t.seed.writeFile("a.txt", "a\n")
        t.seed.stageAll()
        t.seed.rejectingHook("rejected")
        const staged = t.observe.statusPorcelain()
        const result = run(commitAsIs("gtd(agent): as-is"))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(1)
        expect(result.output).toContain("rejected")
        expect(t.observe.resolveRef("HEAD")).toBe(head)
        expect(t.observe.statusPorcelain()).toBe(staged)
      })

      it("a failing signer with no hook fails with status 1 and leaves HEAD unchanged", () => {
        const head = t.observe.resolveRef("HEAD")
        t.seed.writeFile("a.txt", "a\n")
        t.seed.stageAll()
        t.seed.failingSigner()
        const result = run(commitAsIs("gtd(agent): as-is"))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(1)
        expect(result.output).toContain("failed to sign")
        expect(t.observe.resolveRef("HEAD")).toBe(head)
      })
    })
  })
}
