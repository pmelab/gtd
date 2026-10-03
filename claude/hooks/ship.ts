// Squash the finished gtd process into one commit, push, and open or refresh
// the branch's pull request. A port of the `ship` fish function: same steps,
// same prompts, with the text turns answered by a subagent of the session.

export type Ran = { code: number; out: string; err: string }

export type ShipIo = {
  // argv runs in the repository root; stdin is the child's whole input
  run(argv: string[], stdin?: string): Promise<Ran>
  complete(prompt: string): Promise<string | undefined>
  log(line: string): void
  today(): string
}

export type Shipped = { ok: boolean; text: string }

const fail = (text: string): Shipped => ({ ok: false, text })
const short = (sha: string) => sha.slice(0, 8)

// A cold model told to "print it and nothing else" fences it anyway: drop an
// opening fence and the closer that ends the reply, and blank edges around both.
export function cleanReply(text: string) {
  const lines = text.split("\n")
  const trim = () => {
    while (lines.length && !lines[0]!.trim()) lines.shift()
    while (lines.length && !lines.at(-1)!.trim()) lines.pop()
  }
  trim()
  if (lines.length && /^\s*```/.test(lines[0]!)) {
    lines.shift()
    if (lines.length && /^\s*```\s*$/.test(lines.at(-1)!)) lines.pop()
  }
  trim()
  return lines.join("\n")
}

// gtd stamps each turn commit `Gtd-Cost: <n> [model]`; the squash drops those
// commits, so their sum is re-emitted per model, highest first, in the format
// gtd's own parser reads.
export function costTrailers(log: string) {
  const sum = new Map<string, number>()
  for (const line of log.split("\n")) {
    const m = /^Gtd-Cost:[ \t]*([0-9][^ \t]*)[ \t]*(.*)$/.exec(line)
    if (!m) continue
    const model = m[2]!.trim() || "unspecified"
    sum.set(model, (sum.get(model) ?? 0) + Number(m[1]))
  }
  return [...sum]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([model, n]) => `Gtd-Cost: ${Number(n.toPrecision(10))} ${model}`)
}

// `gtd summary` is the only place gtd names the process's start parent.
// `gtd base` is the review anchor and would squash only part of the process.
export const summaryRange = (summary: string) =>
  /git log ([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})/.exec(summary)?.slice(1, 3)

const COMMIT_FORMAT = `
--- MESSAGE FORMAT (overrides any formatting the instructions above imply) ---

Write it as a git commit message, not a prose document. Be brief — a
reader scanning 'git log' has seconds, and the diff is right there.

- First line: a Conventional Commit subject — 'type(scope): summary', or
  'type(scope)!: summary' for a breaking change. Types: feat, fix, refactor,
  perf, docs, test, build, ci, chore. Lowercase summary, imperative mood, no
  trailing period, 72 characters or fewer. The scope is optional — include one
  only when a single part of the codebase clearly owns the change.
- Then a blank line.
- Then the body, if the subject does not already say everything — and often
  it does, so drop the body rather than padding it. Ten lines is a lot.

For the body, invoke the show-me skill with the Skill tool if it is available,
then pick the smallest thing that makes the change clear — a call tree, a
shallow file tree, a diff sketch, or four lines of pseudocode — indented as
plain text, with a line of prose before it for the why. Skip the skill's mermaid and
HTML-artifact options and never open a file: a commit message is plain text
in a terminal. Plain prose is the right answer too when there is no shape to
draw; then keep it to a paragraph, wrapped at 72 columns.

No markdown headings, no code fences, no bullet list of changed files, no
sign-off, no footer trailers.

NOTHING REVIEWS THIS BEFORE IT IS COMMITTED — no editor opens on it. What you
print is the commit message verbatim.

Print the message and nothing else — no code fences, no preamble.`

const DESCRIPTION = `The description is a STANDING statement, not a changelog. It covers exactly three
things, and a reviewer reads it once:

- MOTIVATION — the problem, and why it was worth solving.
- SOLUTION — the shape of the approach at a VERY high level. A few sentences.
  Not a walkthrough: the diff is one click away.
- DECISIONS — the choices a reviewer would otherwise stop and question, and what
  each one traded away.

Nothing else. No file-by-file list, no per-commit narration, no implementation
detail the diff already shows, no test-plan boilerplate, no sign-off, no footer
trailers. Short headings and lists are fine. Under 250 words.`

export async function ship(io: ShipIo, isDry: boolean): Promise<Shipped> {
  const git = async (...args: string[]) => (await io.run(["git", ...args])).out.trim()
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0

  const branch = await git("rev-parse", "--abbrev-ref", "HEAD")
  if (!branch || branch === "HEAD") return fail("Detached HEAD: there is no branch to ship.")
  const head = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
  const baseBranch = head.replace(/^origin\//, "") || "main"
  if (branch === baseBranch) return fail(`You are on the default branch (${baseBranch}).`)
  let baseRef: string | undefined
  for (const candidate of [baseBranch, `origin/${baseBranch}`]) {
    if (await ok("rev-parse", "--verify", "--quiet", candidate)) {
      baseRef = candidate
      break
    }
  }
  if (!baseRef) return fail(`There is no ref '${baseBranch}' (tried origin/${baseBranch} too).`)
  // `reset --soft` would fold pending changes into the squash without saying so.
  if (await git("status", "--porcelain"))
    return fail("The working tree is dirty. Commit or stash first.")

  const squashed = await squash(io, git, ok, branch, isDry)
  if (!squashed.ok) return squashed
  if (isDry) return preview(io, git, branch, baseRef, squashed.text)
  return pullRequest(io, git, ok, branch, baseBranch, baseRef)
}

type Git = (...args: string[]) => Promise<string>
type Ok = (...args: string[]) => Promise<boolean>

async function squash(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  isDry: boolean,
): Promise<Shipped> {
  const summary = await io.run(["gtd", "summary"])
  if (summary.code !== 0) {
    io.log(`No gtd process at HEAD, so nothing is squashed; ${branch} is described as it stands.`)
    return { ok: true, text: "" }
  }
  const range = summaryRange(summary.out)
  if (!range) return fail("The gtd summary names no commit range, so ship refuses to guess a base.")
  const base = await git("rev-parse", "--verify", `${range[0]}^{commit}`)
  const tip = await git("rev-parse", "--verify", `${range[1]}^{commit}`)
  if (!base || !tip) return fail("The gtd summary's range does not resolve in this repository.")
  if (tip !== (await git("rev-parse", "HEAD"))) {
    return fail(`The process tip (${short(tip)}) is not HEAD: something landed since.`)
  }
  const count = Number(await git("rev-list", "--count", `${base}..HEAD`))
  if (!count) return fail(`Nothing to squash: ${short(base)}..HEAD is empty.`)

  // gtd churns its own steering files every process, so `.gtd/` alone is no change.
  if (await ok("diff", "--quiet", base, "HEAD", "--", ":(exclude).gtd/")) {
    if (isDry)
      return { ok: true, text: `No file changes outside .gtd/: would drop ${count} commit(s).` }
    if (!(await ok("reset", "--hard", base))) return fail("git reset failed; nothing changed.")
    io.log(
      `No file changes outside .gtd/: dropped ${count} commit(s). Undo with git reset --hard ORIG_HEAD.`,
    )
    return { ok: true, text: "" }
  }

  io.log(`Squashing ${count} commit(s) since ${short(base)}…`)
  const trailers = costTrailers(await git("log", "--format=%B%n", `${base}..${tip}`))
  const reply = await io.complete(summary.out + "\n" + COMMIT_FORMAT)
  const message = reply && cleanReply(reply)
  if (!message) return fail("The commit-message turn produced nothing.")
  const full = trailers.length ? `${message}\n\n${trailers.join("\n")}` : message
  if (isDry) return { ok: true, text: full }

  if (!(await ok("reset", "--soft", base))) return fail("git reset failed; nothing changed.")
  const commit = await io.run(["git", "commit", "--cleanup=strip", "-F", "-"], full + "\n")
  if (commit.code !== 0) {
    return fail(
      `git commit failed: the process is staged. git reset --soft ORIG_HEAD puts its commits back.\n${commit.err}`,
    )
  }
  io.log(
    `Squashed: ${await git("log", "-1", "--format=%h %s")}. Undo with git reset --soft ORIG_HEAD.`,
  )
  return { ok: true, text: "" }
}

async function preview(io: ShipIo, git: Git, branch: string, baseRef: string, message: string) {
  const mergeBase = await git("merge-base", baseRef, "HEAD")
  const existing = await io.run(["gh", "pr", "view", "--json", "url"])
  const pr =
    existing.code === 0 && existing.out.trim()
      ? `would refresh ${JSON.parse(existing.out).url}`
      : `would open a pull request for ${branch} into ${baseRef} (${await git("rev-list", "--count", `${mergeBase}..HEAD`)} commit(s) before the squash)`
  return {
    ok: true,
    text: [message && `Commit message:\n\n${message}`, `Pull request: ${pr}.`]
      .filter(Boolean)
      .join("\n\n"),
  }
}

async function pullRequest(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  baseRef: string,
) {
  const mergeBase = await git("merge-base", baseRef, "HEAD")
  if (!mergeBase) return fail(`${baseRef} and HEAD share no ancestor.`)
  if (mergeBase === (await git("rev-parse", "HEAD")))
    return fail(`HEAD is an ancestor of ${baseRef}: nothing to describe.`)

  const pushed = await pushBranch(io, branch)
  if (pushed) return fail(pushed)

  const view = await io.run(["gh", "pr", "view", "--json", "number,title,body,url,state"])
  if (view.code !== 0) return createPr(io, git, branch, baseBranch, baseRef, mergeBase)
  const existing = JSON.parse(view.out) as {
    number: number
    body?: string
    url: string
    state: string
  }
  if (existing.state !== "OPEN")
    return fail(`The pull request for ${branch} is ${existing.state}, not open.`)
  // A thrown draft only ever described a hand-off: ship writes it properly.
  if (existing.body?.includes(THROWN)) {
    return createPr(io, git, branch, baseBranch, baseRef, mergeBase, existing)
  }
  return updatePr(io, git, ok, branch, mergeBase, existing)
}

// A pull request describes what the remote branch holds. A squash rewrote the
// branch, so an existing origin/<branch> needs --force-with-lease. Returns why
// the push failed, or nothing.
export async function pushBranch(io: ShipIo, branch: string) {
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0
  if (!(await ok("rev-parse", "--verify", "--quiet", `origin/${branch}`))) {
    io.log(`Pushing ${branch} to origin…`)
    if (!(await ok("push", "--set-upstream", "origin", branch))) return "git push failed."
  } else if (!(await ok("merge-base", "--is-ancestor", "HEAD", `origin/${branch}`))) {
    io.log(`Pushing ${branch} to origin…`)
    if (!(await ok("push", "--force-with-lease", "origin", branch))) {
      return `git push failed: origin/${branch} moved. Fetch and reconcile first.`
    }
  }
  return undefined
}

// Marks a draft pull request `/gtd throw` opened for a hand-off.
export const THROWN = "<!-- gtd:thrown -->"

async function createPr(
  io: ShipIo,
  git: Git,
  branch: string,
  baseBranch: string,
  baseRef: string,
  mergeBase: string,
  thrown?: { number: number; url: string },
) {
  const count = await git("rev-list", "--count", `${mergeBase}..HEAD`)
  io.log(
    thrown
      ? `#${thrown.number} was thrown as a draft: describing ${count} commit(s) properly…`
      : `No pull request for ${branch} yet: describing ${count} commit(s)…`,
  )
  const prompt = `Write the title and description for a pull request, from the commits below.

Format, exactly:

- First line: the title — a Conventional Commit subject, 'type(scope): summary'
  ('type(scope)!: summary' for a breaking change). Types: feat, fix, refactor,
  perf, docs, test, build, ci, chore. Lowercase summary, imperative mood, no
  trailing period, 72 characters or fewer.
- Then a blank line.
- Then the description.

${DESCRIPTION}

At most ONE visual, and only if the solution has a shape prose cannot carry —
a call tree, a shallow file tree, a box-and-arrow sketch. None is the common
case. Put it in a fenced block (\`\`\`text, or \`\`\`mermaid, which GitHub renders);
an indented block alone does not survive as a block.

NOTHING REVIEWS THIS BEFORE IT IS PUBLISHED — no editor opens on it. What you
print is the pull request verbatim.

Print the title and description and nothing else — no preamble, and no code
fence wrapped around the whole reply.

--- COMMITS ON ${branch} (against ${baseRef}), oldest first ---
${await git("log", "--no-merges", "--reverse", "--format=%H%n%B%n---", `${mergeBase}..HEAD`)}

--- DIFF STAT ---
${await git("diff", "--stat", `${mergeBase}..HEAD`)}`
  const reply = await io.complete(prompt)
  const out = reply && cleanReply(reply)
  if (!out) return fail("The pull-request turn produced nothing.")
  const [title = "", ...rest] = out.split("\n")
  const body = rest.join("\n").replace(/^\s*\n/, "")
  const head = await git("rev-parse", "HEAD")
  if (thrown) {
    const n = String(thrown.number)
    const edited = await io.run(
      ["gh", "pr", "edit", n, "--title", title, "--body-file", "-"],
      body + "\n",
    )
    if (edited.code !== 0)
      return fail(`gh pr edit failed; the pull request is unchanged.\n${edited.err}`)
    await io.run(["gh", "pr", "ready", n])
    await io.run(["git", "config", "--local", `branch.${branch}.prSyncHead`, head])
    return { ok: true, text: `Rewrote ${thrown.url} and marked it ready for review.` }
  }
  const created = await io.run(
    [
      "gh",
      "pr",
      "create",
      "--head",
      branch,
      "--base",
      baseBranch,
      "--title",
      title,
      "--body-file",
      "-",
    ],
    body + "\n",
  )
  if (created.code !== 0) return fail(`gh pr create failed; nothing was opened.\n${created.err}`)
  await io.run([
    "git",
    "config",
    "--local",
    `branch.${branch}.prSyncHead`,
    await git("rev-parse", "HEAD"),
  ])
  return { ok: true, text: `Opened ${created.out.trim()}` }
}

async function updatePr(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  mergeBase: string,
  existing: { number: number; body?: string; url: string },
) {
  // Only what landed since the last run. A stored head a squash left behind
  // falls back to the whole branch, the only honest range left.
  const synced = await git("config", "--local", "--get", `branch.${branch}.prSyncHead`)
  const isSynced =
    synced &&
    (await ok("rev-parse", "--verify", "--quiet", `${synced}^{commit}`)) &&
    (await ok("merge-base", "--is-ancestor", synced, "HEAD"))
  const since = isSynced ? synced : mergeBase
  const count = Number(await git("rev-list", "--count", `${since}..HEAD`))
  if (!count) return fail(`No commits since the last ship: ${existing.url}`)
  io.log(`#${existing.number}: weighing ${count} commit(s) against the standing description…`)

  const prompt = `An open pull request already states the motivation, the high-level solution and
the decisions behind this branch. Its description is below, followed by the
commits added since it was last considered.

Decide ONE thing: do those commits change the MOTIVATION, change the HIGH-LEVEL
SOLUTION, overturn a DECISION already stated, or add a new decision a reviewer
would stop and question?

Ordinary implementation work does not. Nor do fixes, refactors, tests, renames,
polish, or filling in something the description already promised. The honest
answer is almost always NO — that is the point of a description written at this
level, and appending to it for routine work makes it worse.

If NO: print exactly

NO-UPDATE

and nothing else.

If YES: print ONLY the new entry — two or three sentences, or a few bullets,
naming what moved at that level and why. Do not restate the existing
description, do not summarize the commits, do not write a heading (one is added
for you), no preamble, no code fence around the whole reply.

--- CURRENT DESCRIPTION OF PULL REQUEST #${existing.number} ---
${existing.body ?? ""}

--- COMMITS ADDED SINCE IT WAS LAST CONSIDERED, oldest first ---
${await git("log", "--no-merges", "--reverse", "--format=%H%n%B%n---", `${since}..HEAD`)}

--- DIFF STAT (whole branch) ---
${await git("diff", "--stat", `${mergeBase}..HEAD`)}`
  const reply = await io.complete(prompt)
  const out = reply && cleanReply(reply)
  if (!out) return fail("The pull-request turn produced nothing.")

  // The sync head advances either way: NO-UPDATE is a real answer.
  const sha = await git("rev-parse", "HEAD")
  if (/^\s*NO-UPDATE\s*$/.test(out)) {
    await io.run(["git", "config", "--local", `branch.${branch}.prSyncHead`, sha])
    return {
      ok: true,
      text: `Nothing at that level changed; the description of ${existing.url} is left alone.`,
    }
  }
  // Appended, dated and anchored to its commit, so the standing text keeps saying what it said.
  const repo = (await io.run(["gh", "repo", "view", "--json", "url", "-q", ".url"])).out.trim()
  const anchor = repo ? `[\`${sha.slice(0, 7)}\`](${repo}/commit/${sha})` : `\`${sha.slice(0, 7)}\``
  const body = `${existing.body ?? ""}\n\n## Update ${io.today()} — ${anchor}\n\n${out}\n`
  const edited = await io.run(
    ["gh", "pr", "edit", String(existing.number), "--body-file", "-"],
    body,
  )
  if (edited.code !== 0)
    return fail(`gh pr edit failed; the pull request is unchanged.\n${edited.err}`)
  await io.run(["git", "config", "--local", `branch.${branch}.prSyncHead`, sha])
  return { ok: true, text: `Appended an update to ${existing.url}:\n\n${out}` }
}
