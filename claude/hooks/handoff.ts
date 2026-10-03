// Multiplayer gtd: a process is entirely git, so handing it to someone else is
// pushing the branch and telling them. `throw` opens (or refreshes) a draft
// pull request for the hand-off; `catch` checks it out wherever it was thrown.

import { pushBranch, THROWN } from "./ship"
import type { ShipIo, Shipped } from "./ship"

export type Rest = { state?: string; label?: string; content?: string; isIdle: boolean }

const fail = (text: string): Shipped => ({ ok: false, text })

export async function throwTo(
  io: ShipIo,
  rest: Rest,
  target: string | undefined,
  now: string,
): Promise<Shipped> {
  const git = async (...args: string[]) => (await io.run(["git", ...args])).out.trim()
  if (rest.isIdle) return fail("Nothing is in progress, so there is nothing to throw.")
  // Only landed state travels: an edit still in the tree is half an answer.
  if (await git("status", "--porcelain")) {
    return fail("The working tree has edits. Proceed to land them, or stash them, then throw.")
  }
  let branch = await git("rev-parse", "--abbrev-ref", "HEAD")
  if (!branch || branch === "HEAD") return fail("Detached HEAD: there is no branch to throw.")
  const head = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
  const baseBranch = head.replace(/^origin\//, "") || "main"
  if (branch === baseBranch) {
    branch = `gtd/${now.replace(/[-:]/g, "").replace("T", "-").slice(0, 13)}`
    const switched = await io.run(["git", "switch", "-c", branch])
    if (switched.code !== 0) return fail(`Could not create ${branch}.\n${switched.err}`)
    io.log(`Moved the process onto a new branch, ${branch}.`)
  }
  const pushed = await pushBranch(io, branch)
  if (pushed) return fail(pushed)

  const at = rest.label ? `${rest.state} (${rest.label})` : (rest.state ?? "a gate")
  const body = `${THROWN}
This gtd process was thrown at **${at}** and waits for whoever catches it.

Catch it in Claude Code with the gtd mod:

\`\`\`
/gtd catch ${branch}
\`\`\`

or without it: \`gh pr checkout ${branch} && gtd next\`.

<details><summary>What the process is waiting for</summary>

${(rest.content ?? "").slice(0, 6000)}

</details>
`
  const view = await io.run([
    "gh",
    "pr",
    "view",
    branch,
    "--json",
    "number,url,state,body,assignees",
  ])
  let pr: {
    number: number
    url: string
    state?: string
    body?: string
    assignees?: { login: string }[]
  }
  if (view.code === 0) {
    pr = JSON.parse(view.out)
    if (pr.state !== "OPEN") return fail(`The pull request for ${branch} is ${pr.state}, not open.`)
    // A pull request someone opened for review keeps its own description.
    if (pr.body?.includes(THROWN)) {
      await io.run(["gh", "pr", "edit", String(pr.number), "--body-file", "-"], body)
    }
    await io.run(["gh", "pr", "ready", String(pr.number), "--undo"])
  } else {
    const created = await io.run(
      [
        "gh",
        "pr",
        "create",
        "--draft",
        "--head",
        branch,
        "--base",
        baseBranch,
        "--title",
        `wip: ${branch} — ${rest.label ?? rest.state}`,
        "--body-file",
        "-",
      ],
      body,
    )
    if (created.code !== 0) return fail(`gh pr create failed; nothing was opened.\n${created.err}`)
    const url = created.out.trim()
    pr = { number: Number(url.split("/").pop()), url }
  }

  const n = String(pr.number)
  if (target) {
    const handle = target.replace(/^@/, "")
    const stale = (pr.assignees ?? []).map((a) => a.login).filter((login) => login !== handle)
    const args = ["gh", "pr", "edit", n, "--add-assignee", handle]
    for (const login of stale) args.push("--remove-assignee", login)
    const assigned = await io.run(args)
    if (assigned.code !== 0) {
      return fail(`Thrown to ${pr.url}, but assigning @${handle} failed.\n${assigned.err}`)
    }
  }
  const to = target ? `to @${target.replace(/^@/, "")}` : "to anyone"
  await io.run(
    ["gh", "pr", "comment", n, "--body-file", "-"],
    `Thrown ${to} at **${at}**. Catch it with \`/gtd catch ${branch}\`.\n`,
  )
  return { ok: true, text: `Thrown ${to}: ${pr.url}` }
}

export async function catchFrom(io: ShipIo, ref: string): Promise<Shipped> {
  if ((await io.run(["git", "status", "--porcelain"])).out.trim()) {
    return fail("The working tree has edits. Commit or stash them before catching.")
  }
  const checkout = await io.run(["gh", "pr", "checkout", ref])
  if (checkout.code !== 0) return fail(`Could not check out ${ref}.\n${checkout.err}`)
  const view = await io.run(["gh", "pr", "view", ref, "--json", "number,url"])
  if (view.code === 0) {
    const pr = JSON.parse(view.out) as { number: number; url: string }
    await io.run(["gh", "pr", "edit", String(pr.number), "--add-assignee", "@me"])
    await io.run(["gh", "pr", "comment", String(pr.number), "--body", "Caught."])
    return { ok: true, text: `Caught ${pr.url}` }
  }
  return { ok: true, text: `Checked out ${ref}.` }
}
