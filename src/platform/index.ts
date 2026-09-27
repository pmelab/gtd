/**
 * gtd's two ports onto its environment: `Workspace` (repo file content —
 * working-tree reads/writes plus the read-at-ref path) and `Host` (root,
 * home, env, scratch). `GitService` moved in alongside `Workspace` since
 * `committed` IS `git.readFileAtRef` — one module owns every read.
 *
 * Seam rule, stated once: a seam is a `Context.Tag` unless the consuming
 * code is synchronous, non-Effect code that cannot `yield*` — replay's flow
 * reads are that exception, and use the `*Sync` members.
 */
export { Workspace, type WorkspaceOps } from "./Workspace.js"
export { Host, type HostOps } from "./Host.js"
export {
  GitService,
  type GitOperations,
  type GitReaderOperations,
  type GitWriterOperations,
} from "./Git.js"
