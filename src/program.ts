import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { ToolCommands, type LiveToolCommands, type UiRequest } from "./cli/index.js"
import { runJudge } from "./judges/index.js"
import { liveLoopHost, runLoop } from "./loop/index.js"
import { startLspServer } from "./lsp/index.js"
import { CommandRunner, GtdError, GtdUsageError } from "./platform/index.js"
import { runUiCommand, UiListener, UiShell, UiUsageError, type UiConfig } from "./ui/index.js"

/** `A`, or `never` when `A` has a key `B` lacks. */
type KeysCoveredBy<A, B> = Exclude<keyof A, keyof B> extends never ? A : never

// ui declares its own `UiConfig`; a `ui:` schema key it doesn't know fails here.
const uiConfigOf = (
  config: UiRequest["config"],
): KeysCoveredBy<NonNullable<UiRequest["config"]>, UiConfig> | undefined => config

export const liveToolCommands = Layer.effect(
  ToolCommands,
  Effect.gen(function* () {
    const shell = yield* CommandRunner
    const fs = yield* FileSystem.FileSystem
    return {
      ui: (request, out) =>
        runUiCommand(request.flags, uiConfigOf(request.config), out, request.root).pipe(
          Effect.provideService(UiShell, shell),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provide(UiListener.Live),
          Effect.mapError((error) =>
            error instanceof UiUsageError
              ? new GtdUsageError(error.message, error.detail)
              : new GtdError(error.message, error.detail),
          ),
        ),
      lsp: (gtd) => startLspServer({ gtd }),
      loop: (gtd) => runLoop({ gtd }).pipe(Effect.provide(liveLoopHost)),
      judge: runJudge,
    }
  }),
) satisfies LiveToolCommands
