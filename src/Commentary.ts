/**
 * The whole stderr channel: narration and remediation, the two occupants of
 * gtd's one commentary surface. `Narrator` is an Effect SERVICE, not a
 * threaded parameter — a call site deep in the edge (`Edge.ts`'s rest
 * resolver, `Config.ts`'s config loader, …) can narrate without every caller
 * in between passing a writer down. Narration is gated by `--verbose`
 * (`Cli.ts` builds the service from `CliIo.stderr`, wired to a no-op writer
 * when the flag is absent); `GtdError`'s remediation `detail` is
 * unconditional — `renderFailure` prints it at every verbosity.
 */
import { Context, Effect, Layer } from "effect"

/** One line of stderr commentary — gated entirely by how the layer was built, never by the call site. */
export class Narrator extends Context.Tag("Narrator")<
  Narrator,
  { readonly narrate: (line: string) => Effect.Effect<void> }
>() {
  /**
   * `write` is the raw stderr sink (`CliIo.stderr` in production, so the
   * in-memory `CliIo` used by `@inmem` e2e scenarios captures narration into
   * the exact same buffer it already captures errors into). `verbose` gates
   * every line at construction time — the resulting service is a no-op
   * writer when `false`, never a per-call check a narrating call site has to
   * remember to make.
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
    })
}

/**
 * An error carrying REMEDIATION alongside its message — the offending config
 * key and the layer it came from, a corrupted ref's name, a missing binary's
 * resolved `$PATH`. Only three families construct one (see `Config.ts`,
 * `Git.ts`, `SteeringMode.ts`) — every other `Error` site stays a plain
 * `Error` and renders as the single `gtd: `-prefixed line it always has.
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
 * The stderr text for a CLI failure: a `gtd: ` prefix UNLESS the message
 * already carries one, then one two-space-indented line per `GtdError`
 * detail (none, for a plain `Error`) — unconditional, at every verbosity.
 * Most gtd errors are authored with a `gtd:`/`gtd <cmd>:` prefix of their own
 * (e.g. `gtd init: …`, `gtd: unknown option …`), so a blind prepend would
 * produce a doubled `gtd: gtd: …`. Replaces `Cli.ts`'s old single-line
 * `cliErrorLine` — every caller there still gets exactly one line back for a
 * plain `Error`; only a `GtdError` grows the extra detail lines.
 */
export const renderFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  const prefixed = /^gtd[: ]/.test(message) ? message : `gtd: ${message}`
  const detail = error instanceof GtdError ? error.detail : []
  return [prefixed, ...detail.map((line) => `  ${line}`)].join("\n")
}
