import {
  agent,
  changesSince,
  glob,
  head,
  mark,
  read,
  refuse,
  removeScript,
  run,
  scope,
  vars,
} from "../../flows/index.js"
import { gate } from "../shared/health.js"
import { flagShipped } from "../shared/options.js"
import { flagMentions, flipProblems, requireFlag } from "../shared/registry.js"
import { coder, FEEDBACK } from "../shared/steps.js"

const flippingPrompt = (name: string, registry: string): string =>
  `Roll out the release flag "${name}": in ${registry}, set \`defaultOn: true\` on its entry. Change nothing else — no other entry, no other field, no other file, no comments.`

const suiteBlockedMessage = (): string =>
  "The suite is red after the rollout. Fix it by hand — a rollout may only touch the flag's registry entry — then land."

// Marks past this many are dropped; the summary points at grep for the rest.
const MARKED_MENTIONS = 50

// Lists, never edits: the human fixes the now-stale prose, or cleanup does. The
// list rides in marks only: a state file left at idle would be published by
// ship and read as a failed unwind by the next process.
const listMentions = async (registry: string, name: string): Promise<void> => {
  await run("mentions", removeScript([FEEDBACK]), { label: "Listing flag mentions" })
  const files = glob("**")
    .filter((path) => path !== registry && path !== ".gtd" && !path.startsWith(".gtd/"))
    .sort()
    .map((path) => ({ path, text: read(path) ?? "" }))
  const mentions = flagMentions(files, name)
  mark("flag-mentions", String(mentions.length))
  for (const m of mentions.slice(0, MARKED_MENTIONS)) {
    // A path the mark grammar rejects stays counted above, just unlisted here.
    try {
      mark("flag-mention", `${m.path}:${m.line}`)
    } catch {
      continue
    }
  }
}

// No review gate — a one-field change needs no review lap.
export const rolloutFlow = async (): Promise<void> => {
  const registry = vars.flagRegistry ?? ""
  const name = vars.flag ?? ""
  // Before the turn, never after: replay re-runs every pre-turn check.
  requireFlag("rollout", registry, name, false)
  // Strays count from the same point `before` is read at, not `start()`: the opening commit sweeps in whatever the human left uncommitted.
  const base = head()
  const before = read(registry) ?? ""
  const guard = (): void => {
    const strays = changesSince(base).paths.filter((path) => path !== registry && path !== FEEDBACK)
    if (strays.length > 0) {
      refuse(
        `gtd land: rollout-only: ${strays.join(", ")} changed — rollout may only set defaultOn: true on "${name}" in ${registry}`,
      )
    }
    const problems = flipProblems(before, read(registry) ?? "", name)
    if (problems.length > 0) {
      refuse(`gtd land: rollout-only: other edits in ${registry}: ${problems.join("; ")}`)
    }
  }
  await scope("rollout", async () => {
    await agent("flipping", flippingPrompt(name, registry), {
      label: `Rolling out ${name}`,
      model: coder(),
    })
    guard()
    await gate("suite", suiteBlockedMessage(), guard)
    await listMentions(registry, name)
  })
}

export const rollout = flagShipped(rolloutFlow, "rollout")
