// The prompt evals' workflow: `gtd --entry <step>` runs that one bundled agent
// step, with the bundled prompt and persona, against the fixture's tree.
// `evals/fixture.mjs` copies it into each fixture repo.
import { human, read, refuse, scope, start, type FlowArgs } from "@pmelab/gtd/flows"
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

/**
 * The bundled agent steps by full name, each run in the scope the workflow
 * gives it. Steps that review since a base see the process's own diff base;
 * package steps work on the first queued package; collecting reads its
 * capture from `.gtd/REVIEW_RAW.md`, where an eval fixture puts it.
 */
export const evalSteps: Readonly<Record<string, () => Promise<void>>> = {
  "build.review.reviewing": () => scope("build", () => reviewing(start())),
  "build.review.collecting": () =>
    scope("build", () => collecting(read(".gtd/REVIEW_RAW.md") ?? "")),
  "design.triage": () => scope("design", () => triage(start())),
  "architecture.author": () => scope("architecture", author),
  "architecture.decompose.decomposing": () => scope("architecture", decompose),
  "packages.item.building": inPackage(() => build(pkg())),
  "packages.item.fix.suite.fixing": inPackage(fixSuite),
  "packages.item.fix.spec.fixing": inPackage(() => fixSpec(pkg())),
  "packages.item.spec.review": inPackage(() => reviewPackage(pkg())),
  "build.fix": () => scope("build", fix),
}

export default async ({ entry }: FlowArgs): Promise<void> => {
  if (entry === undefined) {
    await human("idle", { message: "An eval fixture: enter the step under test." })
    return
  }
  const step = evalSteps[entry]
  if (step === undefined) {
    return refuse(`"${entry}" is not an enterable state — no bundled agent step has that name`)
  }
  await step()
}
