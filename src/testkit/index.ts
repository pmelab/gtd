// The public testkit: runs any workflow against the real engine in an in-memory
// repository. It imports no test runner, so any runner can use it; the
// gherkin steps are the opt-in \`@pmelab/gtd/testkit/gherkin\`.
export {
  inTurn,
  runsItsScript,
  testRepo,
  verdict,
  verdictWhen,
  whenPrompted,
  type Actors,
  type CannedCommand,
  type DriveOptions,
  type RunScriptOptions,
  type ScriptedActor,
  type TestCommit,
  type TestRepo,
  type TestRepoOptions,
  type Verdict,
  type VerdictEntry,
  type WorkflowModule,
} from "./TestRepo.js"
export type { BeatDocument } from "../wire/index.js"
export type { CapturedCliResult } from "../twins/index.js"
export type { TestkitWorld } from "../gherkin/index.js"
// The flow-context harness: render a prompt or stub a step synchronously,
// against a replay context the test installs instead of the engine.
export { installContext, type FlowContext, type StepRequest } from "../flows/internal.js"
