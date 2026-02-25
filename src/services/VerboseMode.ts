import { Context, Layer } from "effect"

export interface VerboseModeValue {
  readonly isVerbose: boolean
}

export class VerboseMode extends Context.Tag("VerboseMode")<VerboseMode, VerboseModeValue>() {
  static layer = (verbose: boolean): Layer.Layer<VerboseMode> =>
    Layer.succeed(VerboseMode, { isVerbose: verbose })
}
