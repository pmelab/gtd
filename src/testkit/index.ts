// The public testkit: runs any workflow against the real engine in an in-memory
// repository. It imports no test runner, so any runner can use it; the
// gherkin steps are the opt-in \`@pmelab/gtd/testkit/gherkin\`.
export {
  runsItsScript,
  testRepo,
  type Actor,
  type Actors,
  type DriveOptions,
  type TestRepo,
  type TestRepoOptions,
  type WorkflowModule,
} from "./TestRepo.js"
export { InMemRepo, type CapturedCliResult } from "../twins/index.js"
export type { TestkitWorld } from "../gherkin/index.js"
