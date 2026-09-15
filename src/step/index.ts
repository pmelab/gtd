// `planStep`/`planEntry` and their outcome types — the whole barrel
// `.gtd/packages/05-step-core.md` asks for. `StepOutcome`/`EntryCurrent`/
// `EntryOutcome` have no caller annotating a variable with their name yet
// (every call site lets it infer from `planStep`/`planEntry`'s return) —
// exported anyway, since they're the public contract a future caller
// pattern-matches against by name.
// fallow-ignore-next-line unused-type
export { planStep, type StepOutcome } from "./planStep.js"
// fallow-ignore-next-line unused-type
export { planEntry, type EntryCurrent, type EntryOutcome } from "./planEntry.js"
// `ExecutableDecision` names the input `renderDecision` narrows a
// `StepDecision` to — no current caller needs the type by name (every
// consumer just pattern-matches `StepOutcome.decision.kind`), but it's part
// of `planStep`'s public outcome vocabulary the package spec asks the
// barrel to carry.
// fallow-ignore-next-line unused-type
export type { ExecutableDecision } from "./planStep.js"
// The three satellite types `StepOutcome` is made of — `LandStep`s a
// `"commit"` outcome carries, and the `Refusal` its `guardVerdict` is — so
// `GitScript.ts`'s `ScriptSurface` (the only thing outside this module that
// ever turns a `StepOutcome` into shell) can import through this barrel
// rather than reaching past it into `./LandStep.js`/`./Guards.js` directly.
export type { GitWrite, LandStep, Outcome } from "./LandStep.js"
export type { Refusal } from "./Guards.js"
// `planStep`'s one input type — every edge that builds a `RepoSnapshot` (today
// only `Edge.ts`'s `snapshotFromRest`) needs it through this barrel too.
export type { RepoSnapshot, RevertProbe } from "./RepoSnapshot.js"
