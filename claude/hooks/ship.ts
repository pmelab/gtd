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

async function resolveRef(ok: Ok, baseBranch: string): Promise<string | undefined> {
  for (const candidate of [baseBranch, `origin/${baseBranch}`]) {
    if (await ok("rev-parse", "--verify", "--quiet", candidate)) return candidate
  }
  return undefined
}

export async function defaultBranch(git: (...args: string[]) => Promise<string>) {
  const head = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
  return head.replace(/^origin\//, "") || "main"
}

async function preflight(git: Git, ok: Ok) {
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD")
  if (!branch || branch === "HEAD") return { refusal: "Detached HEAD: there is no branch to ship." }
  const baseBranch = await defaultBranch(git)
  if (branch === baseBranch) return { refusal: `You are on the default branch (${baseBranch}).` }
  const baseRef = await resolveRef(ok, baseBranch)
  if (!baseRef)
    return { refusal: `There is no ref '${baseBranch}' (tried origin/${baseBranch} too).` }
  // `reset --soft` would fold pending changes into the squash without saying so.
  if (await git("status", "--porcelain"))
    return { refusal: "The working tree is dirty. Commit or stash first." }
  return { branch, baseBranch, baseRef }
}

export async function ship(io: ShipIo, isDry: boolean, rawMode?: string): Promise<Shipped> {
  const mode = shipMode(rawMode)
  if (typeof mode === "object") return fail(mode.refusal)
  const git = async (...args: string[]) => (await io.run(["git", ...args])).out.trim()
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0

  const pre = await preflight(git, ok)
  if ("refusal" in pre) return fail(pre.refusal)
  const { branch, baseBranch, baseRef } = pre

  // Read before any squash: the record names the slice branches a PR may sit on.
  // A retired record (see below) counts too, so a retry still retargets the PR.
  const live = names(await git("config", "--local", "--get", STACK_KEY(branch)))
  const retired = names(await git("config", "--local", "--get", RETIRED_KEY(branch)))
  const recorded = [...live, ...retired]
  const squashed = await squash(io, git, ok, branch, baseBranch, isDry, mode)
  if (!squashed.ok) return squashed
  // Until the PR step succeeds the record only moves aside: a retry must not
  // resume the stack this ship dropped, yet must still find its slice bases.
  if (squashed.forget && live.length && !isDry) await retireStack(io, branch, live)
  const { stack, floor } = squashed
  if (stack && isDry) {
    const text = await stackPreview(
      io,
      stack,
      baseBranch,
      squashed.messages,
      squashed.history,
      squashed.restack,
    )
    if (typeof text !== "string") return fail(text.refusal)
    return withWarning({ ok: true, text }, squashed.warning)
  }
  if (isDry)
    return preview(io, git, branch, baseRef, squashed.text, squashed.history, squashed.warning)
  const opened = stack
    ? await stackPullRequests(io, git, ok, stack, baseBranch, baseRef, floor)
    : await pullRequest(io, git, ok, branch, baseBranch, baseRef, recorded)
  // A stale retired record must not take a stack this ship just recorded with it.
  if (opened.ok) await settleRecords(io, branch, squashed, live.length > 0, retired.length > 0)
  return withWarning(opened, squashed.warning)
}

async function settleRecords(
  io: ShipIo,
  branch: string,
  squashed: { forget?: boolean; recorded?: boolean },
  hadLive: boolean,
  hadRetired: boolean,
): Promise<void> {
  if (squashed.forget) return forgetStack(io, branch)
  if (hadRetired && (!hadLive || squashed.recorded))
    await io.run(["git", "config", "--local", "--unset", RETIRED_KEY(branch)])
}

function withWarning(r: Shipped, warning?: string): Shipped {
  return warning ? { ...r, text: [r.text, warning].filter(Boolean).join("\n\n") } : r
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
    const summary = await io.run(["gtd", "summary", `--slice=${g.name}`])
    if (summary.code !== 0)
      return fail(
        `gtd summary --slice=${g.name} failed; nothing changed.\n${summary.err}`.trimEnd(),
      )
    const reply = await io.complete(summary.out + "\n" + COMMIT_FORMAT)
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

// `lease`: origin's sha for the branch, read before a restack rebased it.
type Link = { name: string; branch: string; commit: string; lease?: string }

const STACK_KEY = (branch: string) => `branch.${branch}.gtdStack`
// The commit the stack was built at; missing slice branches are rebuilt off it
// while HEAD still contains it. Only a restack moves it, to a top with one
// commit per lower slice beneath it.
const TOP_KEY = (branch: string) => `branch.${branch}.gtdStackTop`

// Slice names of a moved-aside record, awaiting PR success.
const RETIRED_KEY = (branch: string) => `branch.${branch}.gtdStackRetired`
// Origin's sha before a restack moved the branch; outlives the record so a rejected
// push keeps its lease, and is never cleared by forgetStack.
const LEASE_KEY = (branch: string) => `branch.${branch}.gtdLease`

async function forgetStack(io: ShipIo, branch: string) {
  for (const key of [STACK_KEY, TOP_KEY, RETIRED_KEY])
    await io.run(["git", "config", "--local", "--unset", key(branch)])
}

async function retireStack(io: ShipIo, branch: string, live: string[]) {
  const had = names((await io.run(["git", "config", "--local", "--get", RETIRED_KEY(branch)])).out)
  const union = [...new Set([...had, ...live])]
  const set = await io.run(["git", "config", "--local", RETIRED_KEY(branch), union.join(" ")])
  if (set.code !== 0) return
  await io.run(["git", "config", "--local", "--unset", STACK_KEY(branch)])
  await io.run(["git", "config", "--local", "--unset", TOP_KEY(branch)])
}

const names = (raw: string) => raw.split(/\s+/).filter(Boolean)

// No gtd process at HEAD: nothing to squash, so only a recorded stack can resume.
async function resumeAlone(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  isDry: boolean,
  mode: ShipMode,
): Promise<Shipped & { stack?: Link[]; floor?: string; forget?: boolean; restack?: Restack }> {
  io.log(`No gtd process at HEAD, so nothing is squashed; ${branch} is described as it stands.`)
  if (mode !== "stack") return { ok: true, text: "", forget: true }
  const found = await resumable(io, git, ok, branch, baseBranch, isDry, "HEAD")
  if (typeof found === "string") return fail(found)
  const failed = await found.revive?.()
  if (failed) return fail(failed)
  if (found.restack && !isDry) {
    const moved = await found.restack.run()
    if (typeof moved === "string") return fail(moved)
    return { ok: true, text: "", stack: moved.links, floor: moved.floor, forget: moved.forget }
  }
  return {
    ok: true,
    text: "",
    stack: found.links,
    floor: found.floor,
    forget: found.forget,
    restack: found.restack,
  }
}

async function plan(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  isDry: boolean,
  mode: ShipMode,
): Promise<
  Plan | (Shipped & { stack?: Link[]; floor?: string; forget?: boolean; restack?: Restack })
> {
  const probe = await io.run(["gtd", "summary"])
  if (probe.code !== 0) return resumeAlone(io, git, ok, branch, baseBranch, isDry, mode)
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
  return { groups, base, tip, count }
}

function dryRun(
  groups: Group[],
  fulls: string[],
  history: string | undefined,
  warning: string | undefined,
  stack: Link[] | undefined,
) {
  return {
    ok: true as const,
    text:
      groups.length > 1
        ? fulls.map((f, i) => `[${groups[i]!.name}]\n${f}`).join("\n\n---\n\n")
        : fulls[0]!,
    history,
    warning,
    stack,
    messages: fulls,
  }
}

async function squash(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  isDry: boolean,
  mode: ShipMode,
): Promise<
  Shipped & {
    history?: string
    warning?: string
    stack?: Link[]
    messages?: string[]
    floor?: string
    forget?: boolean
    restack?: Restack
    recorded?: boolean
  }
> {
  const planned = await plan(io, git, ok, branch, baseBranch, isDry, mode)
  if ("ok" in planned) return planned
  const { groups, base, tip, count } = planned
  const many = groups.length > 1
  const stacked = mode === "stack" && many

  // Before the history push: a refusal changes nothing.
  const resume = await stackReads(io, git, ok, branch, baseBranch, planned, isDry, mode)
  if (typeof resume === "string") return fail(resume)
  io.log(`Squashing ${count} commit(s) since ${short(base)} into ${groups.length} commit(s)…`)
  const msgs = await commitMessages(io, git, groups, tip)
  if (!msgs.ok) return msgs
  const { fulls, history } = msgs
  const warn = () => (mode === "commits" && many ? rebaseWarning(io) : undefined)
  if (resume?.links)
    return squashOntoStack(io, git, ok, groups[0]!, fulls[0]!, history, resume, isDry, tip)
  if (isDry)
    return dryRun(
      groups,
      fulls,
      history,
      await warn(),
      stacked ? sliceLinks(branch, groups, []) : undefined,
    )

  const pushed = await pushHistory(io, history)
  if (pushed) return fail(pushed)
  return land(io, git, ok, branch, groups, fulls, stacked, await warn())
}

async function land(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  groups: Group[],
  fulls: string[],
  stacked: boolean,
  warning: string | undefined,
): Promise<Awaited<ReturnType<typeof squash>>> {
  if (groups.length === 1) {
    const one = await commitSquash(io, git, ok, groups[0]!.base, fulls[0]!)
    return one.ok ? { ...one, forget: true } : one
  }
  const built = await commitChain(io, git, ok, groups, fulls)
  if (!built.ok) return built
  // a record of an earlier stack must not outlive this ship
  if (!stacked) return { ok: true, text: "", warning, forget: true }
  const stack = sliceLinks(branch, groups, built.commits)
  const recorded = await recordStack(io, ok, branch, stack)
  return recorded ? fail(recorded) : { ok: true as const, text: "", stack, recorded: true }
}

const sliceLinks = (branch: string, groups: Group[], commits: string[]): Link[] =>
  groups.map((g, i) => ({
    name: g.name,
    branch: i < groups.length - 1 ? `${branch}-${g.name}` : branch,
    commit: commits[i] ?? "",
  }))

async function stackReads(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  { groups, base }: Plan,
  isDry: boolean,
  mode: ShipMode,
): Promise<Resumed | string | undefined> {
  if (mode !== "stack") return undefined
  if (groups.length > 1) return await stackPrecheck(io, git, ok, branch, baseBranch, groups)
  return resumable(io, git, ok, branch, baseBranch, isDry, base)
}

// One slice on a recorded stack: its commit becomes the new top of the stack, and
// the record, including the recorded top the missing-branch fallbacks read, stays.
async function squashOntoStack(
  io: ShipIo,
  git: Git,
  ok: Ok,
  group: Group,
  full: string,
  history: string | undefined,
  resume: Resumed,
  isDry: boolean,
  preShip: string,
) {
  const links = resume.links!
  const top = links.length - 1
  if (isDry) {
    const messages = links.map((_, i) => (i === top ? full : ""))
    return {
      ...dryRun([group], [full], history, undefined, links),
      messages,
      restack: resume.restack,
    }
  }
  const pushed = await pushHistory(io, history)
  if (pushed) return fail(pushed)
  const one = await commitSquash(io, git, ok, group.base, full)
  if (!one.ok) return one
  const failed = await resume.revive?.()
  if (failed) return fail(failed)
  if (resume.restack) {
    const moved = await resume.restack.run(preShip)
    if (typeof moved === "string") return fail(moved)
    return {
      ok: true as const,
      text: "",
      stack: moved.links,
      floor: moved.floor,
      forget: moved.forget,
    }
  }
  const head = await git("rev-parse", "HEAD")
  const stack = links.map((l, i) => (i === top ? { ...l, commit: head } : l))
  return { ok: true as const, text: "", stack, floor: resume.floor }
}

async function recordStack(io: ShipIo, ok: Ok, branch: string, stack: Link[]) {
  const top = await io.run(["git", "config", "--local", TOP_KEY(branch), stack.at(-1)!.commit])
  const recorded =
    top.code !== 0
      ? top
      : await io.run([
          "git",
          "config",
          "--local",
          STACK_KEY(branch),
          stack.map((l) => l.name).join(" "),
        ])
  if (recorded.code !== 0) {
    // Without the record a retry would ship one pull request: put the process back.
    // The two keys only ever exist as a matched pair.
    await forgetStack(io, branch)
    const undone = await ok("reset", "--soft", "ORIG_HEAD")
    return `git config failed; ${undone ? "the squash is undone, retry" : "the squash is kept, but a retry will not find the stack"}.\n${recorded.err}`.trimEnd()
  }
  for (const l of stack.slice(0, -1)) {
    if (!(await ok("branch", "-f", l.branch, l.commit)))
      return `git branch -f ${l.branch} failed; the squash is kept. /gtd ship resumes.`
  }
  return undefined
}

type View = {
  number: number
  title?: string
  body?: string
  url: string
  state: string
  baseRefName?: string
}

// gh's stderr for a branch with no PR (cli/cli pr view); tests script it by this.
export const NO_PR_FOUND = "no pull requests found"

// `gh pr view <branch>`: only NO_PR_FOUND reads as none; any
// other failure (auth, network) must refuse, or ship would open a duplicate PR.
async function viewPr(io: ShipIo, branch: string): Promise<View | undefined | string> {
  const v = await io.run([
    "gh",
    "pr",
    "view",
    branch,
    "--json",
    "number,title,body,url,state,baseRefName",
  ])
  if (v.code !== 0) {
    if (v.err.includes(NO_PR_FOUND)) return undefined
    return `gh pr view ${branch} failed: ${v.err.trim()}`
  }
  try {
    return JSON.parse(v.out) as View
  } catch {
    return `gh pr view ${branch} returned something unreadable.`
  }
}

// `dead` names belong to a retired record gtd built itself: not a collision.
async function takenSlice(git: Git, ok: Ok, branch: string, groups: Group[], dead: string[]) {
  for (const g of groups.slice(0, -1)) {
    if (dead.includes(g.name)) continue
    const b = `${branch}-${g.name}`
    if (
      (await ok("rev-parse", "--verify", "--quiet", `refs/heads/${b}`)) ||
      (await ok("rev-parse", "--verify", "--quiet", `origin/${b}`))
    )
      return `Branch ${b} (slice ${g.name}) already exists and is not part of a stack gtd built; nothing changed. Rename or delete it, then ship.`
  }
  return undefined
}

async function recordedRefusal(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  recorded: string[],
): Promise<string | undefined> {
  // The staleness test a resume uses: a dead record is not a live stack.
  const quiet = { ...io, log: () => {} }
  const found = await resumable(quiet, git, ok, branch, baseBranch, true, "HEAD", false)
  // resumable refuses (a missing branch, a closed slice PR) before it tests the
  // chain; only a record that still chains to HEAD may refuse a fresh stack.
  if (typeof found === "string")
    return (await chainsToHead(git, ok, branch, recorded)) ? found : undefined
  if (!found.forget)
    return `${branch} already has a recorded stack (${recorded.join(", ")}); nothing changed. Ship with GTD_SHIP_MODE=commits, or run git config --local --unset branch.${branch}.gtdStack and git config --local --unset branch.${branch}.gtdStackTop, delete or rename the ${branch}-<slice> branches, then ship again.`
  return undefined
}

async function chainsToHead(git: Git, ok: Ok, branch: string, recorded: string[]) {
  const top = await git("config", "--local", "--get", TOP_KEY(branch))
  const held = top && (await ok("merge-base", "--is-ancestor", top, "HEAD")) ? top : ""
  return (await chain(git, ok, branch, recorded, 0, held, "HEAD")).valid
}

async function prStateRefusal(
  io: ShipIo,
  branch: string,
  groups: Group[],
): Promise<string | undefined> {
  for (const [i, g] of groups.entries()) {
    const top = i === groups.length - 1
    const b = top ? branch : `${branch}-${g.name}`
    const view = await viewPr(io, b)
    if (typeof view === "string") return `${view} Nothing changed.`
    // Commits mode ships to the top branch too, so for it only a rename helps.
    if (view && view.state !== "OPEN")
      return `The pull request for slice ${g.name} (#${view.number}, ${b}) is ${view.state}, not open; nothing changed. ${top ? "Rename the branch" : "Ship with GTD_SHIP_MODE=commits, or rename the branch"}.`
  }
  return undefined
}

// Before the history push: a refusal leaves the repository exactly as it was.
async function stackPrecheck(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  groups: Group[],
): Promise<string | undefined> {
  const recorded = names(await git("config", "--local", "--get", STACK_KEY(branch)))
  if (recorded.length) {
    const refused = await recordedRefusal(io, git, ok, branch, baseBranch, recorded)
    if (refused) return refused
  }
  const retired = names(await git("config", "--local", "--get", RETIRED_KEY(branch)))
  const taken = await takenSlice(git, ok, branch, groups, [...recorded, ...retired])
  if (taken) return taken
  return prStateRefusal(io, branch, groups)
}

// A missing branch is read off the recorded top, not HEAD: the top slice may span
// several commits after a re-ship.
async function chain(
  git: Git,
  ok: Ok,
  branch: string,
  recorded: string[],
  from: number,
  top: string,
  at: string,
) {
  const commits: string[] = []
  const missing: number[] = []
  let valid = true
  for (let i = from; i < recorded.length - 1; i++) {
    let sha = await git("rev-parse", "--verify", "--quiet", `refs/heads/${branch}-${recorded[i]}`)
    if (!sha && top) {
      sha = await git("rev-parse", "--verify", "--quiet", `${top}~${recorded.length - 1 - i}`)
      missing.push(i)
    }
    if (!sha) valid = false
    commits.push(sha)
  }
  for (const [i, c] of commits.entries()) {
    if (!valid) break
    if (!(await ok("merge-base", "--is-ancestor", c, commits[i + 1] ?? at))) valid = false
  }
  return { commits, missing, valid }
}

// Rebuilding a branch from <top>~n is only safe while HEAD still contains the
// recorded top, which only a restack moves.
async function topGuard(
  git: Git,
  ok: Ok,
  branch: string,
  recorded: string[],
  from: number,
): Promise<{ top: string } | { rebased: true; top: string } | { refusal: string }> {
  let missing = ""
  for (const name of recorded.slice(from, -1)) {
    const b = `${branch}-${name}`
    if (await ok("rev-parse", "--verify", "--quiet", `refs/heads/${b}`)) continue
    missing = b
    break
  }
  if (!missing && !from) return { top: "" }
  const top = await git("config", "--local", "--get", TOP_KEY(branch))
  if (top && (await ok("merge-base", "--is-ancestor", top, "HEAD"))) return { top }
  // only the merged floor needs the top: a rebase dropped it, so the stack ends
  if (!missing) return { rebased: true, top }
  return {
    refusal: `Slice branch ${missing} is missing and HEAD no longer contains the recorded top of the stack; nothing changed. Ship the branch alone with GTD_SHIP_MODE=commits.`,
  }
}

type Resumed = {
  links?: Link[]
  floor?: string
  forget?: boolean
  revive?: () => Promise<string | undefined>
  // Read-only until run(): the caller runs it after the squash and revive, so
  // "squash first, then restack" holds.
  restack?: Restack
}

type Restack = {
  preview: string[]
  // A string is the failure text; `preShip` is HEAD before this run's squash.
  run(preShip?: string): Promise<{ links: Link[]; floor?: string; forget: boolean } | string>
}

async function mergedSlices(
  io: ShipIo,
  recorded: string[],
  branchOf: (i: number) => string,
  baseBranch: string,
): Promise<{ done: number } | string> {
  const states: (View | undefined)[] = []
  for (const i of recorded.keys()) {
    const view = await viewPr(io, branchOf(i))
    if (typeof view === "string") return `${view} Nothing changed.`
    states.push(view)
  }
  let done = 0
  while (done < recorded.length - 1 && states[done]?.state === "MERGED") {
    const view = states[done]!
    // Merged into another slice branch, it never reached the default branch.
    if (view.baseRefName !== baseBranch)
      return `The pull request for slice ${recorded[done]} (#${view.number}, ${branchOf(done)}) merged into ${view.baseRefName ?? "no base"}, not ${baseBranch}; nothing changed. Ship the branch alone with GTD_SHIP_MODE=commits.`
    done++
  }
  for (const [i, view] of states.entries()) {
    if (i >= done && view && view.state !== "OPEN")
      return `The pull request for slice ${recorded[i]} (#${view.number}, ${branchOf(i)}) is ${view.state}, not open; nothing changed. ${i === recorded.length - 1 ? "Rename the branch" : "Merged slices drop out of a resumed stack on their own; a closed one needs GTD_SHIP_MODE=commits to ship the branch alone"}.`
  }
  return { done }
}

// Every read happens before any write, so a refusal (a string) changes nothing.
// `revive` is left to the caller so a squash can come first. `planRestack` false
// skips the network and worktree reads a restack needs: a caller that only asks
// whether the record is live must not depend on them. A hand-restacked record
// is still live then: its shape test is local.
async function resumable(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  isDry: boolean,
  at: string,
  planRestack = true,
): Promise<Resumed | string> {
  const recorded = names(await git("config", "--local", "--get", STACK_KEY(branch)))
  if (!recorded.length) return {}
  const last = recorded.length - 1
  const branchOf = (i: number) => (i < last ? `${branch}-${recorded[i]}` : branch)
  const merged = await mergedSlices(io, recorded, branchOf, baseBranch)
  if (typeof merged === "string") return merged
  const { done } = merged
  const guard = await topGuard(git, ok, branch, recorded, done)
  if ("refusal" in guard) return guard.refusal
  const { top } = guard
  const { commits, missing, valid } = await chain(git, ok, branch, recorded, done, top, at)
  if (valid && "rebased" in guard && done) {
    const { from, links } = await stackRest(git, { branch, recorded, done, top, commits, branchOf })
    const hand =
      from &&
      (await handRestack(io, git, ok, {
        branch,
        baseBranch,
        top,
        from,
        links,
        merged: recorded.slice(0, done),
        plan: planRestack,
      }))
    if (hand) return hand
  }
  if (!valid || "rebased" in guard) {
    io.log(
      `The recorded stack for ${branch} no longer chains to HEAD: ${isDry ? "" : "dropped it, "}shipping the branch alone.`,
    )
    return { forget: true }
  }
  return finishResume(io, git, ok, {
    branch,
    baseBranch,
    recorded,
    done,
    top,
    commits,
    missing,
    isDry,
    planRestack,
    branchOf,
  })
}

// `from` is the merged slice's commit, read off the recorded top: the local
// slice branch may have moved since.
async function stackRest(
  git: Git,
  c: {
    branch: string
    recorded: string[]
    done: number
    top: string
    commits: string[]
    branchOf: (i: number) => string
  },
): Promise<{ from?: string; links: Link[] }> {
  const { recorded, done, top, commits, branchOf } = c
  const from =
    done && top
      ? (await git(
          "rev-parse",
          "--verify",
          "--quiet",
          `${top}~${recorded.length - 1 - (done - 1)}`,
        )) || undefined
      : undefined
  const head = await git("rev-parse", "HEAD")
  const links = recorded.slice(done).map((name, j) => ({
    name,
    branch: branchOf(done + j),
    commit: commits[j] ?? head,
  }))
  return { from, links }
}

async function finishResume(
  io: ShipIo,
  git: Git,
  ok: Ok,
  c: {
    branch: string
    baseBranch: string
    recorded: string[]
    done: number
    top: string
    commits: string[]
    missing: number[]
    isDry: boolean
    planRestack: boolean
    branchOf: (i: number) => string
  },
): Promise<Resumed | string> {
  const { branch, baseBranch, recorded, done, commits, missing, isDry, planRestack, branchOf } = c
  const { from, links } = await stackRest(git, c)
  if (done && !from)
    return `The commit of merged slice ${recorded[done - 1]} cannot be found; nothing changed. Ship the branch alone with GTD_SHIP_MODE=commits.`
  const restack =
    done && planRestack
      ? await restackOf(io, git, ok, {
          branch,
          baseBranch,
          from: from!,
          links,
          merged: recorded.slice(0, done),
          isDry,
        })
      : undefined
  if (typeof restack === "string") return restack
  const revive = isDry
    ? undefined
    : async () => {
        for (const i of missing) {
          const b = branchOf(i)
          if (!(await ok("branch", "-f", b, commits[i - done]!)))
            return `git branch -f ${b} failed; /gtd ship resumes.`
        }
        return undefined
      }
  return { links, floor: from, revive, restack }
}

// The lease is origin's sha as read here, never origin/<b>: a fetch rewrites
// that. Checked before any rebase, squash or push, so a refusal changes
// nothing; `known(l, sha)` is a commit of the branch before it was restacked.
async function originLeases(
  io: ShipIo,
  ok: Ok,
  links: Link[],
  known: (l: Link, sha: string) => string,
): Promise<Link[] | string> {
  const read = await io.run([
    "git",
    "ls-remote",
    "origin",
    ...links.map((l) => `refs/heads/${l.branch}`),
  ])
  if (read.code !== 0) return `git ls-remote origin failed; nothing changed.\n${read.err}`.trimEnd()
  const origin = new Map<string, string>()
  for (const line of read.out.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/)
    if (sha && ref?.startsWith("refs/heads/")) origin.set(ref.slice("refs/heads/".length), sha)
  }
  for (const l of links) {
    const sha = origin.get(l.branch)
    if (
      sha &&
      !(
        (await ok("cat-file", "-e", sha)) &&
        (await ok("merge-base", "--is-ancestor", sha, known(l, sha)))
      )
    )
      return `origin/${l.branch} holds commits ${l.branch} lacks; nothing changed. Pull or reconcile ${l.branch}, then ship.`
  }
  return links.map((l) => ({ ...l, lease: origin.get(l.branch) }))
}

const pushLines = (links: Link[]) =>
  links.map((l) =>
    l.lease
      ? `Push: would run git push --force-with-lease=${l.branch}:${l.lease} origin ${l.branch}`
      : `Push: would run git push --set-upstream origin ${l.branch}`,
  )

// `git worktree list` is the one place git says a branch is checked out in
// another worktree, where `rebase --update-refs` silently skips it.
async function checkedOutElsewhere(
  io: ShipIo,
  branches: string[],
): Promise<{ branch: string; path: string } | undefined | string> {
  const listed = await io.run(["git", "worktree", "list", "--porcelain"])
  if (listed.code !== 0)
    return `git worktree list failed; nothing changed.\n${listed.err}`.trimEnd()
  const held = new Map<string, string>()
  let path = ""
  for (const line of listed.out.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length)
    else if (line.startsWith("branch refs/heads/")) {
      const b = line.slice("branch refs/heads/".length)
      if (!held.has(b)) held.set(b, path)
    }
  }
  for (const b of branches) if (held.has(b)) return { branch: b, path: held.get(b)! }
  return undefined
}

// The hand lines of whatever could not be restored: an empty list is a clean rollback.
async function rollback(git: Git, ok: Ok, pre: Map<string, string>, preHead: string) {
  const failed: string[] = []
  for (const [r, sha] of pre) {
    const now = await git("rev-parse", `refs/heads/${r}`)
    if (!(await ok("update-ref", `refs/heads/${r}`, sha, now)))
      failed.push(`git update-ref refs/heads/${r} ${sha} ${now}`)
  }
  if (!(await ok("reset", "--keep", preHead))) failed.push(`git reset --keep ${preHead}`)
  return failed
}

const rollbackFailed = (why: string, failed: string[], undo: string | undefined, err = "") =>
  [
    `${why}, and the rollback failed: slice branches stay rebased and nothing was pushed or recorded. Run by hand, then /gtd ship:`,
    ...failed,
    err,
    undo,
  ]
    .filter(Boolean)
    .join("\n")

// Each remaining lower slice sits one commit above the one below it, and the top
// keeps a commit of its own: a rebase that drops an already-upstream commit exits
// 0 and leaves that branch on `onto` itself.
async function brokenShape(
  git: Git,
  links: Link[],
  branch: string,
  onto: string,
): Promise<string | undefined> {
  const lower = links.filter((l) => l.branch !== branch)
  for (const [i, l] of lower.entries()) {
    const below = i ? lower[i - 1]!.branch : onto
    if ((await git("rev-parse", `${l.branch}~1`)) !== (await git("rev-parse", below))) return l.name
  }
  const under = lower.at(-1)?.branch ?? onto
  if (Number(await git("rev-list", "--count", `${under}..HEAD`)) < 1) return links.at(-1)!.name
  return undefined
}

// --update-refs skips a branch it cannot move; leaving the rest rebased would
// make the next ship see a broken chain and silently drop the stack.
async function unmovedSlice(
  io: ShipIo,
  git: Git,
  ok: Ok,
  c: {
    lower: string[]
    onto: string
    from: string
    pre: Map<string, string>
    preHead: string
    undo: string | undefined
  },
): Promise<string | undefined> {
  const { lower, onto, from, pre, preHead, undo } = c
  for (const b of lower) {
    const at = `refs/heads/${b}`
    const moved =
      (await ok("merge-base", "--is-ancestor", onto, at)) &&
      !(await ok("merge-base", "--is-ancestor", from, at))
    if (moved) continue
    const failed = await rollback(git, ok, pre, preHead)
    if (failed.length) return rollbackFailed(`Slice branch ${b} was not restacked`, failed, undo)
    const held = await checkedOutElsewhere(io, [b])
    const where = typeof held === "object" ? ` (checked out in worktree ${held.path})` : ""
    return [
      `Slice branch ${b} was not restacked${where}; the slice branches and HEAD are restored and nothing was pushed or recorded.`,
      undo,
    ]
      .filter(Boolean)
      .join("\n")
  }
  return undefined
}

// --update-refs also drags any other local branch pointing into the range along,
// and no rollback restores it. Over-refuses a branch sitting on an unsquashed
// top-slice process commit: accepted, a refusal changes nothing.
async function strayBranch(
  git: Git,
  links: Link[],
  merged: string[],
  from: string,
  branch: string,
): Promise<string | undefined> {
  const inRange = new Set((await git("rev-list", `${from}..${branch}`)).split("\n").filter(Boolean))
  if (!inRange.size) return undefined
  const known = new Set([...links.map((l) => l.branch), ...merged.map((n) => `${branch}-${n}`)])
  const refs = await git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/")
  for (const line of refs.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/)
    const b = ref?.replace(/^refs\/heads\//, "")
    if (sha && b && inRange.has(sha) && !known.has(b))
      return `Branch ${b} points into the commits the restack rebases, so git rebase --update-refs would move it too; nothing changed. Move or delete it, then /gtd ship.`
  }
  return undefined
}

const lines = (...parts: (string | undefined)[]) => parts.filter(Boolean).join("\n")

type Rebased = {
  links: Link[]
  branch: string
  rebase: string
  pre: Map<string, string>
  preHead: string
  undo: string | undefined
}

// A non-zero `git rebase`: a conflict is aborted; no rebase dir means either git
// older than 2.38 refused --update-refs, or every pick finished and only the final
// ref update failed, so anything that moved is put back.
async function rebaseFailed(
  io: ShipIo,
  git: Git,
  ok: Ok,
  x: Rebased & { done: Ran },
): Promise<string> {
  const { done, links, branch, rebase, pre, preHead, undo } = x
  const stopped = await git("rev-parse", "--verify", "--quiet", "REBASE_HEAD")
  const dir = await git("rev-parse", "--git-path", "rebase-merge")
  if (!dir || (await io.run(["test", "-d", dir])).code !== 0) {
    let moved = (await git("rev-parse", "HEAD")) !== preHead
    for (const [b, sha] of pre)
      if ((await git("rev-parse", `refs/heads/${b}`)) !== sha) moved = true
    if (!moved) return lines(`git rebase failed; refs are unchanged.\n${done.err}`.trimEnd(), undo)
    const failed = await rollback(git, ok, pre, preHead)
    if (failed.length)
      return rollbackFailed("git rebase failed after moving refs", failed, undo, done.err.trimEnd())
    return lines(
      `git rebase failed after moving refs; the slice branches and HEAD are restored and nothing was pushed or recorded.\n${done.err}`.trimEnd(),
      undo,
    )
  }
  const aborted = await io.run(["git", "rebase", "--abort"])
  const name =
    links.find((l) => l.branch !== branch && l.commit === stopped)?.name ?? links.at(-1)!.name
  const byHand = `Rebase by hand, which restacks every slice branch:\n${rebase}\nthen /gtd ship.`
  if (aborted.code === 0)
    return lines(
      `Slice ${name} failed at restack: git rebase conflicted; tree and refs are as before.`,
      byHand,
      undo,
    )
  return lines(
    `Slice ${name} failed at restack: git rebase conflicted, and git rebase --abort failed too: the repository is mid-rebase. Run git rebase --abort by hand, then rebase by hand, which restacks every slice branch:\n${rebase}\nthen /gtd ship.\n${aborted.err}`.trimEnd(),
    undo,
  )
}

async function shapeRefusal(
  git: Git,
  ok: Ok,
  x: Rebased & { onto: string },
): Promise<string | undefined> {
  const { links, branch, onto, pre, preHead, undo } = x
  const broken = await brokenShape(git, links, branch, onto)
  if (broken === undefined) return undefined
  const why = `Slice ${broken} keeps no commit of its own after the restack (its change is already in ${onto})`
  const failed = await rollback(git, ok, pre, preHead)
  if (failed.length) return rollbackFailed(why, failed, undo)
  return lines(
    `${why}; the slice branches and HEAD are restored and nothing was pushed or recorded. Ship the branch alone with GTD_SHIP_MODE=commits.`,
    undo,
  )
}

// The rebase target is origin's copy: the local default branch is never touched.
async function restackOf(
  io: ShipIo,
  git: Git,
  ok: Ok,
  c: {
    branch: string
    baseBranch: string
    from: string
    links: Link[]
    merged: string[]
    isDry: boolean
  },
): Promise<Restack | string | undefined> {
  const { branch, baseBranch, from, isDry } = c
  const onto = `origin/${baseBranch}`
  if (!isDry) {
    const refspec = `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`
    const fetched = await io.run(["git", "fetch", "origin", refspec])
    if (fetched.code !== 0)
      return `git fetch origin ${refspec} failed; nothing changed.\n${fetched.err}`.trimEnd()
  }
  // A merge commit keeps the slice's commit: only the retarget is left to do.
  if (await ok("merge-base", "--is-ancestor", from, onto)) return undefined
  const lower = c.links.filter((l) => l.branch !== branch).map((l) => l.branch)
  if (lower.length) {
    const held = await checkedOutElsewhere(io, lower)
    if (typeof held === "string") return held
    if (held)
      return `Slice branch ${held.branch} is checked out in worktree ${held.path}, so git rebase --update-refs would skip it; nothing changed. Free it there (git -C '${held.path}' switch --detach), then /gtd ship.`
  }
  const stray = await strayBranch(git, c.links, c.merged, from, branch)
  if (stray) return stray
  const links = await originLeases(io, ok, c.links, (l) => l.commit)
  if (typeof links === "string") return links
  const rebase = `git rebase --update-refs --onto ${onto} ${from} ${branch}`
  const preview = [
    `Restack: would run ${rebase} (planned from the last fetch of ${onto})`,
    ...pushLines(links),
  ]
  const run = async (preShip?: string) => {
    const undo = preShip && `the squash was kept; undo it with git reset --soft ${preShip}`
    const preHead = await git("rev-parse", "HEAD")
    const pre = new Map<string, string>()
    for (const b of lower) pre.set(b, await git("rev-parse", `refs/heads/${b}`))
    const done = await io.run(["git", "rebase", "--update-refs", "--onto", onto, from, branch])
    const x = { links, branch, rebase, pre, preHead, undo }
    if (done.code !== 0) return rebaseFailed(io, git, ok, { ...x, done })
    const failure = await unmovedSlice(io, git, ok, { lower, onto, from, pre, preHead, undo })
    if (failure) return failure
    const broken = await shapeRefusal(git, ok, { ...x, onto })
    if (broken) return broken
    return restacked(io, git, branch, baseBranch, links)
  }
  return { preview, run }
}

// The record shrinks to the remaining slices, before any push: a failed push then
// resumes from a record that matches the rebased refs.
async function restacked(io: ShipIo, git: Git, branch: string, baseBranch: string, links: Link[]) {
  // Before the record shrinks: a push rejected after it must keep its lease on
  // retry, or a fetch + re-ship overwrites a collaborator's commit.
  for (const l of links) {
    if (!l.lease) continue
    const kept = await io.run(["git", "config", "--local", LEASE_KEY(l.branch), l.lease])
    if (kept.code !== 0)
      return `git config failed after the restack; the branches are rebased and /gtd ship picks that up.\n${kept.err}`.trimEnd()
  }
  const moved: Link[] = []
  for (const l of links)
    moved.push({
      ...l,
      commit: await git("rev-parse", l.branch === branch ? "HEAD" : `refs/heads/${l.branch}`),
    })
  const floor = (await git("merge-base", `origin/${baseBranch}`, moved[0]!.branch)) || undefined
  // One slice left ends the stack, through the usual retire-then-forget path.
  if (moved.length === 1) return { links: moved, floor, forget: true }
  const above = moved.at(-2)!.branch
  const first = (await git("rev-list", "--reverse", `${above}..${branch}`)).split("\n")[0]!
  // The record first: a failed top write leaves a stale top that topGuard still
  // guards, where the reverse order leaves the new top with the old names.
  const written = await io.run([
    "git",
    "config",
    "--local",
    STACK_KEY(branch),
    moved.map((l) => l.name).join(" "),
  ])
  const set =
    written.code !== 0
      ? written
      : await io.run(["git", "config", "--local", TOP_KEY(branch), first])
  if (set.code !== 0)
    return `git config failed after the restack; the branches are rebased and /gtd ship picks that up.\n${set.err}`.trimEnd()
  return { links: moved, floor, forget: false }
}

// A re-shipped top spans several commits, so `<lowest>~1` is not on origin: the
// first commit above it must instead be the recorded top's copy, by author, date
// and message (a rebase keeps those, a patch-id would not survive a hand-resolved
// conflict). Any linear branch passes a bare parent test, so that alone would loosen
// the guard against an unrelated rebase.
async function isRecordedTop(git: Git, ok: Ok, onto: string, lowest: string, top: string) {
  if (!top) return false
  const first = (await git("rev-list", "--reverse", `${onto}..${lowest}`)).split("\n")[0]
  if (!first || !(await ok("merge-base", "--is-ancestor", `${first}^`, onto))) return false
  const identity = (sha: string) => git("log", "-1", "--format=%an%x00%ae%x00%at%x00%B", sha)
  const mine = await identity(first)
  return mine !== "" && mine === (await identity(top))
}

// Someone rebased by hand after a conflict. Every condition must hold, or an
// unrelated rebase would turn into a force push: the merged slice's commit is
// off the lowest remaining branch, origin/<default> is under it, and origin's
// copies hold nothing the recorded top lacks. Anything else keeps the
// drop-and-ship-alone rule.
async function handRestack(
  io: ShipIo,
  git: Git,
  ok: Ok,
  c: {
    branch: string
    baseBranch: string
    top: string
    from: string
    links: Link[]
    merged: string[]
    plan: boolean
  },
): Promise<Resumed | string | undefined> {
  const { branch, baseBranch, top, from, links: slices } = c
  const lowest = slices[0]!.branch
  if (await ok("merge-base", "--is-ancestor", from, lowest)) return undefined
  // origin may have moved on since the hand rebase: the lowest branch only has
  // to sit on a commit of origin/<default>.
  const onto = `origin/${baseBranch}`
  if (
    !(await ok("merge-base", "--is-ancestor", `${lowest}~1`, onto)) &&
    !(slices.length === 1 && (await isRecordedTop(git, ok, onto, lowest, top)))
  )
    return undefined
  // A liveness probe needs only the shape: origin is not asked.
  if (!c.plan) return { links: slices, forget: slices.length === 1 }
  // The pre-rebase tips are gone: origin's copies are judged against the recorded
  // top, or pass as a former tip of the local branch. The top is stale once the
  // top branch is re-shipped or restacked with more than one commit above.
  const tips = new Map<string, string[]>()
  for (const s of slices)
    tips.set(
      s.branch,
      (await git("reflog", "show", "--format=%H", `refs/heads/${s.branch}`)).split("\n"),
    )
  const links = await originLeases(io, ok, slices, (l, sha) =>
    tips.get(l.branch)!.includes(sha) ? sha : top,
  )
  if (typeof links === "string") return links
  const restack: Restack = {
    preview: [
      `Restack: spotted a hand restack of ${links.map((l) => l.branch).join(", ")}; no rebase`,
      ...pushLines(links),
    ],
    run: () => restacked(io, git, branch, baseBranch, links),
  }
  const floor = (await git("merge-base", onto, links[0]!.branch)) || undefined
  return { links, floor, forget: links.length === 1, restack }
}

const baseOf = (links: Link[], i: number, baseBranch: string) =>
  i ? links[i - 1]!.branch : baseBranch

async function stackPreview(
  io: ShipIo,
  links: Link[],
  baseBranch: string,
  messages: string[] | undefined,
  history?: string,
  restack?: Restack,
): Promise<string | { refusal: string }> {
  const parts: string[] = restack ? [restack.preview.join("\n")] : []
  for (const [i, l] of links.entries()) {
    const base = baseOf(links, i, baseBranch)
    const view = await viewPr(io, l.branch)
    if (typeof view === "string") return { refusal: `${view} Nothing changed.` }
    const lines = [`[${l.name}]`]
    if (messages?.[i]) lines.push(`Commit message:\n\n${messages[i]}`)
    lines.push(`Branch: ${l.branch}`)
    if (view) {
      lines.push(`Pull request: would refresh ${view.url}.`)
      if (view.baseRefName && view.baseRefName !== base)
        lines.push(`Retarget: would retarget #${view.number} from ${view.baseRefName} to ${base}.`)
    } else lines.push(`Pull request: would open into ${base}.`)
    parts.push(lines.join("\n"))
  }
  if (history) parts.push(`History: would push ${history} to origin.`)
  return parts.join("\n\n---\n\n")
}

const STACKED_ON = /^Stacked on #\d+ — merge that first(?:\r?\n(?:\r?\n)?|$)/

export function stackLine(body: string, below?: number) {
  const rest = body.replace(STACKED_ON, "")
  return below === undefined ? rest : `Stacked on #${below} — merge that first\n\n${rest}`
}

type Pr = Shipped & { number?: number }

async function sliceStep(
  io: ShipIo,
  git: Git,
  ok: Ok,
  l: Link,
  view: View | undefined,
  base: string,
  lowerRef: string,
  ctx: Ctx,
): Promise<Pr | { step: string; why: string }> {
  let done: Pr
  if (!view) done = await createPr(io, git, l.branch, base, lowerRef, ctx)
  else if (view.state !== "OPEN")
    return { step: "pull request", why: `#${view.number} is ${view.state}, not open.` }
  else {
    // Before the thrown split: a thrown draft keeps its THROWN marker if this fails.
    if (view.baseRefName !== base) {
      const moved = await io.run(["gh", "pr", "edit", String(view.number), "--base", base])
      if (moved.code !== 0)
        return {
          step: "retarget",
          why: `gh pr edit --base ${base} failed.\n${moved.err}`.trimEnd(),
        }
    }
    done = view.body?.includes(THROWN)
      ? await createPr(io, git, l.branch, base, lowerRef, ctx, view)
      : await updatePr(io, git, ok, l.branch, ctx, view)
  }
  return done.ok ? done : { step: "pull request", why: done.text }
}

// The writer turns below may touch refs: push only the commit ship built.
async function pushLink(io: ShipIo, git: Git, l: Link, upper: boolean) {
  if (upper && (await git("rev-parse", `refs/heads/${l.branch}`)) !== l.commit)
    return `refs/heads/${l.branch} no longer points at ${short(l.commit)}.`
  return pushBranch(io, l.branch, l.commit, l.lease)
}

async function shipLink(
  io: ShipIo,
  git: Git,
  ok: Ok,
  links: Link[],
  i: number,
  baseBranch: string,
  baseRef: string,
  mergeBase: string,
  below: number | undefined,
): Promise<Pr | { step: string; why: string }> {
  const l = links[i]!
  const lower = i ? links[i - 1]! : undefined
  const base = baseOf(links, i, baseBranch)
  const view = await viewPr(io, l.branch)
  if (typeof view === "string")
    return { step: "pull request", why: `${view} ${l.branch} was not pushed; /gtd ship retries.` }
  const pushed = await pushLink(io, git, l, i < links.length - 1)
  if (pushed) return { step: "push", why: pushed }
  const lowerRef = lower?.branch ?? baseRef
  const ctx: Ctx = { to: l.commit, from: lower?.commit ?? mergeBase, below, stacked: true }
  const done = await sliceStep(io, git, ok, l, view, base, lowerRef, ctx)
  if ("step" in done) return done
  if (done.number === undefined && i < links.length - 1)
    return { step: "pull request", why: "its number could not be read from gh's reply." }
  return done
}

// Bottom first, so each PR can name the number of the one below it. A failure
// keeps every slice that already landed; /gtd ship resumes from the recorded stack.
async function stackPullRequests(
  io: ShipIo,
  git: Git,
  ok: Ok,
  links: Link[],
  baseBranch: string,
  baseRef: string,
  floor?: string,
): Promise<Shipped> {
  const mergeBase = floor ?? (await git("merge-base", baseRef, "HEAD"))
  if (!mergeBase) return fail(`${baseRef} and HEAD share no ancestor.`)
  const landed: string[] = []
  const texts: string[] = []
  let below: number | undefined
  for (const [i, l] of links.entries()) {
    const stop = (step: string, why: string) =>
      fail(
        `Slice ${l.name} failed at ${step}: ${why}\nLanded: ${landed.length ? landed.join(", ") : "none"}. /gtd ship resumes.`,
      )
    const done = await shipLink(io, git, ok, links, i, baseBranch, baseRef, mergeBase, below)
    if ("step" in done) return stop(done.step, done.why)
    below = done.number
    landed.push(l.name)
    texts.push(`[${l.name}] ${done.text}`)
  }
  return { ok: true, text: texts.join("\n\n") }
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

// A slice tip's tree, with `.gtd/` as HEAD holds it: steering files are
// process-private, and a mid-process tip still carries some. Null on failure.
async function sliceTree(io: ShipIo, git: Git, tip: string): Promise<string | null> {
  const gtdOf = (rev: string) => git("rev-parse", "--verify", "--quiet", `${rev}:.gtd`)
  if ((await gtdOf(tip)) === (await gtdOf("HEAD"))) return `${tip}^{tree}`
  const entries = (await io.run(["git", "ls-tree", "-z", tip])).out
    .split("\0")
    .filter((e) => e && e.split("\t")[1] !== ".gtd")
  const gtd = (await io.run(["git", "ls-tree", "-z", "HEAD", ".gtd"])).out.split("\0")[0]
  if (gtd) entries.push(gtd)
  const made = await io.run(["git", "mktree", "-z"], entries.map((e) => `${e}\0`).join(""))
  return made.code === 0 && made.out.trim() ? made.out.trim() : null
}

// Every commit exists before any ref moves, so a failure part-way changes nothing.
// commit-tree skips commit-msg hooks, but signing is carried over.
async function commitChain(
  io: ShipIo,
  git: Git,
  ok: Ok,
  groups: Group[],
  fulls: string[],
): Promise<Shipped & { commits: string[] }> {
  let prev = groups[0]!.base
  const commits: string[] = []
  const sign = (await git("config", "--type=bool", "--get", "commit.gpgSign")) === "true"
  for (const [i, g] of groups.entries()) {
    const clean = await io.run(["git", "stripspace", "--strip-comments"], fulls[i]! + "\n")
    if (clean.code !== 0)
      return { ...fail(`git stripspace failed; nothing changed.\n${clean.err}`), commits }
    const tree = await sliceTree(io, git, g.tip)
    if (!tree)
      return { ...fail(`git mktree failed for slice ${g.name}; nothing changed.`), commits }
    const made = await io.run(
      ["git", "commit-tree", tree, ...(sign ? ["-S"] : []), "-p", prev, "-F", "-"],
      clean.out,
    )
    prev = made.out.trim()
    if (made.code !== 0 || !prev)
      return {
        ...fail(`git commit-tree failed for slice ${g.name}; nothing changed.\n${made.err}`),
        commits,
      }
    commits.push(prev)
  }
  if (!(await ok("reset", "--soft", prev)))
    return { ...fail("git reset failed; nothing changed."), commits }
  io.log(
    `Squashed into ${groups.length} commits: ${await git("log", "-1", "--format=%h %s")}. Undo with git reset --soft ORIG_HEAD.`,
  )
  return { ok: true, text: "", commits }
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
): Promise<Shipped> {
  const mergeBase = await git("merge-base", baseRef, "HEAD")
  const existing = await viewPr(io, branch)
  if (typeof existing === "string") return fail(`${existing} Nothing changed.`)
  const pr = existing
    ? `would refresh ${existing.url}`
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

async function unstack(
  io: ShipIo,
  existing: View,
  baseBranch: string,
  onSlice: boolean,
  strip: boolean,
  edit: boolean,
) {
  if (onSlice) {
    const moved = await io.run(["gh", "pr", "edit", String(existing.number), "--base", baseBranch])
    if (moved.code !== 0)
      return fail(
        `gh pr edit --base ${baseBranch} failed; ${existing.url} is unchanged.\n${moved.err}`.trimEnd(),
      )
  }
  const was = existing.body ?? ""
  const body = strip ? stackLine(was) : was
  if (edit && body !== was) {
    const edited = await io.run(
      ["gh", "pr", "edit", String(existing.number), "--body-file", "-"],
      body,
    )
    if (edited.code !== 0)
      return fail(
        `gh pr edit failed; the stale stack line of ${existing.url} is unchanged.\n${edited.err}`.trimEnd(),
      )
  }
  return { unstacked: onSlice || (edit && body !== was), body: edit ? body : was }
}

async function pullRequest(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  baseBranch: string,
  baseRef: string,
  recorded: string[],
) {
  const mergeBase = await git("merge-base", baseRef, "HEAD")
  if (!mergeBase) return fail(`${baseRef} and HEAD share no ancestor.`)
  if (mergeBase === (await git("rev-parse", "HEAD")))
    return fail(`HEAD is an ancestor of ${baseRef}: nothing to describe.`)

  const existing = await viewPr(io, branch)
  if (typeof existing === "string")
    return fail(
      `${existing} ${branch} was not pushed; the squash and history ref stay, /gtd ship retries.`,
    )
  if (existing && existing.state !== "OPEN")
    return fail(`The pull request for ${branch} is ${existing.state}, not open.`)
  const pushed = await pushBranch(io, branch)
  if (pushed) return fail(pushed)
  if (!existing)
    return createPr(io, git, branch, baseBranch, baseRef, { from: mergeBase, to: "HEAD" })
  // A branch once shipped as a stack keeps the PR aimed at a slice branch; any
  // other base is the author's own and stays.
  const onSlice = recorded.some((n) => existing.baseRefName === `${branch}-${n}`)
  const ctx: Ctx = { from: mergeBase, to: "HEAD" }
  // A thrown draft only ever described a hand-off: ship writes it properly.
  const thrown = existing.body?.includes(THROWN)
  // gtd's own line is safe to strip on the default branch too: GitHub retargets
  // there itself when a lower PR merges.
  const strip = onSlice || existing.baseRefName === baseBranch
  const fixed = await unstack(io, existing, baseBranch, onSlice, strip, !thrown)
  if ("ok" in fixed) return fixed
  if (thrown) return createPr(io, git, branch, baseBranch, baseRef, ctx, existing)
  return updatePr(
    io,
    git,
    ok,
    branch,
    { ...ctx, unstacked: fixed.unstacked },
    { ...existing, body: fixed.body },
  )
}

// A pull request describes what the remote branch holds. A squash rewrote the
// branch, so an existing origin/<branch> needs --force-with-lease. Returns why
// the push failed, or nothing.
export async function pushBranch(io: ShipIo, branch: string, head = "HEAD", lease?: string) {
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0
  // A rejected restack push persisted its lease: a fetch moves the tracking ref, so
  // only the stored sha still tells a collaborator's commit from ours.
  let kept = (await io.run(["git", "config", "--local", "--get", LEASE_KEY(branch)])).out.trim()
  if (lease || !kept) kept = ""
  else {
    // The key may be days old: origin's own sha decides whether it still applies.
    const read = await io.run(["git", "ls-remote", "origin", `refs/heads/${branch}`])
    const at = read.code === 0 ? read.out.trim().split(/\s+/)[0] : undefined
    if (read.code === 0 && !at) {
      // Origin lost the branch: nothing to lease on, so push it fresh.
      await io.run(["git", "config", "--local", "--unset", LEASE_KEY(branch)])
      kept = ""
    } else if (
      at &&
      (await ok("cat-file", "-e", at)) &&
      (await ok("merge-base", "--is-ancestor", at, head))
    )
      // Reconciled: origin's commit is already in what is pushed.
      lease = at
  }
  lease ??= kept || undefined
  const push = async (args: string[], failure: string) => {
    const r = await attempt(io, ["git", "push", ...args])
    if (r.killed)
      return `git push of ${branch} did not finish; nothing was lost. Retry without fetching.\n${r.err}`.trimEnd()
    if (r.code !== 0)
      return (
        `${failure}\n${r.err}`.trimEnd() +
        (kept && /stale info|rejected/.test(r.err)
          ? `\nTo overwrite origin's copy on purpose, run git config --local --unset ${LEASE_KEY(branch)} first.`
          : "")
      )
    if (kept) await io.run(["git", "config", "--local", "--unset", LEASE_KEY(branch)])
    return undefined
  }
  // A restack rewrote the branch: lease on origin's sha (it exists, whatever the
  // tracking ref says), with no ancestor shortcut.
  if (lease) {
    io.log(`Pushing ${branch} to origin…`)
    return push(
      [`--force-with-lease=${branch}:${lease}`, "origin", branch],
      `git push failed: origin/${branch} moved. Pull or reconcile ${branch}, then ship.`,
    )
  }
  if (!(await ok("rev-parse", "--verify", "--quiet", `origin/${branch}`))) {
    io.log(`Pushing ${branch} to origin…`)
    return push(["--set-upstream", "origin", branch], "git push failed.")
  }
  if (!(await ok("merge-base", "--is-ancestor", head, `origin/${branch}`))) {
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
// `--output` writes a file and `branch` with arguments moves refs, so neither is allowed.
// For diff, quotes and backslashes are refused outright: the `..` path check cannot see
// through shell quoting. The other subcommands' flag check still sees through them.
// git diff falls back to --no-index by itself when a path lies outside the work
// tree, so diff refuses absolute, `~` and `..` paths.
export const READ_ONLY_GIT =
  /^git (?!diff\b.*["'\\])(?!diff\b[^;&|<>`$()\n{}*?[\]]*(?:\s["'\\]*(?:[/~]|\.\.(?![^\s/"'\\]))|\/\.\.(?![^\s/"'\\])))(?:(?:log|show|diff|status|rev-parse|rev-list|merge-base)\b(?![^;&|<>`$()\n{}*?[\]]*\s["'\\]*-["'\\]*(?:o|-["'\\]*(?:o["'\\]*u|n["'\\]*o["'\\]*-["'\\]*i|e["'\\]*x["'\\]*t["'\\]*-|t["'\\]*e["'\\]*x["'\\]*t["'\\]*c)))[^;&|<>`$()\n{}*?[\]]*|branch(?:\s+(?:--list|-a|-r|--show-current))*(?:\s+--contains\s+[\w./^~-]+)?)$/

const TITLE = /^(feat|fix|refactor|perf|docs|test|build|ci|chore)(\([\w./-]+\))?!?: \S.{0,70}$/

// Marks a draft pull request `/gtd throw` opened for a hand-off.
export const THROWN = "<!-- gtd:thrown -->"

// unstacked: this run took the PR off a stack, so nothing new is still a success.
type Ctx = { from: string; to: string; stacked?: boolean; below?: number; unstacked?: boolean }

async function createPr(
  io: ShipIo,
  git: Git,
  branch: string,
  baseBranch: string,
  baseRef: string,
  { from: mergeBase, to, stacked, below }: Ctx,
  thrown?: { number: number; url: string },
): Promise<Shipped & { number?: number }> {
  const count = await git("rev-list", "--count", `${mergeBase}..${to}`)
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
${await git("log", "--no-merges", "--reverse", "--format=%H%n%B%n---", `${mergeBase}..${to}`)}

--- DIFF STAT ---
${await git("diff", "--stat", `${mergeBase}..${to}`)}`
  const reply = await io.complete(prompt)
  const out = reply && cleanReply(reply)
  if (!out) return fail("The pull-request turn produced nothing.")
  const [title = "", ...rest] = out.split("\n")
  // The writer read commit messages anyone on the branch wrote: publish only
  // a reply shaped like the title it was asked for.
  if (!TITLE.test(title))
    return fail(`The pull-request turn returned no usable title: ${title.slice(0, 120)}`)
  const written = rest.join("\n").replace(/^\s*\n/, "")
  const body = stacked ? stackLine(written, below) : written
  const head = await git("rev-parse", to)
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
    return {
      ok: true,
      text: `Rewrote ${thrown.url} and marked it ready for review.`,
      number: thrown.number,
    }
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
  await io.run(["git", "config", "--local", `branch.${branch}.prSyncHead`, head])
  const number = /\/pull\/(\d+)/.exec(created.out)?.[1]
  return {
    ok: true,
    text: `Opened ${created.out.trim()}`,
    number: number ? Number(number) : undefined,
  }
}

async function sinceHead(git: Git, ok: Ok, branch: string, mergeBase: string, to: string) {
  const synced = await git("config", "--local", "--get", `branch.${branch}.prSyncHead`)
  const isSynced =
    synced &&
    (await ok("rev-parse", "--verify", "--quiet", `${synced}^{commit}`)) &&
    (await ok("merge-base", "--is-ancestor", synced, to))
  return isSynced ? synced : mergeBase
}

async function updatePr(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  { from: mergeBase, to, stacked, below, unstacked }: Ctx,
  existing: { number: number; body?: string; url: string },
): Promise<Shipped & { number?: number }> {
  const restack = (body: string) => (stacked ? stackLine(body, below) : body)
  const edit = async (body: string) =>
    io.run(["gh", "pr", "edit", String(existing.number), "--body-file", "-"], body)
  // The stack line is re-applied on every refresh, but only written when it changed.
  const restacked = async (pr: { body?: string }, text: string) => {
    const fixed = restack(pr.body ?? "")
    if (fixed === (pr.body ?? "")) return { ok: true, text, number: existing.number }
    const edited = await edit(fixed)
    if (edited.code !== 0)
      return {
        ...fail(
          `gh pr edit failed; the stack line of ${existing.url} is unchanged.\n${edited.err}`,
        ),
        number: existing.number,
      }
    return { ok: true, text, number: existing.number }
  }
  // Only what landed since the last run. A stored head a squash left behind
  // falls back to the whole branch, the only honest range left.
  const since = await sinceHead(git, ok, branch, mergeBase, to)
  // ^mergeBase keeps a synced head from before a main merge from re-weighing
  // the commits that merge brought in.
  const count = Number(await git("rev-list", "--count", `${since}..${to}`, `^${mergeBase}`))
  if (!count && (stacked || unstacked))
    return restacked(existing, `Nothing new since the last ship: ${existing.url}`)
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
${await git("log", "--no-merges", "--reverse", "--format=%H%n%B%n---", `${since}..${to}`, `^${mergeBase}`)}

--- DIFF STAT (whole branch) ---
${await git("diff", "--stat", `${mergeBase}..${to}`)}`
  const reply = await io.complete(prompt)
  const out = reply && cleanReply(reply)
  if (!out) return fail("The pull-request turn produced nothing.")

  // The sync head advances either way: NO-UPDATE is a real answer.
  const sha = await git("rev-parse", to)
  if (/^\s*NO-UPDATE\s*$/.test(out)) {
    await io.run(["git", "config", "--local", `branch.${branch}.prSyncHead`, sha])
    return restacked(
      existing,
      `Nothing at that level changed; the description of ${existing.url} is left alone.`,
    )
  }
  // Appended, dated and anchored to its commit, so the standing text keeps saying what it said.
  const repo = (await io.run(["gh", "repo", "view", "--json", "url", "-q", ".url"])).out.trim()
  const anchor = repo ? `[\`${sha.slice(0, 7)}\`](${repo}/commit/${sha})` : `\`${sha.slice(0, 7)}\``
  const body = restack(`${existing.body ?? ""}\n\n## Update ${io.today()} — ${anchor}\n\n${out}\n`)
  const edited = await edit(body)
  if (edited.code !== 0)
    return fail(`gh pr edit failed; the pull request is unchanged.\n${edited.err}`)
  await io.run(["git", "config", "--local", `branch.${branch}.prSyncHead`, sha])
  return {
    ok: true,
    text: `Appended an update to ${existing.url}:\n\n${out}`,
    number: existing.number,
  }
}
