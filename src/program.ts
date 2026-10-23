import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { ToolCommands, type LiveToolCommands, type UiRequest } from "./cli/index.js"
import { CommandRunner, GtdError, GtdUsageError } from "./platform/index.js"
import type { UiConfig } from "./ui/index.js"

/** `A`, or `never` when `A` has a key `B` lacks. */
type KeysCoveredBy<A, B> = Exclude<keyof A, keyof B> extends never ? A : never

// ui declares its own `UiConfig`; a `ui:` schema key it doesn't know fails here.
const uiConfigOf = (
  config: UiRequest["config"],
): KeysCoveredBy<NonNullable<UiRequest["config"]>, UiConfig> | undefined => config

// Each tool is imported only when its subcommand runs, so `gtd next` never
// evaluates ui, lsp or judge code (the one-file bundle still carries it).
// Imports stay destructured where they are awaited: that is the shape fallow
// traces a dynamic import's uses through. A tool that fails to load fails its
// command as a GtdError, like any other failure, never as a defect; only the
// import is caught, so a bug in the tool still surfaces as one.
const loadFailure =
  (tool: string) =>
  (error: unknown): GtdError =>
    new GtdError(
      `gtd ${tool}: could not load — ${error instanceof Error ? error.message : String(error)}`,
    )

const lazy = <A, E, R>(
  tool: string,
  load: () => Promise<() => Effect.Effect<A, E, R>>,
): Effect.Effect<A, E | GtdError, R> =>
  Effect.tryPromise({ try: load, catch: loadFailure(tool) }).pipe(Effect.flatMap(Effect.suspend))

export const liveToolCommands = Layer.effect(
  ToolCommands,
  Effect.gen(function* () {
    const shell = yield* CommandRunner
    const fs = yield* FileSystem.FileSystem
    return {
      ui: (request, out) =>
        lazy("ui", async () => {
          const { runUiCommand, UiListener, UiShell, UiUsageError, liveUiHost } =
            await import("./ui/index.js")
          return () =>
            runUiCommand(request.flags, uiConfigOf(request.config), out, request.root).pipe(
              Effect.provideService(UiShell, shell),
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provide(UiListener.Live),
              Effect.provide(liveUiHost),
              Effect.mapError((error) =>
                error instanceof UiUsageError
                  ? new GtdUsageError(error.message, error.detail)
                  : new GtdError(error.message, error.detail),
              ),
            )
        }),
      lsp: (gtd) =>
        lazy("lsp", async () => {
          const { startLspServer } = await import("./lsp/index.js")
          return () => startLspServer({ gtd })
        }),
      judge: async (request) => {
        const { runJudge } = await import("./judges/index.js").catch((error: unknown) => {
          throw loadFailure("judge")(error)
        })
        return runJudge(request)
      },
    }
  }),
) satisfies LiveToolCommands
