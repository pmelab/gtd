// The prompt evals' workflows: `gtd --workflow <name>` runs one bundled agent
// step, with the bundled prompt and persona, against the fixture's tree.
// `evals/fixture.mjs` copies it into each fixture repo.
import { read, scope, start } from "@pmelab/gtd/flows"
import {
  author,
  build,
  collecting,
  decompose,
  fix,
  fixSpec,
  fixSuite,
  nextPackage,
  reviewing,
  reviewPackage,
  triage,
} from "@pmelab/gtd/workflow"

export { defaults } from "@pmelab/gtd/workflow"

const pkg = (): string => nextPackage() ?? ""
const inPackage = (step: () => Promise<void>) => () => scope("packages", () => scope("item", step))

// One workflow per bundled agent step, named by the step's full name in
// camelCase (`packages.item.fix-suite` -> `packagesItemFixSuite`): each runs
// that step in the scope the workflow gives it. Steps that review since a base
// see the process's own diff base; package steps work on the first queued
// package; collecting reads its capture from `.gtd/REVIEW_RAW.md`, where an
// eval fixture puts it. `evals/fixture.mjs` derives the name from the case's
// `state`.
export const buildReviewReviewing = () => scope("build", () => reviewing(start()))
export const buildReviewCollecting = () =>
  scope("build", () => collecting(read(".gtd/REVIEW_RAW.md") ?? ""))
export const designTriage = () => scope("design", () => triage(start()))
export const architectureAuthor = () => scope("architecture", author)
export const architectureDecompose = () => scope("architecture", decompose)
export const packagesItemBuilding = inPackage(() => build(pkg()))
export const packagesItemFixSuite = inPackage(fixSuite)
export const packagesItemFixSpec = inPackage(() => fixSpec(pkg()))
export const packagesItemSpecReview = inPackage(() => reviewPackage(pkg()))
export const buildFix = () => scope("build", fix)
