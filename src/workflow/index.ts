// The config boundary: discovery of `.gtdrc` levels and `gtd.config.ts`,
// their decode and compile, and the loaded workflow.
export {
  load,
  loadRcConfig,
  ConfigService,
  configPresentAt,
  type ConfigOperations,
  type ResolvedWorkflow,
} from "./load.js"
export {
  ConfigDiscovery,
  parseConfigLevel,
  SEARCH_PLACES,
  WORKFLOW_MODULE,
  walkUp,
} from "./discovery.js"
export { formatDiagnostic } from "./Diagnostic.js"
export { resolveVars, multilineSetting, isSettingName, SETTING_NAME_RULE } from "./vars.js"
export { renderInitScaffold } from "./init.js"
