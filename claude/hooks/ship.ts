// Squash the finished gtd process per slice (one commit for a single slice,
// one per landed slice otherwise), push, and open or refresh the branch's pull
// request. A port of the `ship` fish function: same steps, same prompts, with
// the text turns answered by a subagent of the session.

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

export type ShipMode = "stack" | "commits"

export function shipMode(raw: string | undefined): ShipMode | { refusal: string } {
  if (!raw) return "stack"
  if (raw === "stack" || raw === "commits") return raw
  return { refusal: `GTD_SHIP_MODE must be 'stack' or 'commits', not '${raw}'.` }
}

export type Slice = { name: string; base: string; tip: string; closed: boolean }

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

// The slice's problem as text, or the slice itself.
function checkSlice(raw: Record<string, unknown> | undefined, done: Slice[]): Slice | string {
  const { name, base, tip, closed } = raw ?? {}
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name))
    return `slice name ${JSON.stringify(name)}`
  if (done.some((s) => s.name === name)) return `slice ${name} repeats`
  if (typeof base !== "string" || !HASH.test(base) || typeof tip !== "string" || !HASH.test(tip))
    return `slice ${name} has a malformed commit`
  if (typeof closed !== "boolean") return `slice ${name} has no closed flag`
  const prev = done.at(-1)
  if (prev && prev.tip !== base) return `slice ${name} does not start at ${prev.name}'s tip`
  return { name, base, tip, closed }
}

// `gtd slices --json` is the only place gtd names the process's slice ranges.
export function readSlices(stdout: string): Slice[] | { refusal: string } {
  const bad = (why: string) => ({ refusal: `gtd slices --json is unusable: ${why}.` })
  let doc: { schema?: unknown; slices?: unknown }
  try {
    doc = JSON.parse(stdout)
  } catch {
    return bad("not JSON")
  }
  if (!doc || typeof doc !== "object" || doc.schema !== 1) return bad("schema is not 1")
  if (!Array.isArray(doc.slices) || !doc.slices.length) return bad("no slices")
  const slices: Slice[] = []
  for (const raw of doc.slices as Record<string, unknown>[]) {
    const checked = checkSlice(raw, slices)
    if (typeof checked === "string") return bad(checked)
    slices.push(checked)
  }
  return slices
}

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
sign-off, and no footer trailers except one: when the instructions above
say the change is breaking, end with a literal 'BREAKING CHANGE: <what
breaks>' footer after a blank line. The release tooling reads only that
footer, so a breaking change without it is never released as one.

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

// A rejection becomes `killed`, so the caller can tell a timeout from a refused
// push. Relies on the host's process runner rejecting at its timeout; a spawn
// failure lands here too. Only pushes: any other crashed read must abort the
// ship, not pass as an answer.
const attempt = async (io: ShipIo, argv: string[]): Promise<Ran & { killed: boolean }> => {
  try {
    return { ...(await io.run(argv)), killed: false }
  } catch (err) {
    return { code: 1, out: "", err: err instanceof Error ? err.message : String(err), killed: true }
  }
}

export async function ship(io: ShipIo, isDry: boolean, rawMode?: string): Promise<Shipped> {
  const mode = shipMode(rawMode)
  if (typeof mode === "object") return fail(mode.refusal)
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

  const squashed = await squash(io, git, ok, branch, isDry, mode)
  if (!squashed.ok) return squashed
  if (isDry)
    return preview(io, git, branch, baseRef, squashed.text, squashed.history, squashed.warning)
  const opened = await pullRequest(io, git, ok, branch, baseBranch, baseRef)
  return squashed.warning
    ? { ...opened, text: [opened.text, squashed.warning].filter(Boolean).join("\n\n") }
    : opened
}

type Git = (...args: string[]) => Promise<string>
type Ok = (...args: string[]) => Promise<boolean>

type Group = { name: string; base: string; tip: string }

// Slices that changed a file outside .gtd/ each land a commit; one that did not
// folds into the next landed slice, or the previous when it is last.
async function landed(ok: Ok, slices: Slice[]) {
  const groups: Group[] = []
  let carry: string | undefined
  for (const s of slices) {
    // gtd churns its own steering files every process, so `.gtd/` alone is no change.
    if (await ok("diff", "--quiet", s.base, s.tip, "--", ":(exclude).gtd/")) {
      carry ??= s.base
      continue
    }
    groups.push({ name: s.name, base: carry ?? s.base, tip: s.tip })
    carry = undefined
  }
  if (carry && groups.length) groups.at(-1)!.tip = slices.at(-1)!.tip
  return groups
}

async function rebaseWarning(io: ShipIo) {
  const read = await attempt(io, [
    "gh",
    "repo",
    "view",
    "--json",
    "rebaseMergeAllowed",
    "-q",
    ".rebaseMergeAllowed",
  ])
  if (read.code === 0 && read.out.trim() === "true") return undefined
  return "Warning: commits mode keeps one commit per slice only through a rebase merge, and this repository does not confirm rebase merges are allowed; any other merge method squashes them."
}

// A failure text while the process is not a finished, shippable one.
async function unfinished(io: ShipIo, slices: Slice[]) {
  const state = async () => (await io.run(["gtd", "next", "--json=state"])).out.trim()
  // `gtd summary` also describes a process still underway; shipping that
  // would publish half of it.
  const open = slices.find((s) => !s.closed)
  if (open)
    return `The gtd process is still underway (slice ${open.name} is open, at ${await state()}). Finish it, then ship.`
  const initial = (await io.run(["gtd", "next", "--json=initial"])).out.trim()
  if (initial !== "true")
    return `The gtd process is still underway (at ${await state()}). Finish it, then ship.`
  return undefined
}

async function commitMessages(io: ShipIo, git: Git, groups: Group[], tip: string) {
  const parts: { message: string; trailers: string[] }[] = []
  for (const g of groups) {
    const trailers = costTrailers(await git("log", "--format=%B%n", `${g.base}..${g.tip}`))
    const prompt = (await io.run(["gtd", "summary", `--slice=${g.name}`])).out
    const reply = await io.complete(prompt + "\n" + COMMIT_FORMAT)
    const message = reply && cleanReply(reply)
    if (!message) return fail("The commit-message turn produced nothing.")
    parts.push({ message, trailers })
  }
  const history = await historyRef(io, tip)
  const fulls = parts.map(({ message, trailers }) => {
    const all = history ? [...trailers, `Gtd-History: ${history}`] : trailers
    return all.length ? `${message}\n\n${all.join("\n")}` : message
  })
  return { ok: true as const, fulls, history }
}

type Plan = { groups: Group[]; base: string; tip: string; count: number }

// Either the finished process's landed groups, or the result that ends the ship early.
async function plan(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  isDry: boolean,
  mode: ShipMode,
): Promise<Plan | Shipped> {
  const probe = await io.run(["gtd", "summary"])
  if (probe.code !== 0) {
    io.log(`No gtd process at HEAD, so nothing is squashed; ${branch} is described as it stands.`)
    return { ok: true, text: "" }
  }
  const listed = await io.run(["gtd", "slices", "--json"])
  if (listed.code !== 0) return fail(`gtd slices failed; nothing changed.\n${listed.err}`.trimEnd())
  const slices = readSlices(listed.out)
  if ("refusal" in slices) return fail(`${slices.refusal} Nothing changed.`)

  const underway = await unfinished(io, slices)
  if (underway) return fail(underway)
  const base = slices[0]!.base
  const tip = slices.at(-1)!.tip
  if (tip !== (await git("rev-parse", "HEAD")))
    return fail(`The process tip (${short(tip)}) is not HEAD: something landed since.`)
  const count = Number(await git("rev-list", "--count", `${base}..HEAD`))
  if (!count) return fail(`Nothing to squash: ${short(base)}..HEAD is empty.`)

  const groups = await landed(ok, slices)
  if (!groups.length) return dropProcess(io, ok, base, count, isDry)
  // Replaced by the stack-mode ship; refusing keeps a half-built stack impossible.
  if (mode === "stack" && groups.length > 1)
    return fail("Stack mode for a multi-slice process is not available yet; nothing changed.")
  return { groups, base, tip, count }
}

async function squash(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  isDry: boolean,
  mode: ShipMode,
): Promise<Shipped & { history?: string; warning?: string }> {
  const planned = await plan(io, git, ok, branch, isDry, mode)
  if ("ok" in planned) return planned
  const { groups, base, tip, count } = planned

  io.log(`Squashing ${count} commit(s) since ${short(base)} into ${groups.length} commit(s)…`)
  const msgs = await commitMessages(io, git, groups, tip)
  if (!msgs.ok) return msgs
  const { fulls, history } = msgs
  const many = groups.length > 1
  const warn = () => (mode === "commits" && many ? rebaseWarning(io) : undefined)
  if (isDry) {
    const text = many
      ? fulls.map((f, i) => `[${groups[i]!.name}]\n${f}`).join("\n\n---\n\n")
      : fulls[0]!
    return { ok: true, text, history, warning: await warn() }
  }

  const pushed = await pushHistory(io, history)
  if (pushed) return fail(pushed)
  const built = many
    ? await commitChain(io, git, ok, groups, fulls)
    : await commitSquash(io, git, ok, groups[0]!.base, fulls[0]!)
  if (!built.ok) return built
  return { ok: true, text: "", warning: await warn() }
}

async function dropProcess(
  io: ShipIo,
  ok: Ok,
  base: string,
  count: number,
  isDry: boolean,
): Promise<Shipped> {
  if (isDry)
    return { ok: true, text: `No file changes outside .gtd/: would drop ${count} commit(s).` }
  if (!(await ok("reset", "--hard", base))) return fail("git reset failed; nothing changed.")
  io.log(
    `No file changes outside .gtd/: dropped ${count} commit(s). Undo with git reset --hard ORIG_HEAD.`,
  )
  return { ok: true, text: "" }
}

// Before the squash: a failure leaves the branch as it was, so a retry finds the process.
async function pushHistory(io: ShipIo, history: string | undefined) {
  if (!history) return undefined
  // Forced so a retry after the tip changed lands. The ref is keyed by the entry
  // commit, which every clone of the process shares: a second clone shipping the
  // same entry replaces origin's copy.
  io.log(`Pushing ${history} to origin: the process's step commits become fetchable there.`)
  const pushed = await attempt(io, ["git", "push", "origin", `+${history}:${history}`])
  if (pushed.killed)
    return `git push of ${history} did not finish; nothing was squashed. Retry.\n${pushed.err}`.trimEnd()
  if (pushed.code !== 0)
    return `git push of ${history} failed; nothing was squashed or pushed.\n${pushed.err}`.trimEnd()
  return undefined
}

async function commitSquash(
  io: ShipIo,
  git: Git,
  ok: Ok,
  base: string,
  full: string,
): Promise<Shipped> {
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

// Every commit exists before any ref moves, so a failure part-way changes nothing.
async function commitChain(
  io: ShipIo,
  git: Git,
  ok: Ok,
  groups: Group[],
  fulls: string[],
): Promise<Shipped> {
  let prev = groups[0]!.base
  for (const [i, g] of groups.entries()) {
    const clean = await io.run(["git", "stripspace", "--strip-comments"], fulls[i]! + "\n")
    if (clean.code !== 0) return fail(`git stripspace failed; nothing changed.\n${clean.err}`)
    const made = await io.run(
      ["git", "commit-tree", `${g.tip}^{tree}`, "-p", prev, "-F", "-"],
      clean.out,
    )
    prev = made.out.trim()
    if (made.code !== 0 || !prev)
      return fail(`git commit-tree failed for slice ${g.name}; nothing changed.\n${made.err}`)
  }
  if (!(await ok("reset", "--soft", prev))) return fail("git reset failed; nothing changed.")
  io.log(
    `Squashed into ${groups.length} commits: ${await git("log", "-1", "--format=%h %s")}. Undo with git reset --soft ORIG_HEAD.`,
  )
  return { ok: true, text: "" }
}

async function historyRef(io: ShipIo, tip: string) {
  const list = await io.run(["gtd", "history", "list", "--json"])
  let entries: { ref?: string; entry?: string; tip?: string }[] = []
  try {
    entries = JSON.parse(list.out)
  } catch {
    // unreadable list reads as no entry
  }
  // The ref becomes a refspec: push it only when it is exactly the full-sha
  // name of its entry (40 hex, or 64 under SHA-256).
  const found = Array.isArray(entries)
    ? entries.find(
        (e) =>
          e.tip === tip &&
          /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(e.entry ?? "") &&
          e.ref === `refs/gtd/history/${e.entry}`,
      )
    : undefined
  if (!found) {
    io.log("No gtd history ref keeps this process: shipping without a Gtd-History trailer.")
    return undefined
  }
  return found.ref
}

async function preview(
  io: ShipIo,
  git: Git,
  branch: string,
  baseRef: string,
  message: string,
  history?: string,
  warning?: string,
) {
  const mergeBase = await git("merge-base", baseRef, "HEAD")
  const existing = await io.run(["gh", "pr", "view", "--json", "url"])
  const pr =
    existing.code === 0 && existing.out.trim()
      ? `would refresh ${JSON.parse(existing.out).url}`
      : `would open a pull request for ${branch} into ${baseRef} (${await git("rev-list", "--count", `${mergeBase}..HEAD`)} commit(s) before the squash)`
  return {
    ok: true,
    text: [
      message && `Commit message:\n\n${message}`,
      warning,
      history && `History: would push ${history} to origin.`,
      `Pull request: ${pr}.`,
    ]
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
  const push = async (args: string[], failure: string) => {
    const r = await attempt(io, ["git", "push", ...args])
    if (r.killed)
      return `git push of ${branch} did not finish; nothing was lost. Retry without fetching.\n${r.err}`.trimEnd()
    if (r.code !== 0) return `${failure}\n${r.err}`.trimEnd()
    return undefined
  }
  if (!(await ok("rev-parse", "--verify", "--quiet", `origin/${branch}`))) {
    io.log(`Pushing ${branch} to origin…`)
    return push(["--set-upstream", "origin", branch], "git push failed.")
  }
  if (!(await ok("merge-base", "--is-ancestor", "HEAD", `origin/${branch}`))) {
    io.log(`Pushing ${branch} to origin…`)
    return push(
      ["--force-with-lease", "origin", branch],
      `git push failed: origin/${branch} moved. Fetch and reconcile first.`,
    )
  }
  return undefined
}

// The shell commands ship's writer may run: it reads commit messages anyone
// on the branch wrote, so read-only git and no shell syntax to chain more on.
export const READ_ONLY_GIT =
  /^git (log|show|diff|status|rev-parse|rev-list|merge-base|branch)\b[^;&|<>`$()\n]*$/

const TITLE = /^(feat|fix|refactor|perf|docs|test|build|ci|chore)(\([\w./-]+\))?!?: \S.{0,70}$/

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
  // The writer read commit messages anyone on the branch wrote: publish only
  // a reply shaped like the title it was asked for.
  if (!TITLE.test(title))
    return fail(`The pull-request turn returned no usable title: ${title.slice(0, 120)}`)
  const body = rest.join("\n").replace(/^\s*\n/, "")
  const head = await git("rev-parse", "HEAD")
  if (thrown) {
    const n = String(thrown.number)
    // Ready first: a failure here leaves the THROWN marker, so a retry comes back.
    const ready = await io.run(["gh", "pr", "ready", n])
    if (ready.code !== 0)
      return fail(`gh pr ready failed; ${thrown.url} is unchanged.\n${ready.err}`)
    const edited = await io.run(
      ["gh", "pr", "edit", n, "--title", title, "--body-file", "-"],
      body + "\n",
    )
    if (edited.code !== 0)
      return fail(
        `gh pr edit failed; ${thrown.url} is marked ready but keeps its thrown title and description.\n${edited.err}`,
      )
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
