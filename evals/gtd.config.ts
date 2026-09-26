// The prompt evals' workflow: `gtd --entry <step>` runs that one bundled agent
// step, with the bundled prompt and persona, against the fixture's tree.
// `evals/fixture.mjs` copies it into each fixture repo, pointing the import
// at this checkout.
import { human, refuse, workflow } from "@pmelab/gtd/flows"
import { agentSpecs, defaults, runAgentSpec } from "../src/workflows/index.js"

export default workflow(
  async ({ entry }) => {
    if (entry === undefined) {
      await human("idle", { message: "An eval fixture: enter the step under test." })
      return
    }
    const spec = agentSpecs[entry]
    if (spec === undefined) {
      return refuse(`"${entry}" is not an enterable state — no bundled agent step has that name`)
    }
    await runAgentSpec(entry, spec)
  },
  { vars: defaults },
)
