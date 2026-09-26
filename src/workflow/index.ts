// The config boundary: discovery of `.gtdrc` levels and `gtd.config.ts`,
// their decode and compile, and the loaded workflow.
export { load, ConfigService, configPresentAt } from "./load.js"
export { ConfigDiscovery, SEARCH_PLACES, WORKFLOW_MODULE, flowsDir, walkUp } from "./discovery.js"
export type { WorkflowModule } from "./discovery.js"
export { formatDiagnostic } from "./Diagnostic.js"
export type { Diagnostic } from "./Diagnostic.js"
export { renderInitScaffold } from "./init.js"
