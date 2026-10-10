export {
  type EmitStep,
  fileExistsGuard,
  withFileVar,
  commandForFile,
  binaryGuard,
  failurePromptWrapper,
  emitScripts,
  DID_NOT_RUN_COMMENT,
  PRESENTATION_ONLY_COMMENT,
  PRESENTATION_FAILURE_WARNING,
  combinedScript,
} from "./Emit.js"
export {
  shellQuote,
  commitAll,
  commitAsIs,
  softResetTo,
  mixedResetTo,
  hardResetTo,
  discardPending,
  updateRef,
  deleteRef,
  type RunnableScript,
  ScriptSurface,
} from "./GitScript.js"
export {
  OUTCOME_MARKER,
  transitionOutcome,
  commitOutcome,
  noteOutcome,
  abandonedOutcome,
  abandonNoopOutcome,
  restoredOutcome,
} from "./OutcomeScript.js"
export {
  contradictionMessage,
  buildModeContradictionCheck,
  modeContradictionSkipNotice,
} from "./ModeContradiction.js"
export { type ResolvedMode, resolveMode, validateScriptFor } from "./SteeringMode.js"
