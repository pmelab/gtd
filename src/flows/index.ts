// `@pmelab/gtd/flows`: the authoring surface, listed name by name. gtd's own
// code imports `./internal.js`, which adds what the engine needs.
import * as factory from "./factory.js"
import * as config from "./config.js"
import * as runtime from "./runtime.js"

export {
  accessFor,
  agent,
  changes,
  changesSince,
  codeThreads,
  env,
  envSettings,
  envSettingsOf,
  FLOWS_PROTOCOL,
  FlowsProtocolError,
  glob,
  head,
  human,
  judge,
  kept,
  mark,
  matches,
  openQuestions,
  read,
  refuse,
  restart,
  run,
  scope,
  sectionBodies,
  sections,
  settings,
  settingsOf,
  skillsFor,
  start,
  threads,
  vars,
  workflow,
  type AccessDef,
  type AccessExport,
  type AgentOptions,
  type Change,
  type Changes,
  type CodeThreadInfo,
  type Door,
  type Doors,
  type Flow,
  type Human,
  type HumanOptions,
  type JudgeAnswer,
  type JudgePrimitive,
  type JudgeQuestion,
  type JudgeQuestionInput,
  type JudgeSpec,
  type Judgment,
  type KeptTip,
  type Mark,
  type ModeName,
  type OpenQuestion,
  type RunOptions,
  type ScopeAccess,
  type ScopeOptions,
  type Section,
  type Settings,
  type SkillsExport,
  type Steering,
  type SteeringOptions,
  type Summary,
  type SummaryContext,
  type ThreadInfo,
  type WorkflowBase,
  type WorkflowDoors,
} from "./runtime.js"
export {
  answered,
  check,
  codeChanges,
  displayPath,
  hasThreadFor,
  judgeDiffShape,
  numeric,
  requireAnswers,
  requireProgress,
  requireReplies,
  requireRevert,
  requireThreadsClosed,
  seamGate,
  wrote,
  type Check,
  type CheckOptions,
  type DiffShape,
  type DiffShapeOptions,
  type DiffShapeResult,
} from "./helpers.js"
export {
  applyScript,
  checkScript,
  moveScript,
  quote,
  removeScript,
  restoreScript,
  revertScript,
  showScript,
  writeScript,
  type CheckScriptOptions,
} from "./scripts.js"
export {
  defineWorkflow,
  type ConfiguredWorkflow,
  type WorkflowBuild,
  type WorkflowFactory,
} from "./factory.js"
export { defineConfig, type GtdConfig, type ModeCommands, type UiSettings } from "./config.js"

/** @deprecated Engine-only: installs the replay context. Not for workflows; leaves this entrypoint in a later major. */
export const installContext = runtime.installContext
/** @deprecated Engine-only. Not for workflows; leaves this entrypoint in a later major. */
export const protocolMismatch = runtime.protocolMismatch
/** @deprecated Engine-only: the replay context's shape. Not for workflows; leaves this entrypoint in a later major. */
export type FlowContext = runtime.FlowContext
/** @deprecated Engine-only: what a step hands the replay context. Not for workflows; leaves this entrypoint in a later major. */
export type StepRequest = runtime.StepRequest
/** @deprecated Engine-only: validates and builds a factory workflow the way loading the config does. Leaves this entrypoint in a later major. */
export const configure = factory.configure
/** @deprecated Engine-only. Leaves this entrypoint in a later major. */
export const isFactoryWorkflow = factory.isFactoryWorkflow
/** @deprecated Engine-only: `configure`'s result. Leaves this entrypoint in a later major. */
export type Configured = factory.Configured
/** @deprecated Engine-only: one rejected factory option. Leaves this entrypoint in a later major. */
export type OptionIssue = factory.OptionIssue
/** @deprecated Engine-only: use `defineConfig`, which throws on the same problems. Leaves this entrypoint in a later major. */
export const configProblems = config.configProblems
/** @deprecated Engine-only. Leaves this entrypoint in a later major. */
export type ConfigProblem = config.ConfigProblem
