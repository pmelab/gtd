import { Context, type Effect, Layer } from "effect"

// ui reaches the rest of gtd only through the `gtd` binary and wire, so its
// errors and ports are its own; the composition root maps them onto the
// CLI's (`GtdUsageError` → exit 2) and provides the live services.

export class UiError extends Error {
  readonly detail: readonly string[]

  constructor(message: string, detail: readonly string[] = []) {
    super(message)
    this.name = "UiError"
    this.detail = detail
  }
}

/** A refusal the user can fix by invoking `gtd ui` differently — the CLI exits with its usage code. */
export class UiUsageError extends UiError {
  constructor(message: string, detail: readonly string[] = []) {
    super(message, detail)
    this.name = "UiUsageError"
  }
}

interface ShellOutcome {
  readonly status: number | null
  /** stdout then stderr, merged. */
  readonly output: string
  readonly stdout?: string
  readonly stderr?: string
}

/** One `bash -c` run in the served worktree. A spawn failure fails the Effect; a non-zero exit is a value. */
export class UiShell extends Context.Tag("UiShell")<
  UiShell,
  { readonly bash: (command: string) => Effect.Effect<ShellOutcome, Error> }
>() {
  static readonly layer = (
    bash: (command: string) => Effect.Effect<ShellOutcome, Error>,
  ): Layer.Layer<UiShell> => Layer.succeed(UiShell, { bash })
}

/** The worktree `gtd ui` serves. */
export class UiRoot extends Context.Tag("UiRoot")<UiRoot, { readonly root: string }>() {
  static readonly layer = (root: string): Layer.Layer<UiRoot> => Layer.succeed(UiRoot, { root })
}
