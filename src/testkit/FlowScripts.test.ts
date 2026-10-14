import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkScript,
  moveScript,
  removeScript,
  restoreScript,
  revertScript,
  showScript,
} from "../flows/index.js"
import { gitTiers, type GitTier, type ScriptedCommand } from "./index.js"

// Every case runs through real `sh` and through `applyFlowScript`. A check's
// command is declared for the in-memory twin, and Live runs it for real — a
// declaration that lies about the command fails here, not in a scenario.
const FAILING_WITH_OUTPUT = "printf 'boom\\n'; exit 3"
const FAILING_SILENTLY = "exit 4"
const PASSING = "true"
const WRITING = "printf 'x\\n' > out.txt"

const commands = new Map<string, ScriptedCommand>([
  [FAILING_WITH_OUTPUT, { kind: "exit", status: 3, output: "boom\n" }],
  [FAILING_SILENTLY, { kind: "exit", status: 4, output: "" }],
  [PASSING, { kind: "exit", status: 0, output: "" }],
  [WRITING, { kind: "rewrite", file: "out.txt", content: "x\n" }],
])

const REPORT = ".gtd/FEEDBACK.md"

for (const makeTier of gitTiers) {
  describe(`flows scripts [${makeTier().name}]`, () => {
    let t: GitTier
    const run = (script: string) => t.runScript(script, commands)
    const read = (path: string) =>
      t.observe.existsPath(path) ? t.observe.readWorktreeFile(path) : undefined

    beforeEach(() => {
      t = makeTier()
    })

    afterEach(() => {
      t.dispose()
    })

    describe("removeScript", () => {
      it("removes files and whole directories, and tolerates absent paths", () => {
        t.seed.writeFile("out/a.txt", "a")
        t.seed.writeFile("out/deep/b.txt", "b")
        t.seed.writeFile("c.txt", "c")
        t.seed.writeFile("keep.txt", "k")
        expect(run(removeScript(["out", "c.txt", "missing.txt"])).ok).toBe(true)
        expect(read("out/a.txt")).toBeUndefined()
        expect(read("out/deep/b.txt")).toBeUndefined()
        expect(read("c.txt")).toBeUndefined()
        expect(read("keep.txt")).toBe("k")
      })
    })

    describe("moveScript", () => {
      it("moves a file, creating the target directory", () => {
        t.seed.writeFile("a.txt", "a")
        expect(run(moveScript("a.txt", "deep/dir/b.txt")).ok).toBe(true)
        expect(read("a.txt")).toBeUndefined()
        expect(read("deep/dir/b.txt")).toBe("a")
      })

      it("fails on an absent source", () => {
        expect(run(moveScript("missing.txt", "b.txt")).ok).toBe(false)
      })
    })

    describe("showScript", () => {
      it("writes the committed blob, not the working copy", () => {
        t.seed.commit("feat: notes", { "notes.md": "committed" })
        const head = t.observe.resolveRef("HEAD")
        t.seed.writeFile("notes.md", "edited")
        expect(run(showScript(head, "notes.md", "notes.orig.md")).ok).toBe(true)
        expect(read("notes.orig.md")).toBe("committed")
      })
    })

    describe("restoreScript", () => {
      it("restores and removes only the paths still exactly as the commit left them", () => {
        t.seed.commit("feat: base", { "a.txt": "a0", "b.txt": "b0" })
        t.seed.commit("feat: edit", {
          "a.txt": "a1",
          "b.txt": "b1",
          "new.txt": "n1",
          "new-edited.txt": "e1",
        })
        const commit = t.observe.resolveRef("HEAD")
        t.seed.writeFile("b.txt", "b2")
        t.seed.writeFile("new-edited.txt", "e2")
        const script = restoreScript(commit, {
          restore: ["a.txt", "b.txt"],
          remove: ["new.txt", "new-edited.txt"],
        })
        // `sh` exits with the last line's status, and new-edited.txt was left alone.
        expect(run(script).ok).toBe(false)
        expect(read("a.txt")).toBe("a0")
        expect(read("b.txt")).toBe("b2")
        expect(read("new.txt")).toBeUndefined()
        expect(read("new-edited.txt")).toBe("e2")
      })

      it("restores from the given source, deleting a path the source lacks", () => {
        const first = t.observe.resolveRef("HEAD")
        t.seed.commit("feat: a", { "a.txt": "a1" })
        t.seed.commit("feat: a again", { "a.txt": "a2" })
        const commit = t.observe.resolveRef("HEAD")
        expect(run(restoreScript(commit, { restore: ["a.txt"], remove: [] }, first)).ok).toBe(true)
        expect(read("a.txt")).toBeUndefined()
      })

      it("leaves a deleted path alone", () => {
        t.seed.commit("feat: base", { "a.txt": "a0" })
        t.seed.commit("feat: edit", { "a.txt": "a1" })
        const commit = t.observe.resolveRef("HEAD")
        t.seed.deleteFile("a.txt")
        expect(run(restoreScript(commit, { restore: ["a.txt"], remove: [] })).ok).toBe(false)
        expect(read("a.txt")).toBeUndefined()
      })
    })

    describe("revertScript", () => {
      it("reverses a commit's modifications, additions and deletions in the working tree", () => {
        t.seed.commit("feat: base", { "mod.txt": "before", "gone.txt": "g" })
        t.seed.commit("feat: change", { "mod.txt": "after", "added.txt": "new" })
        t.seed.commitDeletion("gone.txt", "feat: delete")
        t.seed.commit("feat: squash", { "mod.txt": "after2" })
        const commit = t.observe.resolveRef("HEAD")
        expect(run(revertScript(commit, REPORT, "could not revert")).ok).toBe(true)
        expect(read("mod.txt")).toBe("after")
        expect(read(REPORT)).toBeUndefined()
        expect(t.observe.resolveRef("HEAD")).toBe(commit)
      })

      it("reverses an addition and a deletion", () => {
        t.seed.commit("feat: base", { "gone.txt": "g" })
        t.seed.writeFile("added.txt", "new")
        t.seed.deleteFile("gone.txt")
        t.seed.stageAll()
        t.seed.commit("feat: swap", {})
        const commit = t.observe.resolveRef("HEAD")
        expect(run(revertScript(commit, REPORT, "could not revert")).ok).toBe(true)
        expect(read("added.txt")).toBeUndefined()
        expect(read("gone.txt")).toBe("g")
      })

      it("does nothing for a commit with nothing to undo", () => {
        t.seed.commit("feat: empty", {})
        const commit = t.observe.resolveRef("HEAD")
        expect(run(revertScript(commit, REPORT, "could not revert")).ok).toBe(true)
        expect(read(REPORT)).toBeUndefined()
        expect(t.observe.statusPorcelain()).toBe("")
      })

      it("reports a revert that cannot apply, leaving the tree untouched", () => {
        t.seed.commit("feat: base", { "a.txt": "a0" })
        t.seed.commit("feat: change", { "a.txt": "a1", "b.txt": "b1" })
        const commit = t.observe.resolveRef("HEAD")
        t.seed.deleteFile("b.txt")
        expect(run(revertScript(commit, REPORT, "could not revert")).ok).toBe(true)
        expect(read(REPORT)).toMatch(/^could not revert\n\n\S/)
        expect(read("a.txt")).toBe("a1")
      })
    })

    describe("checkScript", () => {
      const options = { report: REPORT, stamp: "abc1234" }

      it("keeps a failing command's output in the report, stamped", () => {
        expect(run(checkScript(FAILING_WITH_OUTPUT, options)).ok).toBe(true)
        expect(read(REPORT)).toBe("boom\n\n<!-- gtd check abc1234 -->\n")
        expect(read(`${REPORT}.output`)).toBeUndefined()
      })

      it("says so when a failing command printed nothing", () => {
        run(checkScript(FAILING_SILENTLY, options))
        expect(read(REPORT)).toBe(
          "the test command failed with exit code 4 and produced no output.\n<!-- gtd check abc1234 -->\n",
        )
      })

      it("removes the report and sweeps on green", () => {
        t.seed.writeFile(REPORT, "old")
        t.seed.writeFile("stale/a.txt", "a")
        run(checkScript(PASSING, { ...options, sweepOnGreen: ["stale"] }))
        expect(read(REPORT)).toBeUndefined()
        expect(read("stale/a.txt")).toBeUndefined()
      })

      it("keeps what a passing command wrote", () => {
        run(checkScript(WRITING, options))
        expect(read("out.txt")).toBe("x\n")
      })

      it("sweeps before the command, and not on red", () => {
        t.seed.writeFile("before.txt", "b")
        t.seed.writeFile("green.txt", "g")
        run(
          checkScript(FAILING_SILENTLY, {
            ...options,
            sweep: ["before.txt"],
            sweepOnGreen: ["green.txt"],
          }),
        )
        expect(read("before.txt")).toBeUndefined()
        expect(read("green.txt")).toBe("g")
      })

      it("runs the preamble first; its exit 0 skips the command and leaves the report", () => {
        t.seed.writeFile(REPORT, "old")
        t.seed.writeFile("drop.txt", "d")
        const preamble = [
          "mkdir -p '.gtd'",
          "printf '%s\\n' 'set it\nup' > '.gtd/SETUP.md'",
          "printf '%s\\n' 'set it up' >&2",
          "rm -f 'drop.txt'",
          "exit 0",
        ]
        const result = run(checkScript(FAILING_WITH_OUTPUT, { ...options, preamble }))
        expect(result.output).toBe("set it up\n")
        expect(read(".gtd/SETUP.md")).toBe("set it\nup\n")
        expect(read("drop.txt")).toBeUndefined()
        expect(read(REPORT)).toBe("old")
      })
    })
  })
}
