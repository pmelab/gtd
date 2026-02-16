import { Context, Layer } from "effect"

export interface QuietModeValue {
  readonly isQuiet: boolean
}

export class QuietMode extends Context.Tag("QuietMode")<QuietMode, QuietModeValue>() {
  static layer = (quiet: boolean): Layer.Layer<QuietMode> =>
    Layer.succeed(QuietMode, { isQuiet: quiet })
}
