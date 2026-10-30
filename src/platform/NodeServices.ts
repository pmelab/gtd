import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node-shared"
import { Layer } from "effect"

// Not `@effect/platform-node`'s own: that package requires a redis peer, which
// every install of gtd would then pull in.
export const layer = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
)

export type NodeServices = Layer.Success<typeof layer>
