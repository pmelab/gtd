import { agent, changes, read, refuse, scope, vars } from "../../flows/index.js"
import { gate } from "../shared/health.js"
import { flagShipped } from "../shared/options.js"
import { flipProblems, requireFlag } from "../shared/registry.js"
import { coder } from "../shared/steps.js"

const flippingPrompt = (name: string, registry: string): string =>
  `Roll out the release flag "${name}": in ${registry}, set \`defaultOn: true\` on its entry. Change nothing else — no other entry, no other field, no other file, no comments.`

const suiteBlockedMessage = (): string =>
  "The suite is red after the rollout. Fix it by hand — a rollout may only touch the flag's registry entry — then land."

// No review gate — a one-field change needs no review lap.
export const rolloutFlow = async (): Promise<void> => {
  const registry = vars.flagRegistry ?? ""
  const name = vars.flag ?? ""
  // Before the turn, never after: replay re-runs every pre-turn check.
  requireFlag("rollout", registry, name, false)
  const before = read(registry) ?? ""
  await scope("rollout", async () => {
    await agent("flipping", flippingPrompt(name, registry), {
      label: `Rolling out ${name}`,
      model: coder(),
    })
    const strays = changes().paths.filter((path) => path !== registry)
    if (strays.length > 0) {
      return refuse(
        `gtd land: rollout-only: ${strays.join(", ")} changed — rollout may only set defaultOn: true on "${name}" in ${registry}`,
      )
    }
    const problems = flipProblems(before, read(registry) ?? "", name)
    if (problems.length > 0) {
      return refuse(`gtd land: rollout-only: other edits in ${registry}: ${problems.join("; ")}`)
    }
    await gate("suite", suiteBlockedMessage())
  })
}

export const rollout = flagShipped(rolloutFlow)
