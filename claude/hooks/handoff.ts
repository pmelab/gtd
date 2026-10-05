// Multiplayer gtd: a process is entirely git, so handing it to someone else is
// pushing the branch and telling them. `throw` opens (or refreshes) a draft
// pull request for the hand-off; `catch` checks it out wherever it was thrown.

import { pushBranch, THROWN } from "./ship"
import type { ShipIo, Shipped } from "./ship"

export type Rest = { state?: string; label?: string; content?: string; isIdle: boolean }

const fail = (text: string): Shipped => ({ ok: false, text })

type Pr = {
  number: number
  url: string
  state?: string
  body?: string
  assignees?: { login: string }[]
}

export async function throwTo(
  io: ShipIo,
  rest: Rest,
  target: string | undefined,
  now: string,
): Promise<Shipped> {
  if (rest.isIdle) return fail("Nothing is in progress, so there is nothing to throw.")
  // Only landed state travels: an edit still in the tree is half an answer.
  if ((await io.run(["git", "status", "--porcelain"])).out.trim()) {
    return fail("The working tree has edits. Proceed to land them, or stash them, then throw.")
  }
  const on = await throwBranch(io, now)
  if (typeof on === "string") return fail(on)
  const behind = await remoteAhead(io, on.branch)
  if (behind) return fail(behind)
  const pushed = await pushBranch(io, on.branch)
  if (pushed) return fail(pushed)
  const at = rest.label ? `${rest.state} (${rest.label})` : (rest.state ?? "a gate")
  const pr = await draft(io, on.branch, on.base, rest, at)
  if (typeof pr === "string") return fail(pr)
  const handle = target?.replace(/^@/, "")
  if (handle) {
    const assigned = await assign(io, pr, handle)
    if (assigned) return fail(assigned)
  }
  const to = handle ? `to @${handle}` : "to anyone"
  await io.run(
    ["gh", "pr", "comment", String(pr.number), "--body-file", "-"],
    `Thrown ${to} at **${at}**. Catch it with \`/gtd catch ${on.branch}\`.\n`,
  )
  return { ok: true, text: `Thrown ${to}: ${pr.url}` }
}

// The catcher checks out what origin holds, so a throw describing local HEAD
// must not leave origin elsewhere: fetch first, a stale tracking ref can hide
// a teammate's commits or a rewind. Returns why the throw refuses, or nothing.
async function remoteAhead(io: ShipIo, branch: string) {
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0
  if (!(await ok("fetch", "--prune", "origin"))) return "git fetch failed."
  if (!(await ok("rev-parse", "--verify", "--quiet", `origin/${branch}`))) return undefined
  if (await ok("merge-base", "--is-ancestor", `origin/${branch}`, "HEAD")) return undefined
  return `origin/${branch} has commits HEAD lacks. Pull or catch them first, then throw.`
}

// The branch to throw, moving the process off the default branch onto a new
// one when it sits there; a string is why that failed.
async function throwBranch(io: ShipIo, now: string) {
  const git = async (...args: string[]) => (await io.run(["git", ...args])).out.trim()
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD")
  if (!branch || branch === "HEAD") return "Detached HEAD: there is no branch to throw."
  const head = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
  const base = head.replace(/^origin\//, "") || "main"
  if (branch !== base) return { branch, base }
  const fresh = `gtd/${now.replace(/[-:]/g, "").replace("T", "-").slice(0, 13)}`
  const switched = await io.run(["git", "switch", "-c", fresh])
  if (switched.code !== 0) return `Could not create ${fresh}.\n${switched.err}`
  io.log(`Moved the process onto a new branch, ${fresh}.`)
  return { branch: fresh, base }
}

const throwBody = (branch: string, at: string, content = "") => `${THROWN}
This gtd process was thrown at **${at}** and waits for whoever catches it.

Catch it in Claude Code with the gtd mod:

\`\`\`
/gtd catch ${branch}
\`\`\`

or without it: \`gh pr checkout ${branch} && gtd next\`.

<details><summary>What the process is waiting for</summary>

${content.slice(0, 6000)}

</details>
`

// Opens the hand-off's draft, or refreshes a thrown one; a string is why that
// failed.
async function draft(
  io: ShipIo,
  branch: string,
  base: string,
  rest: Rest,
  at: string,
): Promise<Pr | string> {
  const body = throwBody(branch, at, rest.content)
  const view = await io.run([
    "gh",
    "pr",
    "view",
    branch,
    "--json",
    "number,url,state,body,assignees",
  ])
  if (view.code !== 0) {
    const title = `wip: ${branch} — ${rest.label ?? rest.state}`
    const created = await io.run(
      [
        "gh",
        "pr",
        "create",
        "--draft",
        "--head",
        branch,
        "--base",
        base,
        "--title",
        title,
        "--body-file",
        "-",
      ],
      body,
    )
    if (created.code !== 0) return `gh pr create failed; nothing was opened.\n${created.err}`
    const url = created.out.trim()
    return { number: Number(url.split("/").pop()), url }
  }
  const pr = JSON.parse(view.out) as Pr
  if (pr.state !== "OPEN") return `The pull request for ${branch} is ${pr.state}, not open.`
  // A pull request someone opened for review keeps its own description and
  // stays ready: only ship marks a draft ready again, and only a thrown one.
  if (pr.body?.includes(THROWN)) {
    await io.run(["gh", "pr", "edit", String(pr.number), "--body-file", "-"], body)
    await io.run(["gh", "pr", "ready", String(pr.number), "--undo"])
  }
  return pr
}

async function assign(io: ShipIo, pr: Pr, handle: string) {
  const stale = (pr.assignees ?? []).map((a) => a.login).filter((login) => login !== handle)
  const args = ["gh", "pr", "edit", String(pr.number), "--add-assignee", handle]
  for (const login of stale) args.push("--remove-assignee", login)
  const assigned = await io.run(args)
  return assigned.code === 0
    ? undefined
    : `Thrown to ${pr.url}, but assigning @${handle} failed.\n${assigned.err}`
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
