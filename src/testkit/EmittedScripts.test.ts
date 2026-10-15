import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  abandonedOutcome,
  binaryGuard,
  combinedScript,
  commitAll,
  commitAsIs,
  emitScripts,
  failurePromptWrapper,
  fileExistsGuard,
  modeContradictionSkipNotice,
  transitionOutcome,
  withFileVar,
  type EmitStep,
} from "../emit/index.js"
import { Effect } from "effect"
import { ScriptSurface } from "../emit/index.js"
import { GitService } from "../platform/index.js"
import { gitTiers, type GitTier, type ScriptedCommand } from "./index.js"

// Every case runs through real `sh` — with this build's `gtd` on PATH — and
// through `applyEmittedScript`. A command a case runs is declared for the
// in-memory twin; Live runs it for real, so a declaration that lies fails here.
const FILE = ".gtd/a.md"
const COPY = 'cp "$GTD_FILE" copy.md'
const FAILING = 'printf "bad: %s\\n" "$GTD_FILE"; exit 2'
const MISSING = "gtd-test-no-such-binary"

const commands = new Map<string, ScriptedCommand>([
  [`cp '${FILE}' copy.md`, { kind: "rewrite", file: "copy.md", content: "a\n" }],
  [`printf "bad: %s\\n" '${FILE}'; exit 2`, { kind: "exit", status: 2, output: `bad: ${FILE}\n` }],
  ["false", { kind: "exit", status: 1, output: "" }],
  [MISSING, { kind: "missing" }],
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

    describe("fileExistsGuard", () => {
      it("ends the script successfully when the file is absent", () => {
        expect(run(script(fileExistsGuard(FILE), withFileVar(COPY, FILE)))).toMatchObject({
          ok: true,
        })
        expect(read("copy.md")).toBeUndefined()
      })

      it("runs on, with $GTD_FILE naming the file, when it is present", () => {
        t.seed.writeFile(FILE, "a\n")
        expect(run(script(fileExistsGuard(FILE), withFileVar(COPY, FILE))).ok).toBe(true)
        expect(read("copy.md")).toBe("a\n")
      })
    })

    it("stops at the first failing step, with its status", () => {
      t.seed.writeFile(FILE, "a\n")
      const result = run(script("false", withFileVar(COPY, FILE)))
      expect(result).toMatchObject({ ok: false, status: 1 })
      expect(read("copy.md")).toBeUndefined()
    })

    describe("failurePromptWrapper", () => {
      it("prints the prompt and the captured output, and exits with the command's status", () => {
        const wrapped = failurePromptWrapper(withFileVar(FAILING, FILE), "Fix the file.")
        expect(run(script(wrapped))).toEqual({
          ok: false,
          status: 2,
          output: `Fix the file.\n\nbad: ${FILE}\n`,
        })
      })

      it("is silent when the command passes", () => {
        t.seed.writeFile(FILE, "a\n")
        const wrapped = failurePromptWrapper(withFileVar(COPY, FILE), "Fix the file.")
        expect(run(script(wrapped))).toEqual({ ok: true, status: 0, output: "" })
      })
    })

    describe("binaryGuard", () => {
      it("passes a binary on PATH", () => {
        expect(run(script(binaryGuard("sh", "adr", "validate"))).ok).toBe(true)
      })

      it("names a missing binary and exits 127", () => {
        const result = run(script(binaryGuard(MISSING, "adr", "validate")))
        expect(result).toMatchObject({ ok: false, status: 127 })
        expect(result.output).toMatch(
          new RegExp(`^gtd: mode "adr": "validate" command not found: ${MISSING}\\n\\$PATH: `),
        )
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

    it("prints the contradiction-check skip notice", () => {
      expect(run(script(modeContradictionSkipNotice("adr"))).output).toBe(
        'gtd: mode "adr" has an external validate: command — skipping the format/validate contradiction check\n',
      )
    })

    describe("gtd check", () => {
      it("passes a valid file, and an absent one", () => {
        expect(run(script(`gtd check qa '${FILE}'`)).ok).toBe(true)
        t.seed.writeFile(FILE, "## Open Questions\n")
        expect(run(script(`gtd check qa '${FILE}'`))).toEqual({ ok: true, status: 0, output: "" })
      })

      it("prints each finding and fails", () => {
        t.seed.writeFile(FILE, "## Open Questions\n\n### \n")
        const result = run(script(`gtd check qa '${FILE}'`))
        expect(result).toMatchObject({ ok: false, status: 1 })
        expect(result.output).toMatch(
          new RegExp(
            `^gtd check: ${FILE} is not valid under mode "qa" \\(1 finding\\(s\\)\\):\\n${FILE}:3:1: `,
          ),
        )
      })
    })

    it("gtd uncheck clears a review file's ticks", () => {
      const review = ".gtd/REVIEW.md"
      t.seed.writeFile(
        review,
        "# Review: abc1234\n\n## calc\n- [x] ./src/calc.ts#1-1\nnew add function\n",
      )
      expect(run(script(`gtd uncheck '${review}'`)).ok).toBe(true)
      expect(read(review)).toContain("- [ ] ./src/calc.ts#1-1")
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
      const git = <A>(f: (g: GitService["Type"]) => Effect.Effect<A, Error>) =>
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
