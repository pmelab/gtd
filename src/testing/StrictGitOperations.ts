import { Effect } from "effect"
import type { GitOperations } from "../platform/index.js"
import { TEST_DOUBLE_SENTINEL } from "./InMemRepo.js"

/**
 * A `GitOperations` Proxy: `overrides` supply the methods a test actually
 * exercises; every other method fails loudly the moment it's called — no
 * method list to keep in sync with `GitReaderOperations`/`GitWriterOperations`
 * (unlike a plain object literal, which needs a case per port method).
 * `message`, when given, replaces the default per-method wording (e.g.
 * `program.test.ts`'s "GitService must not be called for --version/--help").
 */
export const strictGitOperations = (
  overrides: Partial<GitOperations>,
  message?: (name: string) => string,
): GitOperations =>
  new Proxy(overrides, {
    get(target, prop: string | symbol) {
      if (typeof prop === "symbol" || prop in target) {
        return (target as Record<string | symbol, unknown>)[prop as string]
      }
      const name = String(prop)
      return () =>
        Effect.fail(
          new Error(
            message?.(name) ??
              `${name} should not have been called by this test (${TEST_DOUBLE_SENTINEL})`,
          ),
        )
    },
  }) as GitOperations
