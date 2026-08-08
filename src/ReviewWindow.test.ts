import { rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService } from "./Git.js"
import { Cwd } from "./Cwd.js"
import { currentRun, reviewBaseFor } from "./Edge.js"
import {
  closeReviewWindow,
  LEGACY_REVIEW_BASE_REF,
  LEGACY_REVIEW_HEAD_REF,
  openReviewWindow,
  REVIEW_BASE_REF,
  REVIEW_HEAD_REF,
} from "./ReviewWindow.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import { gitTiers, type GitTier } from "./testing/GitTiers.js"

/**
 * The review checkout window, parameterized over both `GitOperations` tiers
 * (`src/testing/GitTiers.ts`) — the mixed-reset open/close round trip and the
 * `reviewBase` base-narrowing run on Live AND InMemory alike, now that the
 * git contract (package/step 4) covers every primitive the window uses
 * (`mixedResetTo`, `restoreStagedFrom`, `isAncestor`, `updateRef`/`deleteRef`,
 * `readRefOption`). Only the linked-worktree groups
 * (`git worktree add` — `t.capabilities.linkedWorktrees`) stay Live-only; the
 * @inmem `review-window.feature` covers the same lifecycle end-to-end through
 * the program edge.
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

    describe("openReviewWindow / closeReviewWindow — base = process start", () => {
      it("rewinds HEAD to the process boundary, surfaces the diff, and restores on close", async () => {
        t.seed.commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
        t.seed.commit("gtd(human): gate", { "src/other.ts": "export const x = 1\n" })
        const realHead = t.observe.resolveRef("HEAD")

        const opened = await t.provide(openReviewWindow, def)
        expect(opened.opened).toBe(true)
        // HEAD rewound to the process boundary (the non-gtd initial commit).
        expect(await headSubject(t)).toBe("init: first commit")
        expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(true)
        expect(t.observe.refExists(REVIEW_BASE_REF)).toBe(true)
        // The whole process diff is now uncommitted.
        expect(t.observe.statusPorcelain()).toContain("src/calc.ts")
        expect(t.observe.statusPorcelain()).toContain("src/other.ts")

        const closed = await t.provide(closeReviewWindow, def)
        expect(closed.closed).toBe(true)
        expect(t.observe.resolveRef("HEAD")).toBe(realHead)
        expect(await headSubject(t)).toBe("gtd(human): gate")
        expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(false)
        expect(t.observe.refExists(REVIEW_BASE_REF)).toBe(false)
        // The working tree is clean again — the surfaced diff was re-committed.
        expect(t.observe.statusPorcelain()).toBe("")
      })

      it("is a no-op when resting anywhere but a reviewWindow state", async () => {
        t.seed.commit("gtd(agent): building", { "src/calc.ts": "x\n" })
        const opened = await t.provide(openReviewWindow, def)
        expect(opened.opened).toBe(false)
        expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(false)
      })
    })

    describe("reviewBase — narrowing the diff base", () => {
      it("opens against the most-recent in-process reviewBase commit", async () => {
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

        await t.provide(openReviewWindow, def)
        // HEAD rewound to the checkpoint, so only work AFTER it surfaces.
        expect(await headSubject(t)).toBe("gtd(human): checkpoint")
        expect(t.observe.statusPorcelain()).toContain("src/b.ts")
        expect(t.observe.statusPorcelain()).not.toContain("src/a.ts")
      })
    })

    describe("closeReviewWindow — safety", () => {
      it("is a no-op when no window is open", async () => {
        const closed = await t.provide(closeReviewWindow, def)
        expect(closed.closed).toBe(false)
      })
    })

    describe("closeReviewWindow — the legacy shared refs (gtd ≤ 7.1)", () => {
      // A window an older gtd left open across the upgrade: HEAD rewound to
      // the base, the real head parked under the SHARED refs — both tiers
      // support this via the generic `seed.updateRef`/`seed.mixedReset`.
      const openLegacyWindow = (tier: GitTier, base: string, head: string): void => {
        tier.seed.updateRef(LEGACY_REVIEW_BASE_REF, base)
        tier.seed.updateRef(LEGACY_REVIEW_HEAD_REF, head)
        tier.seed.mixedReset(base)
      }

      it("finishes a window left behind by an older gtd in this worktree", async () => {
        const base = t.observe.resolveRef("HEAD")
        t.seed.commit("gtd(agent): building", { "src/calc.ts": "export const add = 1\n" })
        t.seed.commit("gtd(human): gate", {})
        const realHead = t.observe.resolveRef("HEAD")
        openLegacyWindow(t, base, realHead)

        const closed = await t.provide(closeReviewWindow, def)
        expect(closed.closed).toBe(true)
        expect(t.observe.resolveRef("HEAD")).toBe(realHead)
        expect(t.observe.refExists(LEGACY_REVIEW_HEAD_REF)).toBe(false)
        expect(t.observe.refExists(LEGACY_REVIEW_BASE_REF)).toBe(false)
        expect(t.observe.statusPorcelain()).toBe("")
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

          const opened = await t.provide(openReviewWindow, def)
          expect(opened.opened).toBe(true)
          // The window's refs live in the per-worktree namespace, so the
          // sibling sharing this `.git` cannot even see them…
          expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(true)
          expect(() =>
            gitIn(sibling, "rev-parse", "--verify", "--quiet", REVIEW_HEAD_REF),
          ).toThrow()

          // …and its own gtd invocations close nothing: pre-7.2 this reset
          // the sibling's branch onto THIS worktree's saved head.
          const siblingClosed = await runInDir(sibling)
          expect(siblingClosed.closed).toBe(false)
          expect(gitIn(sibling, "rev-parse", "HEAD")).toBe(siblingHead)

          // This worktree's window survived the sibling's invocation untouched.
          expect(await headSubject(t)).toBe("init: first commit")
          expect(t.observe.refExists(REVIEW_HEAD_REF)).toBe(true)
          const restored = await t.provide(closeReviewWindow, def)
          expect(restored.closed).toBe(true)
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

          await expect(runInDir(sibling)).rejects.toThrow(/does not belong to this worktree/)
          // Nothing moved, nothing was deleted — the owning worktree can
          // still recover with the commands the message spells out.
          expect(gitIn(sibling, "rev-parse", "HEAD")).toBe(siblingHead)
          expect(t.observe.refExists(LEGACY_REVIEW_HEAD_REF)).toBe(true)
          expect(t.observe.refExists(LEGACY_REVIEW_BASE_REF)).toBe(true)
        })

        // `closeReviewWindow` run against an arbitrary directory (the sibling
        // worktree) rather than `t`'s own root — only meaningful for the Live
        // tier, where a directory maps onto a real, independently-`cwd`-able
        // git worktree, so this bypasses `GitTier.provide` (fixed to `t.root`)
        // and wires `GitService.Live` directly, mirroring the pre-tiered
        // test's own `runIn` helper. `closeReviewWindow` needs only
        // `GitService`, unlike `openReviewWindow` — no `ConfigService` layer.
        function runInDir(dir: string) {
          return Effect.runPromise(
            closeReviewWindow.pipe(
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
