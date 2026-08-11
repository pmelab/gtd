import { rmSync } from "node:fs"
import { execSync, execFileSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService } from "./Git.js"
import { Cwd } from "./Cwd.js"
import { currentRun, reviewBaseFor, type ProcessRun } from "./Edge.js"
import {
  buildCloseWindowScript,
  buildOpenWindowScript,
  decideCloseWindow,
  decideOpenWindow,
  LEGACY_REVIEW_BASE_REF,
  LEGACY_REVIEW_HEAD_REF,
  REVIEW_BASE_REF,
  REVIEW_HEAD_REF,
  type WindowRefs,
} from "./ReviewWindow.js"
import { deleteRef, mixedResetTo, restoreStagedFrom, updateRef } from "./GitScript.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import { gitTiers, type GitTier } from "./testing/GitTiers.js"

// git's empty-tree object, mirrored from `src/ReviewWindow.ts`'s own private
// constant — a pure-decision test needs to name it without reaching into the
// module's internals.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** Only the Live tier has a real filesystem/shell to run a generated script against. */
const makeLiveTier = (): GitTier => {
  const make = gitTiers.find((candidate) => {
    const probe = candidate()
    const isLive = probe.name === "Live"
    probe.dispose()
    return isLive
  })
  if (make === undefined) throw new Error("no Live GitTier available")
  return make()
}

/**
 * Runs a generated script through a REAL shell against `t.root` — the same
 * execution model the eventual driver uses (`bash -c <script>`), mirroring
 * `src/testing/GitTiers.ts`'s own (unexported) `execScript` helper for its
 * `runGitScriptContract`.
 */
const execScript = (t: GitTier, script: string): void => {
  execFileSync("bash", ["-c", script], { cwd: t.root, stdio: "pipe" })
}

/**
 * The review checkout window, parameterized over both `GitOperations` tiers
 * (`src/testing/GitTiers.ts`) for its DECIDE-only coverage
 * (`decideCloseWindow`/`decideOpenWindow`, both read-only through
 * `GitService` — no write). The git contract (package/step 4) covers every
 * reader primitive a decision uses (`isAncestor`, `readRefOption`), so a
 * no-op/refusal decision is exercised identically on Live and InMemory.
 *
 * The actual WRITE — the mixed-reset open/close round trip, `reviewBase`
 * base-narrowing observed after a real open, legacy-ref cleanup, idempotent
 * re-entry — only makes sense against a real shell running the emitted bash
 * (an in-memory fake root has no shell to run it against), so it lives in its
 * own Live-only describe block below (`the emitted open/close scripts`),
 * mirroring `runGitScriptContract`'s own scoping in `src/testing/GitTiers.ts`.
 * The linked-worktree group (`git worktree add` — `t.capabilities.
 * linkedWorktrees`) stays nested inside this parametrized loop, but is itself
 * Live-only via that capability's own skip.
 */

// A workflow: idle → building → gate (a reviewWindow rest), with an optional
// `checkpoint` reviewBase state between two building turns.
const def: WorkflowDefinition = {
  states: {
    idle: { actor: "human", message: "i", on: [["* **", "building"]] },
    building: { actor: "agent", prompt: "b", on: [["* **", "gate"]] },
    checkpoint: { actor: "human", message: "c", reviewBase: true, on: [["* **", "gate"]] },
    gate: { actor: "human", message: "g", reviewWindow: true, on: [["* **", "idle"]] },
  },
  entries: { default: "idle", manual: [] },
}

const headSubject = (t: GitTier): Promise<string> =>
  t.provide(
    Effect.flatMap(GitService, (g) => g.lastCommitSubject()),
    def,
  )

for (const makeTier of gitTiers) {
  const probe = makeTier()
  const { name, capabilities } = probe
  probe.dispose()

  describe(`ReviewWindow [${name}]`, () => {
    let t: GitTier

    beforeEach(() => {
      t = makeTier()
    })

    afterEach(() => {
      t.dispose()
    })

    describe("decideOpenWindow via the edge — read-only", () => {
      it("declines to open while resting anywhere but a reviewWindow state", async () => {
        t.seed.commit("gtd(agent): building", { "src/calc.ts": "x\n" })
        const run = await t.provide(currentRun, def)
        const decision = decideOpenWindow(def, "building", run, t.observe.resolveRef("HEAD"))
        expect(decision).toEqual({ shouldOpen: false })
      })
    })

    describe("decideCloseWindow — safety", () => {
      it("is a no-op when no window is open", async () => {
        const decision = await t.provide(decideCloseWindow, def)
        expect(decision).toEqual({ shouldClose: false })
      })
    })

    describe.skipIf(!capabilities.linkedWorktrees)(
      "linked worktrees — per-worktree window refs (issue #118)",
      () => {
        const gitIn = (dir: string, ...args: string[]): string =>
          execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim()

        let siblingDir: string | undefined

        const addSiblingWorktree = (base: string): string => {
          siblingDir = `${t.root}-sibling`
          gitIn(t.root, "worktree", "add", "-q", "-b", "sibling", siblingDir, base)
          gitIn(siblingDir, "commit", "--allow-empty", "-m", '"feat: sibling work"')
          return siblingDir
        }

        afterEach(() => {
          if (siblingDir !== undefined) rmSync(siblingDir, { recursive: true, force: true })
          siblingDir = undefined
        })

        it("keeps a sibling worktree out of another worktree's open window", async () => {
          const base = t.observe.resolveRef("HEAD")
          t.seed.commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
          t.seed.commit("gtd(human): gate", {})
          const sibling = addSiblingWorktree(base)
          const siblingHead = gitIn(sibling, "rev-parse", "HEAD")

          const openDecision = decideOpenWindow(
            def,
            "gate",
            await t.provide(currentRun, def),
            t.observe.resolveRef("HEAD"),
          )
          if (!openDecision.shouldOpen) throw new Error("expected the window to open")
          execScript(t, buildOpenWindowScript(openDecision))
          // The window's refs live in the per-worktree namespace, so the
          // sibling sharing this `.git` cannot even see them…
          expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(true)
          expect(() =>
            gitIn(sibling, "rev-parse", "--verify", "--quiet", REVIEW_HEAD_REF),
          ).toThrow()

          // …and its own gtd invocations decide to close nothing: pre-7.2
          // this reset the sibling's branch onto THIS worktree's saved head.
          const siblingDecision = await decideCloseWindowInDir(sibling)
          expect(siblingDecision.shouldClose).toBe(false)
          expect(gitIn(sibling, "rev-parse", "HEAD")).toBe(siblingHead)

          // This worktree's window survived the sibling's invocation untouched.
          expect(await headSubject(t)).toBe("init: first commit")
          expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(true)

          const closeDecision = await t.provide(decideCloseWindow, def)
          if (!closeDecision.shouldClose) throw new Error("expected an open window to close")
          execScript(t, buildCloseWindowScript(closeDecision.refs))
          expect(await headSubject(t)).toBe("gtd(human): gate")
        })

        it("refuses a shared-ref window that belongs to another worktree, leaving the branch alone", async () => {
          const base = t.observe.resolveRef("HEAD")
          t.seed.commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
          t.seed.commit("gtd(human): gate", {})
          const realHead = t.observe.resolveRef("HEAD")
          const sibling = addSiblingWorktree(base)
          const siblingHead = gitIn(sibling, "rev-parse", "HEAD")
          t.seed.updateRef(LEGACY_REVIEW_BASE_REF, base)
          t.seed.updateRef(LEGACY_REVIEW_HEAD_REF, realHead)
          t.seed.mixedReset(base)

          await expect(decideCloseWindowInDir(sibling)).rejects.toThrow(
            /does not belong to this worktree/,
          )
          // Nothing moved, nothing was deleted — the owning worktree can
          // still recover with the commands the message spells out.
          expect(gitIn(sibling, "rev-parse", "HEAD")).toBe(siblingHead)
          expect(t.observe.refExists(LEGACY_REVIEW_HEAD_REF)).toBe(true)
          expect(t.observe.refExists(LEGACY_REVIEW_BASE_REF)).toBe(true)
        })

        // `decideCloseWindow` run against an arbitrary directory (the sibling
        // worktree) rather than `t`'s own root — only meaningful for the Live
        // tier, where a directory maps onto a real, independently-`cwd`-able
        // git worktree, so this bypasses `GitTier.provide` (fixed to `t.root`)
        // and wires `GitService.Live` directly, mirroring the pre-tiered
        // test's own `runIn` helper. `decideCloseWindow` needs only
        // `GitService`, unlike `decideOpenWindow` (a plain pure function) —
        // no `ConfigService` layer.
        function decideCloseWindowInDir(dir: string) {
          return Effect.runPromise(
            decideCloseWindow.pipe(
              Effect.provide(GitService.Live),
              Effect.provide(Cwd.layer(dir)),
              Effect.provide(NodeContext.layer),
            ),
          )
        }
      },
    )
  })
}

/**
 * The pure decision/builder half of the window: a decision — "should a
 * window open/close, and with what" — and a script builder. No git, no
 * `Effect` — plain functions of their arguments (`buildCloseWindowScript`/
 * `buildOpenWindowScript` take the already-decided values and never resolve
 * anything themselves).
 */
describe("buildCloseWindowScript / buildOpenWindowScript — pure builders", () => {
  it("buildCloseWindowScript emits the mixed-reset (to the resolved head HASH) then the two ref deletes, in order", () => {
    const refs: WindowRefs = {
      headRef: REVIEW_HEAD_REF,
      baseRef: REVIEW_BASE_REF,
      headHash: "deadbeef",
      legacy: false,
    }
    expect(buildCloseWindowScript(refs)).toBe(
      [mixedResetTo("deadbeef"), deleteRef(REVIEW_HEAD_REF), deleteRef(REVIEW_BASE_REF)].join(
        " &&\n",
      ),
    )
  })

  it("buildCloseWindowScript names the legacy refs when handed a legacy WindowRefs", () => {
    const refs: WindowRefs = {
      headRef: LEGACY_REVIEW_HEAD_REF,
      baseRef: LEGACY_REVIEW_BASE_REF,
      headHash: "deadbeef",
      legacy: true,
    }
    expect(buildCloseWindowScript(refs)).toBe(
      [
        mixedResetTo("deadbeef"),
        deleteRef(LEGACY_REVIEW_HEAD_REF),
        deleteRef(LEGACY_REVIEW_BASE_REF),
      ].join(" &&\n"),
    )
  })

  it("buildCloseWindowScript resets to the hash, not the ref name — the reset survives even after the ref is gone", () => {
    // If the reset targeted the ref by NAME, re-running the emitted script
    // after the ref delete below would fail outright ("unknown revision").
    // Targeting the resolved hash keeps the sequence idempotent on re-entry.
    const refs: WindowRefs = {
      headRef: REVIEW_HEAD_REF,
      baseRef: REVIEW_BASE_REF,
      headHash: "cafef00d",
      legacy: false,
    }
    expect(buildCloseWindowScript(refs)).toContain(mixedResetTo("cafef00d"))
    expect(buildCloseWindowScript(refs)).not.toContain(mixedResetTo(REVIEW_HEAD_REF))
  })

  it("buildOpenWindowScript emits base-ref, head-ref, mixed-reset, then the .gtd/ pin, in order", () => {
    expect(buildOpenWindowScript({ base: "baseHash", head: "headHash" })).toBe(
      [
        updateRef(REVIEW_BASE_REF, "baseHash"),
        updateRef(REVIEW_HEAD_REF, "headHash"),
        mixedResetTo("baseHash"),
        restoreStagedFrom(REVIEW_HEAD_REF, [".gtd"]),
      ].join(" &&\n"),
    )
  })

  it("neither emitted sequence contains a whole-tree index write or an intent-to-add stage", () => {
    const closeScript = buildCloseWindowScript({
      headRef: REVIEW_HEAD_REF,
      baseRef: REVIEW_BASE_REF,
      headHash: "deadbeef",
      legacy: false,
    })
    const openScript = buildOpenWindowScript({ base: "baseHash", head: "headHash" })
    for (const script of [closeScript, openScript]) {
      expect(script).not.toMatch(/git add (-A|--all|\.)\b/)
      expect(script).not.toContain("intent-to-add")
    }
  })
})

describe("decideOpenWindow — answerable for a target state the caller names", () => {
  const emptyRun: ProcessRun = {
    startHash: "startHash",
    startParentHash: "startParentHash",
    diffBase: "startParentHash",
    trace: [],
    costEntries: [],
    entryVars: {},
    headTurn: undefined,
  }

  it("declines when the target state doesn't declare reviewWindow", () => {
    expect(decideOpenWindow(def, "building", emptyRun, "prospectiveHead")).toEqual({
      shouldOpen: false,
    })
  })

  it("declines when the base is the empty tree (a whole-history process)", () => {
    const run: ProcessRun = { ...emptyRun, startParentHash: EMPTY_TREE, diffBase: EMPTY_TREE }
    expect(decideOpenWindow(def, "gate", run, "prospectiveHead")).toEqual({ shouldOpen: false })
  })

  it("declines when the base equals the prospective head (an empty process)", () => {
    const run: ProcessRun = { ...emptyRun, startParentHash: "sameHash", diffBase: "sameHash" }
    expect(decideOpenWindow(def, "gate", run, "sameHash")).toEqual({ shouldOpen: false })
  })

  it("opens against the process's diff base when no reviewBase state is in the trace", () => {
    expect(decideOpenWindow(def, "gate", emptyRun, "prospectiveHead")).toEqual({
      shouldOpen: true,
      base: "startParentHash",
      head: "prospectiveHead",
    })
  })

  it("is answerable for an arbitrary target the caller names, independent of any currently-resolved rest", () => {
    // The trace records a `checkpoint` (reviewBase) turn after `building` —
    // `reviewBaseFor` narrows to it. The caller asks about `gate` directly,
    // as the state a step is about to land ON per the matched pattern —
    // nothing here reads HEAD's subject or resolves a "current" rest at all.
    const run: ProcessRun = {
      ...emptyRun,
      trace: [
        { state: "building", hash: "buildingHash" },
        { state: "checkpoint", hash: "checkpointHash" },
      ],
    }
    expect(decideOpenWindow(def, "gate", run, "prospectiveHead")).toEqual({
      shouldOpen: true,
      base: "checkpointHash",
      head: "prospectiveHead",
    })
  })
})

/**
 * The window's actual WRITE effect: real bash, real git (Live tier only — an
 * in-memory fake root has no shell to run a script against, mirroring
 * `runGitScriptContract`'s own scoping in `src/testing/GitTiers.ts`). Every
 * scenario here decides with `decideCloseWindow`/`decideOpenWindow`, builds
 * the bash with `buildCloseWindowScript`/`buildOpenWindowScript`, and executes
 * it exactly as the external driver would (`execScript`, `bash -c <script>`),
 * then asserts on the resulting repository state directly — there is no more
 * separate performer Effect to compare the emitted script against; the
 * emitted script is the only path left that writes anything.
 */
describe("the emitted open/close scripts — real bash, real git", () => {
  const seedWindowFixture = (t: GitTier): void => {
    t.seed.commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
    t.seed.commit("gtd(human): gate", { "src/other.ts": "export const x = 1\n" })
  }

  /** Decide + build + execute the open sequence against `target` (default `"gate"`, the fixture's own reviewWindow state). */
  const openWindow = async (t: GitTier, target = "gate"): Promise<void> => {
    const run = await t.provide(currentRun, def)
    const head = t.observe.resolveRef("HEAD")
    const decision = decideOpenWindow(def, target, run, head)
    if (!decision.shouldOpen) throw new Error("expected the window to open")
    execScript(t, buildOpenWindowScript(decision))
  }

  /** Decide + build + execute the close sequence, returning the resolved refs. */
  const closeWindow = async (t: GitTier): Promise<WindowRefs> => {
    const decision = await t.provide(decideCloseWindow, def)
    if (!decision.shouldClose) throw new Error("expected an open window to close")
    execScript(t, buildCloseWindowScript(decision.refs))
    return decision.refs
  }

  it("base = process start: rewinds HEAD to the process boundary, surfaces the diff, and restores on close", async () => {
    const t = makeLiveTier()
    try {
      seedWindowFixture(t)
      const realHead = t.observe.resolveRef("HEAD")

      await openWindow(t)
      // HEAD rewound to the process boundary (the non-gtd initial commit).
      expect(await headSubject(t)).toBe("init: first commit")
      expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(true)
      expect(t.observe.refExists(REVIEW_BASE_REF)).toBe(true)
      // The whole process diff is now uncommitted.
      expect(t.observe.statusPorcelain()).toContain("src/calc.ts")
      expect(t.observe.statusPorcelain()).toContain("src/other.ts")

      await closeWindow(t)
      expect(t.observe.resolveRef("HEAD")).toBe(realHead)
      expect(await headSubject(t)).toBe("gtd(human): gate")
      expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(false)
      expect(t.observe.refExists(REVIEW_BASE_REF)).toBe(false)
      // The working tree is clean again — the surfaced diff was re-committed.
      expect(t.observe.statusPorcelain()).toBe("")
    } finally {
      t.dispose()
    }
  })

  it("reviewBase narrows the diff base to the most-recent in-process reviewBase commit", async () => {
    const t = makeLiveTier()
    try {
      t.seed.commit("gtd(agent): building", { "src/a.ts": "a\n" })
      t.seed.commit("gtd(human): checkpoint", {})
      const checkpoint = t.observe.resolveRef("HEAD")
      t.seed.commit("gtd(agent): building", { "src/b.ts": "b\n" })
      t.seed.commit("gtd(human): gate", {})

      const base = await t.provide(
        Effect.gen(function* () {
          const run = yield* currentRun
          return reviewBaseFor(def, run)
        }),
        def,
      )
      expect(base).toBe(checkpoint)

      await openWindow(t)
      // HEAD rewound to the checkpoint, so only work AFTER it surfaces.
      expect(await headSubject(t)).toBe("gtd(human): checkpoint")
      expect(t.observe.statusPorcelain()).toContain("src/b.ts")
      expect(t.observe.statusPorcelain()).not.toContain("src/a.ts")
    } finally {
      t.dispose()
    }
  })

  it("legacy shared refs (gtd ≤ 7.1): finishes a window left behind by an older gtd in this worktree", async () => {
    const t = makeLiveTier()
    try {
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
      t.seed.commit("gtd(human): gate", {})
      const realHead = t.observe.resolveRef("HEAD")
      t.seed.updateRef(LEGACY_REVIEW_BASE_REF, base)
      t.seed.updateRef(LEGACY_REVIEW_HEAD_REF, realHead)
      t.seed.mixedReset(base)

      const decision = await t.provide(decideCloseWindow, def)
      if (!decision.shouldClose) throw new Error("expected the legacy window to be recognized")
      execScript(t, buildCloseWindowScript(decision.refs))

      expect(t.observe.resolveRef("HEAD")).toBe(realHead)
      expect(t.observe.refExists(LEGACY_REVIEW_HEAD_REF)).toBe(false)
      expect(t.observe.refExists(LEGACY_REVIEW_BASE_REF)).toBe(false)
      expect(t.observe.statusPorcelain()).toBe("")
    } finally {
      t.dispose()
    }
  })

  describe("idempotency — running the emitted script a second time changes nothing", () => {
    it("close: the second run is a no-op", async () => {
      const t = makeLiveTier()
      try {
        seedWindowFixture(t)
        await openWindow(t)

        const decision = await t.provide(decideCloseWindow, def)
        if (!decision.shouldClose) throw new Error("expected an open window")
        const script = buildCloseWindowScript(decision.refs)

        execScript(t, script)
        const headAfterFirst = t.observe.resolveRef("HEAD")
        const statusAfterFirst = t.observe.statusPorcelain()
        expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(false)
        expect(t.observe.refExists(REVIEW_BASE_REF)).toBe(false)

        execScript(t, script)
        expect(t.observe.resolveRef("HEAD")).toBe(headAfterFirst)
        expect(t.observe.statusPorcelain()).toBe(statusAfterFirst)
        expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(false)
        expect(t.observe.refExists(REVIEW_BASE_REF)).toBe(false)
      } finally {
        t.dispose()
      }
    })

    it("open: the second run is a no-op", async () => {
      const t = makeLiveTier()
      try {
        seedWindowFixture(t)
        const head = t.observe.resolveRef("HEAD")
        const run = await t.provide(currentRun, def)
        const decision = decideOpenWindow(def, "gate", run, head)
        if (!decision.shouldOpen) throw new Error("expected the window to open")
        const script = buildOpenWindowScript(decision)

        execScript(t, script)
        const headRefAfterFirst = t.observe.resolveRef(REVIEW_HEAD_REF)
        const baseRefAfterFirst = t.observe.resolveRef(REVIEW_BASE_REF)
        const statusAfterFirst = t.observe.statusPorcelain()
        const realHeadAfterFirst = t.observe.resolveRef("HEAD")

        execScript(t, script)
        expect(t.observe.resolveRef(REVIEW_HEAD_REF)).toBe(headRefAfterFirst)
        expect(t.observe.resolveRef(REVIEW_BASE_REF)).toBe(baseRefAfterFirst)
        expect(t.observe.statusPorcelain()).toBe(statusAfterFirst)
        expect(t.observe.resolveRef("HEAD")).toBe(realHeadAfterFirst)
      } finally {
        t.dispose()
      }
    })
  })
})
