import { read, refuse } from "../../flows/index.js"

// The registry is read as TEXT: workflows may not import `src/flags/`, and this
// also lets a repository point at its own registry file.

export interface RegistryEntry {
  readonly kind: string
  readonly defaultOn: boolean
}

// Filler for masked text: a non-word char, so `/*x*/kind` still has a `\b` before `kind`.
const FILL = "\u0001"

// Same length as `text`, with string contents and comments filled with FILL, so
// a hit inside either (a JSDoc example, `owner: "defaultOn: true"`) is rejected.
const commentLength = (rest: string): number => {
  const end = rest.startsWith("//") ? rest.indexOf("\n") : rest.indexOf("*/") + 2
  return end <= 0 ? rest.length : end
}

// Index of the closing quote of the string opened at `i` (or text end).
const stringEnd = (text: string, i: number, quote: string): number => {
  let j = i + 1
  while (j < text.length && text[j] !== quote) j += text[j] === "\\" ? 2 : 1
  return Math.min(j, text.length)
}

const mask = (text: string): string => {
  let out = ""
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    const rest = text.slice(i)
    if (rest.startsWith("//") || rest.startsWith("/*")) {
      const len = commentLength(rest)
      out += FILL.repeat(len)
      i += len
    } else if (c === '"' || c === "'" || c === "`") {
      const j = stringEnd(text, i, c)
      out += c + FILL.repeat(j - i - 1) + (j < text.length ? c : "")
      i = j + 1
    } else {
      out += c
      i += 1
    }
  }
  return out
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Entries are flat object literals, so the nearest braces around the name delimit one.
const entrySpan = (text: string, name: string) => {
  const quoted = escapeRegExp(name)
  const re = new RegExp(`\\bname\\s*:\\s*(["'\`])${quoted}\\1`, "g")
  const masked = mask(text)
  for (const hit of text.matchAll(re)) {
    if (masked[hit.index] === FILL) continue
    const start = masked.lastIndexOf("{", hit.index)
    const close = masked.indexOf("}", hit.index)
    return start < 0 || close < 0 ? undefined : { start, end: close + 1 }
  }
  return undefined
}

const DEFAULT_ON = /\bdefaultOn\s*:\s*(true|false)\s*,?/

// `defaultOn` as a property of `body`, never one inside a string or comment.
const defaultOnHit = (body: string) => DEFAULT_ON.exec(mask(body))

const defaultOnValue = (body: string): string | undefined => defaultOnHit(body)?.[1]

const KIND = /\bkind\s*:\s*["'`]/

export const registryEntry = (text: string, name: string): RegistryEntry | undefined => {
  const span = entrySpan(text, name)
  if (span === undefined) return undefined
  const body = text.slice(span.start, span.end)
  const hit = KIND.exec(mask(body))
  const kind = hit === null ? null : /^(\w+)["'`]/.exec(body.slice(hit.index + hit[0].length))
  return {
    kind: kind?.[1] ?? "",
    defaultOn: defaultOnValue(body) === "true",
  }
}

// Drops the `defaultOn` property, then whitespace and trailing commas outside strings.
const canonical = (body: string): string => {
  const hit = defaultOnHit(body)
  const kept =
    hit === null ? body : body.slice(0, hit.index) + body.slice(hit.index + hit[0].length)
  const masked = mask(kept)
  // UTF-16 units, to match `masked` indexing; code points would drift after a surrogate pair
  return kept
    .split("")
    .filter(
      (c, i) =>
        masked[i] === FILL || !(/\s/.test(c) || (c === "," && /^\s*}/.test(masked.slice(i + 1)))),
    )
    .join("")
}

/**
 * [] when `after` differs from `before` only by the named entry's `defaultOn`
 * going absent/false → true (whitespace and trailing commas inside that entry
 * ignored, so oxfmt re-wrapping it passes); else one line per fault.
 */
export const flipProblems = (before: string, after: string, name: string): readonly string[] => {
  const was = entrySpan(before, name)
  const now = entrySpan(after, name)
  if (was === undefined) return [`no entry "${name}" before the turn`]
  if (now === undefined) return [`entry "${name}" is gone`]
  const faults: string[] = []
  if (before.slice(0, was.start) !== after.slice(0, now.start)) {
    faults.push("text before the entry changed")
  }
  if (before.slice(was.end) !== after.slice(now.end)) faults.push("text after the entry changed")
  const oldBody = before.slice(was.start, was.end)
  const newBody = after.slice(now.start, now.end)
  if (canonical(oldBody) !== canonical(newBody))
    faults.push(`entry "${name}" changed beyond defaultOn`)
  if (defaultOnValue(newBody) !== "true") faults.push(`"${name}" is not set to defaultOn: true`)
  return faults
}

/** `path:line` for every `GTD_FLAG_<NAME>` in shipped sources; re-states scripts/lint-flags.ts' rule by hand. */
export const flagReferences = (
  files: readonly { readonly path: string; readonly text: string }[],
  name: string,
): readonly string[] => {
  const pattern = new RegExp(`\\bGTD_FLAG_${escapeRegExp(name.toUpperCase())}\\b`)
  return files
    .filter(({ path }) => !/\.(test|fixture|stories)\.tsx?$/.test(path))
    .flatMap(({ path, text }) =>
      text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${path}:${i + 1}`] : [])),
    )
}

export interface FlagMention {
  readonly path: string
  readonly line: number
  readonly text: string
}

const MENTION_LENGTH = 200

/**
 * Every line naming flag `name` as `GTD_FLAG_<NAME>`, `flag_<name>` or bare
 * `<name>` — case-insensitive, never inside a longer identifier. Unlike
 * `flagReferences`, test files count; a file holding a NUL byte is skipped.
 */
export const flagMentions = (
  files: readonly { readonly path: string; readonly text: string }[],
  name: string,
): readonly FlagMention[] => {
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_])(?:GTD_FLAG_|flag_)?${escapeRegExp(name)}(?![A-Za-z0-9_])`,
    "i",
  )
  return files
    .filter(({ text }) => !text.includes("\u0000"))
    .flatMap(({ path, text }) =>
      text
        .split("\n")
        .flatMap((line, i) =>
          pattern.test(line)
            ? [{ path, line: i + 1, text: line.trim().slice(0, MENTION_LENGTH) }]
            : [],
        ),
    )
}

export const requireFlag = (
  workflow: "rollout" | "cleanup",
  registryPath: string,
  name: string,
  defaultOn: boolean,
): void => {
  if (name === "") return refuse(`gtd: ${workflow} needs --var flag=<name>`)
  const entry = registryEntry(read(registryPath) ?? "", name)
  if (entry === undefined) return refuse(`gtd: ${workflow}: no flag "${name}" in ${registryPath}`)
  if (entry.kind !== "release") {
    return refuse(`gtd: ${workflow}: flag "${name}" is ${entry.kind}, not release`)
  }
  if (entry.defaultOn !== defaultOn) {
    return refuse(
      defaultOn
        ? `gtd: ${workflow}: flag "${name}" is not default-on — roll it out first`
        : `gtd: ${workflow}: flag "${name}" is already default-on`,
    )
  }
}
