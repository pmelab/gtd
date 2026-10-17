import { agent, changes, glob, read, refuse, scope, start, vars } from "../../flows/index.js"
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
  // After `removing` both checks are per-turn: only a turn that touched the registry or a source is refused, so the human's unguarded sign-off edits are never blamed on a later agent turn.
  let scanned = false
  const guard = (): void => {
    const turn = scanned ? changes() : undefined
    if (
      (turn === undefined || turn.some((c) => c.path === registry)) &&
      registryEntry(read(registry) ?? "", name) !== undefined
    ) {
      refuse(`gtd land: cleanup: ${registry} still declares flag "${name}"`)
    }
    const paths =
      turn === undefined
        ? [...glob("src/**/*.ts"), ...glob("src/**/*.tsx")]
        : turn
            .filter((c) => c.status !== "deleted")
            .map((c) => c.path)
            .filter((path) => path.startsWith("src/") && /\.tsx?$/.test(path))
    const hits = flagReferences(
      paths.map((path) => ({ path, text: read(path) ?? "" })),
      name,
    )
    if (hits.length > 0) {
      refuse(`gtd land: cleanup: ${hits.join(", ")} still names GTD_FLAG_${name.toUpperCase()}`)
    }
  }
  await scope("cleanup", async () => {
    await agent("removing", removingPrompt(name, registry), {
      label: `Removing ${name}`,
      model: coder(),
    })
    guard()
    scanned = true
  })
  await handOffTail(false, start(), guard)
}

export const cleanup = flagShipped(cleanupFlow, {
  cleanup: {
    args: [{ name: "flag" }],
    vars: ({ flag }) => ({ flag: flag ?? "" }),
  },
})
