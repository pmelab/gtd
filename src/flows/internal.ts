// gtd's own imports of the flows facade: everything public, plus what only the
// engine uses — undeprecated here, so the public names can leave without
// touching an internal caller.
export * from "./index.js"
export { installContext, protocolMismatch, type FlowContext, type StepRequest } from "./runtime.js"
export { isMarkedWorkflow } from "./runtime.js"
export { configure, isFactoryWorkflow, type OptionIssue } from "./factory.js"
export { configProblems } from "./config.js"
