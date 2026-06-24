import type { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { gatherEvents } from "./Events.js"
import type { GitService } from "./Git.js"
import { type Handle, type ResolveResult, start } from "./Machine.js"

// Re-export the canonical types the edge (main.ts / driver loop) consumes via
// `State.js`. `ResolveResult` + `EdgeAction` come from the machine; `TestResult`
// is owned by `TestRunner` (the layer that actually produces it).
export type { EdgeAction, Handle, ResolveResult } from "./Machine.js"
export type { TestResult } from "./TestRunner.js"

/**
 * Open the gtd stepping machine for the current repository.
 *
 * Gathers git/filesystem facts (the Effect edge in `src/Events.ts`) and folds
 * the resulting events through a single long-lived actor, returning the live
 * `Handle`. All IO happens while gathering events; the machine fold and the
 * handle's `advance` are pure and synchronous. The driver advances the handle
 * with `TEST_RESULT` / `REVIEW_RECORDED` (and re-gathered `RESOLVE`) events as
 * it performs the side effects the machine's `edgeAction` requests.
 *
 * `State.ts` performs NO git writes; `gatherEvents` is the only IO here.
 */
export const startDetect = (): Effect.Effect<Handle, Error, GitService | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const events = yield* gatherEvents()
    return start(events)
  })

/**
 * Convenience wrapper retained for callers that only need the first projection
 * (a one-shot `ResolveResult`) rather than the live handle — e.g. `main.ts`
 * until the driver loop (package 03) switches to `startDetect`.
 */
export const detect = (): Effect.Effect<ResolveResult, Error, GitService | FileSystem.FileSystem> =>
  Effect.map(startDetect(), (handle) => handle.current)
