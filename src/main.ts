import { Command } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { command } from "./cli.js"
import { GtdConfigService } from "./services/Config.js"
import { GitService } from "./services/Git.js"
import { AgentService } from "./services/Agent.js"

const AgentLive = AgentService.Live.pipe(Layer.provide(GtdConfigService.Live))

const ServicesLayer = Layer.mergeAll(GtdConfigService.Live, GitService.Live, AgentLive)

const cli = Command.run(command, {
  name: "gtd",
  version: "0.1.0",
})

cli(process.argv).pipe(
  Effect.provide(ServicesLayer),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
)
