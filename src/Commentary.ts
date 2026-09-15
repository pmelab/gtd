import { Context, Effect, Layer } from "effect"

/**
 * One line of stderr commentary — `narrate` is gated entirely by how the
 * layer was built, never by the call site; `warn` is its ungated
 * counterpart, always written regardless of verbosity.
 */
export class Narrator extends Context.Tag("Narrator")<
  Narrator,
  {
    readonly narrate: (line: string) => Effect.Effect<void>
    readonly warn: (line: string) => Effect.Effect<void>
  }
>() {
  /**
   * `write` is the raw stderr sink (`CliIo.stderr` in production, so the
   * in-memory `CliIo` used by `@inmem` e2e scenarios captures narration into
   * the exact same buffer it already captures errors into). `verbose` gates
   * every `narrate` line at construction time — the resulting service is a
   * no-op writer when `false`, never a per-call check a narrating call site
   * has to remember to make. `warn` bypasses that gate unconditionally.
   */
  static readonly layer = (
    write: (chunk: string) => void,
    verbose: boolean,
  ): Layer.Layer<Narrator> =>
    Layer.succeed(Narrator, {
      narrate: (line) =>
        Effect.sync(() => {
          if (verbose) write(`${line}\n`)
        }),
      warn: (line) => Effect.sync(() => write(`${line}\n`)),
    })
}

/**
 * An error carrying REMEDIATION alongside its message — the offending config
 * key and the layer it came from, a corrupted ref's name, a missing binary's
 * resolved `$PATH`. Only two families construct one (see
 * `src/workflow/load.ts` and `src/ui/Tls.ts`) — every other `Error` site
 * stays a plain `Error` and renders as the single `gtd: `-prefixed line it
 * always has.
 */
export class GtdError extends Error {
  readonly detail: readonly string[]

  constructor(message: string, detail: readonly string[] = []) {
    super(message)
    this.name = "GtdError"
    this.detail = detail
  }
}

/**
 * A `GtdError` that names how gtd was INVOKED, not what it did — `Cli.ts`'s
 * `report` maps this to `EXIT_USAGE_ERROR` alongside `SelectorUsageError`,
 * rather than the `EXIT_RUNTIME_ERROR` every plain `GtdError` gets. `gtd ui`
 * refusing to start on a step it cannot render is the one constructor today
 * (see `ui/Server.ts`).
 */
export class GtdUsageError extends GtdError {
  constructor(message: string, detail: readonly string[] = []) {
    super(message, detail)
    this.name = "GtdUsageError"
  }
}

/**
 * Structurally, not nominally: an error carrying a `detail: readonly
 * string[]` — `GtdError`'s shape, matched WITHOUT an `instanceof GtdError`
 * check so `src/platform/Git.ts` (which may not import this root module —
 * `platform` has no outward target in `.fallowrc.json`'s `boundaries`) can
 * still render a corrupted ref's remediation lines through its own
 * equivalently-shaped local error class.
 */
const hasDetail = (error: unknown): error is { readonly detail: readonly string[] } =>
  typeof error === "object" &&
  error !== null &&
  "detail" in error &&
  Array.isArray((error as { detail: unknown }).detail)

/**
 * The stderr text for a CLI failure: a `gtd: ` prefix UNLESS the message
 * already carries one, then one two-space-indented line per `GtdError`
 * detail (none, for a plain `Error`) — unconditional, at every verbosity.
 * Most gtd errors are authored with a `gtd:`/`gtd <cmd>:` prefix of their own,
 * so a blind prepend would produce a doubled `gtd: gtd: …`.
 */
export const renderFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  const prefixed = /^gtd[: ]/.test(message) ? message : `gtd: ${message}`
  const detail = hasDetail(error) ? error.detail : []
  return [prefixed, ...detail.map((line) => `  ${line}`)].join("\n")
}
