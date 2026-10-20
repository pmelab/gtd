// `/gtd pr`: a pull request's unresolved review threads become notes in the
// review gate's file, and once the review door has acted on them each thread
// gets a reply and is resolved. gtd itself never talks to GitHub: the mod
// reads and writes the threads, and gtd only sees the notes.

import type { PrFeedback, PrThread } from "../types"
import { pushBranch } from "./ship"
import type { ShipIo, Shipped } from "./ship"

export const REVIEW_FILE = ".gtd/REVIEW.md"

export type Pr = {
  host: string
  owner: string
  name: string
  number: number
  url: string
  branch: string
}
export type Thread = PrThread
export type Choice = "fix" | "wontfix" | "answer"
export type Answer = { thread: string; title: string; choice: Choice; text: string }

const PR_URL = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/
// The thread's node id, tagged on the note's heading.
const TAG = /\(thread ([A-Za-z0-9_=-]+)\)\s*$/
const LEAD = "Tick exactly one:"
const PLACEHOLDER = "_your answer_"

const fail = (text: string): Shipped => ({ ok: false, text })

export async function currentPr(io: ShipIo): Promise<Pr | string> {
  const branch = (await io.run(["git", "rev-parse", "--abbrev-ref", "HEAD"])).out.trim()
  const v = await io.run(["gh", "pr", "view", "--json", "number,url"])
  if (v.code !== 0) return `gh pr view failed: ${v.err.trim()}`
  try {
    const { url } = JSON.parse(v.out) as { url: string }
    const m = PR_URL.exec(url)
    if (!m) return `gh pr view returned an unexpected url: ${url}`
    return { host: m[1]!, owner: m[2]!, name: m[3]!, number: Number(m[4]), url, branch }
  } catch {
    return "gh pr view returned something unreadable."
  }
}

const THREADS = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          originalLine
          comments(first: 50) { nodes { author { login } body url } }
        }
      }
    }
  }
}`

type ThreadNode = {
  id: string
  isResolved: boolean
  path: string | null
  line: number | null
  originalLine: number | null
  comments: { nodes: { author: { login: string } | null; body: string; url: string }[] }
}

export async function unresolvedThreads(io: ShipIo, pr: Pr): Promise<Thread[] | string> {
  const r = await io.run([
    "gh",
    "api",
    "graphql",
    "--hostname",
    pr.host,
    "-f",
    `query=${THREADS}`,
    "-f",
    `owner=${pr.owner}`,
    "-f",
    `name=${pr.name}`,
    "-F",
    `number=${pr.number}`,
  ])
  if (r.code !== 0) return `Reading the review threads failed: ${r.err.trim()}`
  let nodes: ThreadNode[]
  try {
    nodes = JSON.parse(r.out).data.repository.pullRequest.reviewThreads.nodes as ThreadNode[]
  } catch {
    return "gh api returned something unreadable for the review threads."
  }
  return nodes
    .filter((t) => !t.isResolved)
    .map((t) => ({
      id: t.id,
      ...(t.path ? { path: t.path } : {}),
      ...((t.line ?? t.originalLine) ? { line: (t.line ?? t.originalLine)! } : {}),
      comments: t.comments.nodes.map((c) => ({
        author: c.author?.login ?? "ghost",
        body: c.body,
        url: c.url,
      })),
    }))
}

// Code spans pass as they are; elsewhere only an entity hides a footnote
// marker or a comment from gtd's raw-text checks.
const escaped = (line: string) =>
  line
    .replace(/^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, "$1\\[$2\\]")
    .split(/(`+[^`]*`+)/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(/\[\^/g, "&#91;^").replace(/<!--/g, "&lt;!--"),
    )
    .join("")

// The fence open after `line`, given the one open before it. A closing fence
// carries no info string.
const fenceAfter = (open: string | undefined, line: string) => {
  const m = /^(?:\s*>)*\s*(`{3,}|~{3,})(.*)$/.exec(line)
  if (!m) return open
  const f = m[1]!
  if (open === undefined) return f
  return f[0] === open[0] && f.length >= open.length && !m[2]!.trim() ? undefined : open
}

// A comment is quoted, and anything that would parse as part of the review's
// own structure — a task box, a footnote — is escaped. Code in a fence parses
// as code, so a suggestion is kept verbatim.
const quoted = (body: string) => {
  let fence: string | undefined
  return body
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      const wasCode = fence !== undefined
      fence = fenceAfter(fence, l)
      return wasCode || fence !== undefined ? l : escaped(l)
    })
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n")
}

const heading = (t: Thread) =>
  `## ${t.path ? `${t.path}${t.line ? `:${t.line}` : ""}` : "Pull request review"} (thread ${t.id})`

export function threadNote(t: Thread) {
  const said = t.comments.map((c) => `**@${c.author}** ([comment](${c.url})):\n\n${quoted(c.body)}`)
  return [
    heading(t),
    ...said,
    "From the pull request. To decline it, tick won't fix and write your reason after it on that line.",
    LEAD,
    "- [x] fix as suggested\n- [ ] won't fix\n- [ ] _your answer_",
  ].join("\n\n")
}

// The review with every thread it does not already hold appended, pre-ticked.
export function withThreads(review: string, threads: readonly Thread[]) {
  const held = new Set(chunks(review).flatMap((c) => (c.thread ? [c.thread] : [])))
  const added = threads.filter((t) => !held.has(t.id)).map(threadNote)
  return added.length === 0 ? review : `${review.trimEnd()}\n\n${added.join("\n\n")}\n`
}

type Chunk = { title: string; thread?: string; lines: string[] }

// Every imported line is quoted, so a `## ` line is always a chunk's heading.
function chunks(review: string): Chunk[] {
  return review
    .split(/^## /m)
    .slice(1)
    .map((part) => {
      const [first = "", ...lines] = part.split(/\r?\n/)
      const title = first.trim()
      const thread = TAG.exec(title)?.[1]
      return { title, ...(thread ? { thread } : {}), lines }
    })
}

// An unindented line right below an item continues it, as markdown reads it.
const continues = (line: string, afterBlank: boolean) => !afterBlank || /^\s+\S/.test(line)

// The three answer boxes after the lead line, a wrapped item's continuation joined on.
function boxes(lines: readonly string[]) {
  const at = lines.findIndex((l) => l.trim() === LEAD)
  if (at === -1) return undefined
  const items: { checked: boolean; text: string }[] = []
  let blank = false
  for (const line of lines.slice(at + 1)) {
    const m = /^[-*+] \[([ xX])\]\s*(.*)$/.exec(line)
    const isText = line.trim() !== ""
    if (m) items.push({ checked: m[1] !== " ", text: m[2]!.trim() })
    else if (items.length > 0 && isText && continues(line, blank))
      items.at(-1)!.text = `${items.at(-1)!.text} ${line.trim()}`.trim()
    else if (items.length > 0 && isText) break
    blank = !isText
  }
  return items
}

const reasonOf = (text: string) => text.replace(/^won['’]t fix\b[\s:,;.—–-]*/i, "").trim()

export function answers(review: string): Answer[] {
  return chunks(review).flatMap((c) => {
    const b = c.thread ? boxes(c.lines) : undefined
    if (!c.thread || b?.length !== 3) return []
    const ticked = b.flatMap((o, i) => (o.checked ? [i] : []))
    if (ticked.length !== 1) return []
    const i = ticked[0]!
    const choice = (["fix", "wontfix", "answer"] as const)[i]!
    const own = b[2]!.text.toLowerCase() === PLACEHOLDER ? "" : b[2]!.text
    const text = choice === "wontfix" ? reasonOf(b[1]!.text) : choice === "answer" ? own : ""
    return [{ thread: c.thread, title: c.title, choice, text }]
  })
}

// Thread notes declined without the reason their reply needs.
export function missingReasons(review: string) {
  return answers(review)
    .filter((a) => a.choice === "wontfix" && a.text === "")
    .map((a) => `${REVIEW_FILE}: "${a.title}": write the reason after "won't fix" on that line.`)
}

// The first commit since `since` whose review answers any of `ids`: the gate
// that decided them. Undefined while none has landed.
export async function decided(io: ShipIo, since: string, ids: readonly string[]) {
  // A reset or rebase since the import leaves nothing to find the gate in.
  if ((await io.run(["git", "merge-base", "--is-ancestor", since, "HEAD"])).code !== 0)
    return "gone"
  const log = await io.run([
    "git",
    "log",
    "--reverse",
    "--first-parent",
    "--format=%H",
    `${since}..HEAD`,
  ])
  if (log.code !== 0) return "gone"
  for (const commit of log.out.split("\n").filter(Boolean)) {
    const shown = await io.run(["git", "show", `${commit}:${REVIEW_FILE}`])
    if (shown.code !== 0) continue
    const got = answers(shown.out).filter((a) => ids.includes(a.thread))
    if (got.length > 0) return { gate: commit, answers: got }
  }
  return undefined
}

export type PrRest = { isReviewGate: boolean; isDone: boolean; branch: string }

// What a rest does with `/gtd pr`'s threads. Threads of another branch's pull
// request never reach this one's review; a process that ends before any review
// gate drops them.
export function prAction(pr: PrFeedback | undefined, at: PrRest) {
  if (!pr) return "none"
  if (at.branch !== pr.branch) return "forget"
  if (pr.importedAt === undefined) return at.isReviewGate ? "import" : at.isDone ? "forget" : "none"
  return at.isReviewGate || at.isDone ? "reply" : "none"
}

// The fixes the gate asked for are the first turn after it, so its first code
// commit is the fix; later ones belong to other notes or rounds.
export function replyText(a: Answer, fix: string | undefined) {
  if (a.choice === "wontfix") return a.text ? `Won't fix: ${a.text}` : "Won't fix."
  if (a.choice === "answer") return a.text
  return fix ? `Fixed in ${fix}.` : "Fixed as suggested; the fix changed no code."
}

const REPLY = `mutation($thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } }
}`
const RESOLVE = `mutation($thread: ID!) {
  resolveReviewThread(input: { threadId: $thread }) { thread { isResolved } }
}`

// Pushes the branch so the commits a reply names exist on GitHub, then replies
// to each answered thread and resolves it. The code commits after `gate` are
// the fixes; a thread that fails is named and left open.
export async function reply(
  io: ShipIo,
  host: string,
  gate: string,
  decidedAnswers: readonly Answer[],
): Promise<Shipped & { isPushed: boolean }> {
  const branch = (await io.run(["git", "rev-parse", "--abbrev-ref", "HEAD"])).out.trim()
  const pushed = await pushBranch(io, branch)
  if (pushed) return { ...fail(pushed), isPushed: false }
  const log = await io.run([
    "git",
    "log",
    "--reverse",
    "--first-parent",
    "--format=%H",
    `${gate}..HEAD`,
    "--",
    ".",
    ":(exclude).gtd",
  ])
  const fix = log.out.split("\n").find(Boolean)
  const failed: string[] = []
  for (const a of decidedAnswers) {
    const sent = await io.run([
      "gh",
      "api",
      "graphql",
      "--hostname",
      host,
      "-f",
      `query=${REPLY}`,
      "-f",
      `thread=${a.thread}`,
      "-f",
      `body=${replyText(a, fix)}`,
    ])
    const resolved =
      sent.code === 0 &&
      (
        await io.run([
          "gh",
          "api",
          "graphql",
          "--hostname",
          host,
          "-f",
          `query=${RESOLVE}`,
          "-f",
          `thread=${a.thread}`,
        ])
      ).code === 0
    if (!resolved) failed.push(a.title)
  }
  const done = decidedAnswers.length - failed.length
  const text = `Replied to and resolved ${done} review thread(s).`
  return failed.length === 0
    ? { ok: true, text, isPushed: true }
    : {
        ...fail(`${text}\nThese failed and stay open:\n${failed.map((t) => `- ${t}`).join("\n")}`),
        isPushed: true,
      }
}
