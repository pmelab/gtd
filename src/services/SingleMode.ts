import { Context, Layer } from "effect"

export interface SingleModeValue {
  readonly isSingle: boolean
}

export class SingleMode extends Context.Tag("SingleMode")<SingleMode, SingleModeValue>() {
  static layer = (single: boolean): Layer.Layer<SingleMode> =>
    Layer.succeed(SingleMode, { isSingle: single })
}
