/**
 * gtd's ports onto its environment: `Workspace` (repo file content —
 * working-tree reads/writes plus the read-at-ref path), `Host` (root,
 * home, env, scratch, process identity, stdio) and `SyncIo`, the reads that
 * must stay synchronous, which only `Node*.ts` implements against Node. `GitService` moved in alongside `Workspace` since
 * `committed` IS `git.readFileAtRef` — one module owns every read.
 *
 * Seam rule, stated once: a seam is a `Context.Service` unless the consuming
 * code is synchronous, non-Effect code that cannot `yield*` — replay's flow
 * reads are that exception, and use the `*Sync` members.
 */
export { Workspace, type WorkspaceOps } from "./Workspace.js"
export {
  Host,
  nodeStdio,
  scratchDirOf,
  type HostOps,
  type NodeProcess,
  type Stdio,
} from "./Host.js"
export {
  GitService,
  type GitOperations,
  type GitReaderOperations,
  type GitWriterOperations,
  type AuthorIdent,
} from "./Git.js"
export { Narrator, GtdError, GtdUsageError, renderFailure } from "./Commentary.js"
export { CommandRunner } from "./CommandRunner.js"
export * as NodeServices from "./NodeServices.js"
export { loopLogPath } from "./WorktreeState.js"
export {
  HISTORY_REF,
  keptRef,
  processHistoryRef,
  PROCESS_HISTORY_PREFIX,
  readRetainedHistory,
  restorability,
} from "./RetainedHistory.js"
export { livePinFile, runPinModule } from "./NodePinFile.js"
export type { PinFile } from "./PinFile.js"
export type { FileInfo, SyncIo } from "./SyncIo.js"
export { nodeSyncIo } from "./NodeSync.js"
export { pureHash } from "./Sha.js"
export * as NodeRuntime from "./NodeRuntime.js"
