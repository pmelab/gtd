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

// The process's range, from the plain `gtd summary`: it names it as `git log <base>..<tip>`.
const summaryRange = (summary: string) =>
  /git log ([0-9a-f]{7,64})\.\.([0-9a-f]{7,64})/.exec(summary)?.slice(1, 3)

const TYPE_RULE = `- Pick the type from what the change does, never from the branch's name:
  adding or changing a public surface — anything a user, a config or a
  driver reaches: the published package's exports, a command, flag, config
  key, environment variable, workflow step or machine-read output — is feat,
  fix or perf, the types that cut a release. Docs or tests alone change no
  surface; refactor only when no user can tell the difference.`

const COMMIT_FORMAT = `
--- MESSAGE FORMAT (overrides any formatting the instructions above imply) ---

Write it as a git commit message, not a prose document. Be brief — a
reader scanning 'git log' has seconds, and the diff is right there.

- First line: a Conventional Commit subject — 'type(scope): summary', or
  'type(scope)!: summary' for a breaking change. Types: feat, fix, refactor,
  perf, docs, test, build, ci, chore. Lowercase summary, imperative mood, no
  trailing period, 72 characters or fewer. The scope is optional — include one
  only when a single part of the codebase clearly owns the change.
${TYPE_RULE}
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
sign-off, and no footer trailers except two: when the instructions above
say the change is breaking, end with a literal 'BREAKING CHANGE: <what
breaks>' footer after a blank line. The release tooling reads only that
footer, so a breaking change without it is never released as one. And when
the instructions above ask for a 'Closes #N' footer, end with it too — the
pull request is linked to its issue only through that line.

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

// The local default branch may lag origin's, so a ship would read a stale
// merge base from it and describe other people's changes. Origin's copy
// wins when it descends from the local one, or when the branch sits on it and
// not on the local one; otherwise the local branch stays first.
async function resolveRef(git: Git, ok: Ok, baseBranch: string): Promise<string | undefined> {
  const remote = `origin/${baseBranch}`
  const local = await ok("rev-parse", "--verify", "--quiet", baseBranch)
  const origin = await ok("rev-parse", "--verify", "--quiet", remote)
  if (!local || !origin) return local ? baseBranch : origin ? remote : undefined
  if (await ok("merge-base", "--is-ancestor", baseBranch, remote)) return remote
  const m = await git("merge-base", remote, "HEAD")
  if (m && !(await ok("merge-base", "--is-ancestor", m, baseBranch))) return remote
  return baseBranch
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
  const baseRef = await resolveRef(git, ok, baseBranch)
  if (!baseRef)
    return { refusal: `There is no ref '${baseBranch}' (tried origin/${baseBranch} too).` }
  // `reset --soft` would fold pending changes into the squash without saying so.
  if (await git("status", "--porcelain"))
    return { refusal: "The working tree is dirty. Commit or stash first." }
  return { branch, baseBranch, baseRef }
}

export async function ship(io: ShipIo, isDry: boolean): Promise<Shipped> {
  const git = async (...args: string[]) => (await io.run(["git", ...args])).out.trim()
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0

  const pre = await preflight(git, ok)
  if ("refusal" in pre) return fail(pre.refusal)
  const { branch, baseBranch, baseRef } = pre

  const squashed = await squash(io, git, ok, branch, isDry)
  if (!squashed.ok) return squashed
  if (isDry) return preview(io, git, branch, baseRef, squashed.text, squashed.history)
  return pullRequest(io, git, ok, branch, baseBranch, baseRef)
}

type Git = (...args: string[]) => Promise<string>
type Ok = (...args: string[]) => Promise<boolean>

// A failure text while the process is not a finished, shippable one.
async function unfinished(io: ShipIo) {
  // `gtd summary` also describes a process still underway; shipping that
  // would publish half of it.
  const initial = (await io.run(["gtd", "next", "--json=initial"])).out.trim()
  if (initial === "true") return undefined
  const state = (await io.run(["gtd", "next", "--json=state"])).out.trim()
  return `The gtd process is still underway (at ${state}). Finish it, then ship.`
}

// The process's own commits, base exclusive, and only while it ends at HEAD;
// a string is why ship refuses to squash.
async function processRange(git: Git, summary: string) {
  const range = summaryRange(summary)
  if (!range) return "The gtd summary names no commit range, so ship refuses to guess a base."
  const base = await git("rev-parse", "--verify", `${range[0]}^{commit}`)
  const tip = await git("rev-parse", "--verify", `${range[1]}^{commit}`)
  if (!base || !tip) return "The gtd summary's range does not resolve in this repository."
  if (tip !== (await git("rev-parse", "HEAD")))
    return `The process tip (${short(tip)}) is not HEAD: something landed since.`
  const count = Number(await git("rev-list", "--count", `${base}..HEAD`))
  if (!count) return `Nothing to squash: ${short(base)}..HEAD is empty.`
  return { base, tip, count }
}

async function squash(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  isDry: boolean,
): Promise<Shipped & { history?: string | undefined }> {
  const summary = await io.run(["gtd", "summary"])
  if (summary.code !== 0) {
    io.log(`No gtd process at HEAD, so nothing is squashed; ${branch} is described as it stands.`)
    return { ok: true, text: "" }
  }
  const underway = await unfinished(io)
  if (underway) return fail(underway)
  const range = await processRange(git, summary.out)
  if (typeof range === "string") return fail(`${range} Nothing changed.`)
  const { base, tip, count } = range

  // gtd churns its own steering files every process, so `.gtd/` alone is no change.
  if (await ok("diff", "--quiet", base, tip, "--", ":(exclude).gtd/"))
    return dropProcess(io, ok, base, count, isDry)

  io.log(`Squashing ${count} commit(s) since ${short(base)}…`)
  const trailers = costTrailers(await git("log", "--format=%B%n", `${base}..${tip}`))
  const reply = await io.complete(summary.out + "\n" + COMMIT_FORMAT)
  const message = reply && cleanReply(reply)
  if (!message) return fail("The commit-message turn produced nothing.")
  const history = await historyRef(io, tip)
  const all = history ? [...trailers, `Gtd-History: ${history}`] : trailers
  const full = all.length ? `${message}\n\n${all.join("\n")}` : message
  if (isDry) return { ok: true, text: full, history }

  const pushed = await pushHistory(io, history)
  if (pushed) return fail(pushed)
  return commitSquash(io, git, ok, base, full)
}

type View = {
  number: number
  title?: string
  body?: string
  url: string
  state: string
}

// gh's stderr for a branch with no PR (cli/cli pr view); tests script it by this.
export const NO_PR_FOUND = "no pull requests found"

// `gh pr view <branch>`: only NO_PR_FOUND reads as none; any
// other failure (auth, network) must refuse, or ship would open a duplicate PR.
// A closed PR whose branch origin lost is an abandoned earlier ship and reads as
// none; `abandoned` is recorded before the push so a retry, with origin holding
// the branch again, still reads it as none. `gone`: a tracking ref is stale.
async function readPr(
  io: ShipIo,
  branch: string,
): Promise<{ view?: View; gone?: boolean; abandoned?: number } | string> {
  const v = await io.run(["gh", "pr", "view", branch, "--json", "number,title,body,url,state"])
  if (v.code !== 0) {
    if (v.err.includes(NO_PR_FOUND)) return {}
    return `gh pr view ${branch} failed: ${v.err.trim()}`
  }
  let view: View
  try {
    view = JSON.parse(v.out) as View
  } catch {
    return `gh pr view ${branch} returned something unreadable.`
  }
  if (view.state !== "CLOSED") return { view }
  const key = await io.run(["git", "config", "--local", "--get", ABANDONED_KEY(branch)])
  const recorded = key.out.trim() === String(view.number)
  const ls = await io.run(["git", "ls-remote", "origin", `refs/heads/${branch}`])
  const gone = ls.code === 0 && !ls.out.trim()
  if (recorded) return { gone }
  return gone ? { gone, abandoned: view.number } : { view }
}

const ABANDONED_KEY = (branch: string) => `branch.${branch}.gtdAbandonedPr`

// Once the new PR opens, gh pr view finds it: the record has served its purpose.
async function settled<T extends Shipped>(io: ShipIo, branch: string, done: T) {
  if (done.ok) await io.run(["git", "config", "--local", "--unset", ABANDONED_KEY(branch)])
  return done
}

async function abandon(io: ShipIo, branch: string, pr: number | undefined) {
  if (pr === undefined) return undefined
  const set = await io.run(["git", "config", "--local", ABANDONED_KEY(branch), String(pr)])
  return set.code === 0 ? undefined : `git config failed.\n${set.err}`.trimEnd()
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
): Promise<Shipped> {
  const mergeBase = await git("merge-base", baseRef, "HEAD")
  const read = await readPr(io, branch)
  if (typeof read === "string") return fail(`${read} Nothing changed.`)
  const existing = read.view
  const pr = existing
    ? `would refresh ${existing.url}`
    : `would open a pull request for ${branch} into ${baseRef} (${await git("rev-list", "--count", `${mergeBase}..HEAD`)} commit(s) before the squash)`
  return {
    ok: true,
    text: [
      message && `Commit message:\n\n${message}`,
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

  const read = await readPr(io, branch)
  if (typeof read === "string")
    return fail(
      `${read} ${branch} was not pushed; the squash and history ref stay, /gtd ship retries.`,
    )
  const { view: existing, gone } = read
  if (existing && existing.state !== "OPEN")
    return fail(`The pull request for ${branch} is ${existing.state}, not open.`)
  const marked = await abandon(io, branch, read.abandoned)
  if (marked) return fail(`${marked} ${branch} was not pushed; /gtd ship retries.`)
  const pushed = await pushBranch(io, branch, gone)
  if (pushed) return fail(pushed)
  const ctx: Ctx = { from: mergeBase, to: "HEAD" }
  if (!existing)
    return settled(io, branch, await createPr(io, git, branch, baseBranch, baseRef, ctx))
  // A thrown draft only ever described a hand-off: ship writes it properly.
  if (existing.body?.includes(THROWN))
    return createPr(io, git, branch, baseBranch, baseRef, ctx, existing)
  return updatePr(io, git, ok, branch, ctx, existing)
}

// A pull request describes what the remote branch holds. A squash rewrote the
// branch, so an existing origin/<branch> needs --force-with-lease. `fresh`:
// origin lacks the branch, so any tracking ref is stale. Returns why the push
// failed, or nothing.
export async function pushBranch(io: ShipIo, branch: string, fresh = false) {
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0
  const push = async (args: string[], failure: string) => {
    const r = await attempt(io, ["git", "push", ...args])
    if (r.killed)
      return `git push of ${branch} did not finish; nothing was lost. Retry without fetching.\n${r.err}`.trimEnd()
    if (r.code !== 0) return `${failure}\n${r.err}`.trimEnd()
    return undefined
  }
  if (fresh || !(await ok("rev-parse", "--verify", "--quiet", `origin/${branch}`))) {
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

type Ctx = { from: string; to: string }

// [ \t], never \s: a reference on the next line is not what the keyword closes.
const KEYWORD = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[ \t]+`
const URL = String.raw`https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)`
const REF = String.raw`(?:(?:[\w.-]+\/[\w.-]+)?#\d+|${URL})`
const NEXT = String.raw`(?:[ \t]*,[ \t]*|[ \t]+and[ \t]+)(?:${KEYWORD})?`
// A whole line of closing references, bulleted or not: `Closes #1.`,
// `- Fixes #1, #2`, `Resolves o/r#3 and fixes <issue URL>`.
const CLOSING = new RegExp(
  String.raw`^[ \t]*(?:[-*][ \t]+)?${KEYWORD}${REF}(?:${NEXT}${REF})*[ \t]*\.?[ \t]*$`,
  "gim",
)
const REFS = new RegExp(REF, "g")

const closed = (text: string) => {
  const refs = new Map<string, string>()
  for (const [line] of text.matchAll(CLOSING))
    for (const [whole, repo, n] of line.matchAll(REFS)) {
      const ref = repo ? `${repo}#${n}` : whole
      if (!refs.has(ref.toLowerCase())) refs.set(ref.toLowerCase(), ref)
    }
  return refs
}

// The description prompt forbids footers, so the issues the commits close are
// carried over here: a PR body without the keyword never links its issue.
export function withCloses(body: string, log: string) {
  const has = closed(body)
  const add = [...closed(log)].filter(([key]) => !has.has(key)).map(([, ref]) => ref)
  if (!add.length) return body
  return [body.trimEnd(), add.map((ref) => `Closes ${ref}`).join("\n")].filter(Boolean).join("\n\n")
}

async function createPr(
  io: ShipIo,
  git: Git,
  branch: string,
  baseBranch: string,
  baseRef: string,
  { from: mergeBase, to }: Ctx,
  thrown?: { number: number; url: string },
): Promise<Shipped & { number?: number }> {
  const count = await git("rev-list", "--count", `${mergeBase}..${to}`)
  io.log(
    thrown
      ? `#${thrown.number} was thrown as a draft: describing ${count} commit(s) properly…`
      : `No pull request for ${branch} yet: describing ${count} commit(s)…`,
  )
  const log = await git(
    "log",
    "--no-merges",
    "--reverse",
    "--format=%H%n%B%n---",
    `${mergeBase}..${to}`,
  )
  const prompt = `Write the title and description for a pull request, from the commits below.

Format, exactly:

- First line: the title — a Conventional Commit subject, 'type(scope): summary'
  ('type(scope)!: summary' for a breaking change). Types: feat, fix, refactor,
  perf, docs, test, build, ci, chore. Lowercase summary, imperative mood, no
  trailing period, 72 characters or fewer.
${TYPE_RULE} A squash merges every commit under this title, so take the
  type of the commit that releases the most, and its '!' when any commit
  carries a BREAKING CHANGE footer.
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
${log}

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
  const text = rest.join("\n").replace(/^\s*\n/, "")
  const body = withCloses(text, log)
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

const closingLog = (git: Git, from: string, to: string) =>
  git("log", "--no-merges", "--format=%B%n---", `${from}..${to}`)

type Existing = { number: number; body?: string; url: string }

// The issues the branch closes, re-applied on every refresh but only written when changed.
async function refresher(io: ShipIo, git: Git, { from: mergeBase, to }: Ctx, existing: Existing) {
  // The whole branch, not just what is new: a PR shipped before its commits
  // closed anything, or whose edit failed after the sync head moved, still gains them.
  const log = await closingLog(git, mergeBase, to)
  const closing = (raw: string) => withCloses(raw, log)
  const edit = async (body: string) =>
    io.run(["gh", "pr", "edit", String(existing.number), "--body-file", "-"], body)
  const was = existing.body ?? ""
  const refreshed = async (text: string) => {
    const fixed = closing(was)
    if (fixed === was) return { ok: true, text, number: existing.number }
    const edited = await edit(fixed)
    if (edited.code !== 0)
      return {
        ...fail(
          `gh pr edit failed; the description of ${existing.url} is unchanged.\n${edited.err}`,
        ),
        number: existing.number,
      }
    return { ok: true, text, number: existing.number }
  }
  return { closing, edit, refreshed, stale: closing(was) !== was }
}

async function updatePr(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  ctx: Ctx,
  existing: Existing,
): Promise<Shipped & { number?: number }> {
  const { from: mergeBase, to } = ctx
  const { closing, edit, refreshed, stale } = await refresher(io, git, ctx, existing)
  // Only what landed since the last run. A stored head a squash left behind
  // falls back to the whole branch, the only honest range left.
  const since = await sinceHead(git, ok, branch, mergeBase, to)
  // ^mergeBase keeps a synced head from before a main merge from re-weighing
  // the commits that merge brought in.
  const count = Number(await git("rev-list", "--count", `${since}..${to}`, `^${mergeBase}`))
  if (!count && stale) return refreshed(`Nothing new since the last ship: ${existing.url}`)
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
    return refreshed(
      `Nothing at that level changed; the description of ${existing.url} is left alone.`,
    )
  }
  // Appended, dated and anchored to its commit, so the standing text keeps saying what it said.
  const repo = (await io.run(["gh", "repo", "view", "--json", "url", "-q", ".url"])).out.trim()
  const anchor = repo ? `[\`${sha.slice(0, 7)}\`](${repo}/commit/${sha})` : `\`${sha.slice(0, 7)}\``
  const body = closing(`${existing.body ?? ""}\n\n## Update ${io.today()} — ${anchor}\n\n${out}\n`)
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
