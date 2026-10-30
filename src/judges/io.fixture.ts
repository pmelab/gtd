import { Effect } from "effect"
import { NodeServices } from "../platform/index.js"
import { liveJudgeIo } from "./providers/io.js"

export const nodeJudgeIo = await Effect.runPromise(
  liveJudgeIo.pipe(Effect.provide(NodeServices.layer)),
)
