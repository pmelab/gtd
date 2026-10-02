import type { SteeringFinding } from "./SteeringFormat.js"
import type { ThreadEntry } from "./Threads.js"

export interface CodeThread {
  readonly path: string
  /** 0-based line of the run's first comment line. */
  readonly line: number
  readonly endLine: number
  readonly entries: readonly Pick<ThreadEntry, "author" | "text" | "line">[]
  /** `"human"` means the last entry is the agent's: the thread is open. */
  readonly waitingOn: "human" | "agent"
}

const TOKENS = ["//", "#", "--", ";"] as const
type Token = (typeof TOKENS)[number]

const BY_EXTENSION: Readonly<Record<Token, readonly string[]>> = {
  "//": [
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "mts",
    "cts",
    "go",
    "rs",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "java",
    "kt",
    "swift",
    "cs",
    "scala",
    "php",
    "dart",
  ],
  "#": [
    "feature",
    "py",
    "sh",
    "bash",
    "zsh",
    "fish",
    "rb",
    "yaml",
    "yml",
    "toml",
    "pl",
    "r",
    "ex",
    "exs",
  ],
  "--": ["sql", "lua", "hs"],
  ";": ["lisp", "clj", "cljs", "ini", "asm", "el", "scm"],
}

/** The comment tokens a path is scanned for; none for `.md`/`.markdown` and `.gtd/**`. A file with no mapped extension is scanned for all four. */
const codeThreadTokens = (path: string): readonly Token[] => {
  if (path === ".gtd" || path.startsWith(".gtd/")) return []
  const base = path.slice(path.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ""
  if (ext === "md" || ext === "markdown") return []
  const own = TOKENS.filter((token) => BY_EXTENSION[token].includes(ext))
  return own.length > 0 ? own : TOKENS
}

const PREFIX_RE = /^(H|A):\s*/

interface CommentLine {
  readonly token: Token
  readonly text: string
}

// A comment line's FIRST non-blank text is the token, so a trailing comment
// after code never matches.
const commentOf = (line: string, tokens: readonly Token[]): CommentLine | undefined => {
  const trimmed = line.trimStart()
  const token = tokens.find((candidate) => trimmed.startsWith(candidate))
  return token === undefined ? undefined : { token, text: trimmed.slice(token.length).trim() }
}

interface Run {
  readonly start: number
  readonly end: number
  readonly texts: readonly string[]
}

const runsOf = (lines: readonly string[], tokens: readonly Token[]): readonly Run[] => {
  const runs: Run[] = []
  let current: { start: number; token: Token; texts: string[] } | undefined
  const close = (end: number): void => {
    if (current) runs.push({ start: current.start, end, texts: current.texts })
    current = undefined
  }
  lines.forEach((line, i) => {
    const comment = commentOf(line, tokens)
    if (!comment || (current && current.token !== comment.token)) close(i - 1)
    if (!comment) return
    if (current) current.texts.push(comment.text)
    else current = { start: i, token: comment.token, texts: [comment.text] }
  })
  close(lines.length - 1)
  return runs
}

const isThreadRun = (run: Run): boolean => PREFIX_RE.test(run.texts[0]!)

/** Every thread run of `content` (0-based lines), the scanner's one line-based walk. */
export const parseCodeThreads = (
  path: string,
  content: string,
): { readonly threads: readonly CodeThread[]; readonly findings: readonly SteeringFinding[] } => {
  const tokens = codeThreadTokens(path)
  if (tokens.length === 0) return { threads: [], findings: [] }
  const lines = content.split(/\r?\n/)
  const threads: CodeThread[] = []
  const findings: SteeringFinding[] = []
  for (const run of runsOf(lines, tokens).filter(isThreadRun)) {
    const entries: { author: "me" | "agent"; text: string; line: number }[] = []
    run.texts.forEach((text, offset) => {
      const match = PREFIX_RE.exec(text)
      const line = run.start + offset
      if (match) {
        entries.push({
          author: match[1] === "H" ? "me" : "agent",
          text: text.slice(match[0].length).trim(),
          line,
        })
        return
      }
      const last = entries[entries.length - 1]!
      if (text !== "") last.text = last.text === "" ? text : `${last.text} ${text}`
    })
    const report = (message: string, entry: (typeof entries)[number]): void => {
      findings.push({
        message: `Code thread at ${path}:${run.start + 1}: ${message}`,
        line: entry.line,
        range: {
          start: { line: entry.line, character: 0 },
          end: { line: entry.line, character: (lines[entry.line] ?? "").length },
        },
      })
    }
    entries.forEach((entry, i) => {
      const letter = entry.author === "me" ? "H" : "A"
      if (entry.text === "") {
        report(`empty "${letter}:" entry — write your own words there`, entry)
      }
      if (i === 0 && entry.author === "agent") {
        report(`the agent never starts a thread — the first entry must be "H:"`, entry)
      } else if (i > 0 && entries[i - 1]!.author === entry.author) {
        report(`two consecutive "${letter}:" entries — entries must alternate`, entry)
      }
    })
    threads.push({
      path,
      line: run.start,
      endLine: run.end,
      entries,
      waitingOn: entries[entries.length - 1]?.author === "agent" ? "human" : "agent",
    })
  }
  return { threads, findings }
}

/** `text` with every thread run removed; ordinary comments stay. */
export const stripCodeThreads = (path: string, text: string): string => {
  const tokens = codeThreadTokens(path)
  if (tokens.length === 0) return text
  const lines = text.split("\n")
  const drop = new Set<number>()
  for (const run of runsOf(
    lines.map((l) => l.replace(/\r$/, "")),
    tokens,
  ).filter(isThreadRun)) {
    for (let i = run.start; i <= run.end; i++) drop.add(i)
  }
  return lines.filter((_, i) => !drop.has(i)).join("\n")
}
