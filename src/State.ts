import type { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { gatherEvents } from "./Events.js"
import type { GitService } from "./Git.js"
import { resolve, type ResolveResult } from "./Machine.js"

export type { ResolveResult } from "./Machine.js"

/** Result of running the project test suite (contract owned by TestRunner, task 01). */
export interface TestResult {
  readonly exitCode: number
  readonly output: string
}

/** Prompt-override contract owned by Prompt.ts (task 02). */
export type PromptOverride =
  | { readonly kind: "fix-tests"; readonly testOutput: string }
  | { readonly kind: "review-process"; readonly reviewDiff: string; readonly recordSha: string }

/**
 * Pure decision for what prompt to render after the test gate ran on a leaf.
 *
 * Returns the (result, override?) pair that should be fed to `buildPrompt`.
 * Kept IO-free and free of any dependency on TestRunner/buildPrompt so the
 * branching logic (green → normal, red < cap → fix-tests, red >= cap →
 * escalate) is unit-testable without spawning a subprocess.
 *
 * The cap check is GENERIC — it reads `result.context.verifyIterations` vs
 * `result.context.maxVerifyIterations` — so the execute path (package 02) can
 * reuse it unchanged.
 */
export interface PromptSelection {
  readonly result: ResolveResult
  readonly override?: PromptOverride
}

export const selectPrompt = (result: ResolveResult, test: TestResult): PromptSelection => {
  // Green: unchanged path for the resolved leaf.
  if (test.exitCode === 0) {
    return { result }
  }
  // Red: honor the escalation cap generically.
  const { verifyIterations, maxVerifyIterations } = result.context
  if (verifyIterations >= maxVerifyIterations) {
    return { result: { ...result, value: "escalate", autoAdvance: false } }
  }
  // Red, below cap: emit the fix-tests prompt with the captured output.
  return { result, override: { kind: "fix-tests", testOutput: test.output } }
}

/**
 * Detect the current gtd state by gathering git/filesystem facts (the Effect
 * edge in src/Events.ts) and folding them through the pure event-sourced
 * machine (src/Machine.ts). The fold (`resolve`) is synchronous and IO-free;
 * all IO happens while gathering events.
 */
export const detect = (): Effect.Effect<ResolveResult, Error, GitService | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const events = yield* gatherEvents()
    return resolve(events)
  })
