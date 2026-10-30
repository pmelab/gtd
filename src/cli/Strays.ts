import { Effect } from "effect"
import { GitService, GtdError, Narrator, type GitOperations } from "../platform/index.js"
import { strayPaths } from "../step/index.js"
import { EXIT_OK, EXIT_STRAYS_FOUND, PIN_PATH } from "../wire/index.js"
import {
  SelectorUsageError,
  writeSelection,
  type ArtifactOut,
  type JsonMode,
  type SuccessExit,
} from "./Output.js"

// `^{commit}` peels to a commit: a tree or blob would make `git diff` print paths not anchored at the repo root.
const resolveSide = (git: GitOperations, side: string): Effect.Effect<string, Error> =>
  git
    .resolveRef(`${side}^{commit}`)
    .pipe(Effect.mapError(() => new GtdError(`gtd strays: unknown revision '${side}'`)))

/** stdout carries the array alone; the summary is ungated stderr so a quiet run still explains its exit code, the per-path lines are narration. */
export const runStraysCommand = (
  command: {
    readonly base: string
    readonly tip: string
    readonly globs: readonly string[]
  },
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<SuccessExit, Error, GitService | Narrator> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const narrator = yield* Narrator
    const base = yield* resolveSide(git, command.base)
    const tip = yield* resolveSide(git, command.tip)
    // The pin is the engine's, never a turn's, so it is never a stray either.
    const touched = (yield* git.diffPaths(base, tip)).filter((path) => path !== PIN_PATH)
    const strays = strayPaths(touched, command.globs)
    const total = touched.length

    if (json.kind === "select") {
      // An index past the end is absent here, not a usage error: it must not mask the exit 0/10 verdict.
      yield* writeSelection(out, strays, json.path).pipe(
        Effect.catchIf(
          (error) => error instanceof SelectorUsageError && /^\d+$/.test(json.path),
          () => Effect.void,
        ),
      )
    } else out.write(`${JSON.stringify(strays)}\n`)

    // JSON-quoted: a path is author-controlled and must not carry terminal escapes.
    for (const path of strays) yield* narrator.narrate(`stray: ${JSON.stringify(path)}`)
    yield* narrator.warn(
      strays.length === 0
        ? `gtd strays: no strays — ${total} touched files, all inside the allowlist`
        : `gtd strays: ${strays.length} of ${total} touched files outside the allowlist`,
    )
    return strays.length === 0 ? EXIT_OK : EXIT_STRAYS_FOUND
  })
