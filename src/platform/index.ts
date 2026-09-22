/**
 * gtd's two ports onto its environment: `Workspace` (repo file content —
 * working-tree reads/writes plus the read-at-ref path) and `Host` (root,
 * home, env, scratch). `GitService` moved in alongside `Workspace` since
 * `committed` IS `git.readFileAtRef` — one module owns every read.
 *
 * Seam rule, stated once: a seam is a `Context.Tag` unless the consuming
 * code is synchronous, non-Effect code that cannot `yield*` — Eta's template
 * rendering and `PatternConfig`'s pure compilers are that exception, and take
 * `Workspace.readSync` as a plain function argument instead of injecting the
 * tag. Everything else goes through `Workspace`/`Host` via `yield*`.
 */
export {
  Workspace,
  templateDiff,
  templateRead,
  templateReadCommitted,
  type WorkspaceOps,
} from "./Workspace.js"
export { Host, type HostOps } from "./Host.js"
export {
  GitService,
  type GitOperations,
  type GitReaderOperations,
  type GitWriterOperations,
} from "./Git.js"
