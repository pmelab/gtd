import { agent, glob, read, refuse, scope, start, vars } from "../../flows/index.js"
import { flagShipped } from "../shared/options.js"
import { flagReferences, registryEntry, requireFlag } from "../shared/registry.js"
import { coder } from "../shared/steps.js"
import { handOffTail, refusePendingHandOff } from "../shared/tail.js"

const removingPrompt = (name: string, registry: string): string =>
  `Clean up the release flag "${name}", which is default-on: delete its entry in ${registry}, and remove every \`GTD_FLAG_${name.toUpperCase()}\` check from the shipped sources. Keep the flag-on path; delete code only the off path reached, including tests that pin the off path.`

export const cleanupFlow = async (): Promise<void> => {
  const registry = vars.flagRegistry ?? ""
  const name = vars.flag ?? ""
  // Before the turn, never after: replay re-runs every pre-turn check.
  refusePendingHandOff()
  requireFlag("cleanup", registry, name, true)
  await scope("cleanup", async () => {
    await agent("removing", removingPrompt(name, registry), {
      label: `Removing ${name}`,
      model: coder(),
    })
    if (registryEntry(read(registry) ?? "", name) !== undefined) {
      return refuse(`gtd land: cleanup: ${registry} still declares flag "${name}"`)
    }
    const files = [...glob("src/**/*.ts"), ...glob("src/**/*.tsx")].map((path) => ({
      path,
      text: read(path) ?? "",
    }))
    const hits = flagReferences(files, name)
    if (hits.length > 0) {
      return refuse(
        `gtd land: cleanup: ${hits.join(", ")} still names GTD_FLAG_${name.toUpperCase()}`,
      )
    }
  })
  await handOffTail(false, start())
}

export const cleanup = flagShipped(cleanupFlow)
