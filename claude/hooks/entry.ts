// The workflow's side doors: `fix` repairs a red baseline as its own reviewed
// commit, `review` reviews everything since a base, straight to the review
// tail. `gtd --entry` prints the script that starts the process; running it
// is the driver's job, as with every git write gtd plans.

import type { ShipIo, Shipped } from "./ship"

const fail = (text: string): Shipped => ({ ok: false, text })

export async function enter(io: ShipIo, door: "fix" | "review", base?: string): Promise<Shipped> {
  const args = door === "fix" ? ["--entry", "fix-precheck"] : await reviewArgs(io, base)
  if (typeof args === "string") return fail(args)
  const planned = await io.run(["gtd", ...args])
  if (planned.code !== 0)
    return fail(planned.err.trim() || `gtd ${args.join(" ")} exited ${planned.code}`)
  const started = await io.run(["sh", "-c", planned.out])
  if (started.code !== 0) return fail(`The entry script failed.\n${started.err.trim()}`)
  return {
    ok: true,
    text: door === "fix" ? "Started a fix." : `Started a review since ${args.at(-1)?.slice(-7)}.`,
  }
}

// Reviews the branch since it left `base`, the default branch unless named.
async function reviewArgs(io: ShipIo, base: string | undefined) {
  const git = async (...a: string[]) => (await io.run(["git", ...a])).out.trim()
  const from =
    base || (await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")) || "main"
  const mergeBase = await git("merge-base", from, "HEAD")
  if (!mergeBase) return `There is no common ancestor of ${from} and HEAD to review from.`
  if (mergeBase === (await git("rev-parse", "HEAD")))
    return `Nothing to review: HEAD has no commits beyond ${from}.`
  return ["--entry", "review-gate.check", "--var", `reviewBase=${mergeBase}`]
}
