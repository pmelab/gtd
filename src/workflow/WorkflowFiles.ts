/**
 * The one port `compileWorkflow` reads through — a plain record (not a
 * `Context.Tag`) since the compile path is sync and total, and a Tag would
 * force every test to build a layer stack to reach a pure function. Replaces
 * the two differently-shaped ad hoc readers config-discovery and
 * `src/PatternConfig.ts` used to thread separately (config-discovery reads
 * vs. content file-ref reads) — both are "read a file this repo points at",
 * and both must agree
 * on the same root, which `load` (`src/workflow/load.ts`) guarantees by
 * building this record once, over one `Workspace`, and handing it to both
 * discovery and `compileWorkflow`.
 */
export interface WorkflowFiles {
  readonly read: (path: string) => string | undefined
}
