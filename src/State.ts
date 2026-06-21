import type { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { gatherEvents } from "./Events.js"
import type { GitService } from "./Git.js"
import { resolve, type ResolveResult } from "./Machine.js"

export type { ResolveResult } from "./Machine.js"

/**
 * Detect the current gtd state by gathering git/filesystem facts (the Effect
 * edge in src/Events.ts) and folding them through the pure event-sourced
 * machine (src/Machine.ts). The fold (`resolve`) is synchronous and IO-free;
 * all IO happens while gathering events.
 */
export const detect = (): Effect.Effect<
  ResolveResult,
  Error,
  GitService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const events = yield* gatherEvents()
    return resolve(events)
  })
