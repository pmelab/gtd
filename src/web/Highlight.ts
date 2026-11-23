/**
 * One token of highlighted code. `className` is absent for plain text (the gaps
 * between matches, and the whole of a hunk header). Consumers render `text` as
 * a React text node — never `dangerouslySetInnerHTML` — so `<`, `>`, `&` in the
 * source need no escaping here: React escapes text nodes on render. This is a
 * deliberate departure from the ten-line prototype (`hunk-review-390.html`),
 * which built HTML strings and so had to `esc()` first; a token-array contract
 * gets the same safety for free from the renderer.
 */
export interface Token {
  readonly text: string
  readonly className?: string
}

/** A token class's colour, shared by diffs and fenced code blocks. */
export const TOKEN_COLOR: Readonly<Record<string, string>> = {
  com: "text-syntax-com",
  str: "text-syntax-str",
  kw: "text-syntax-kw",
  num: "text-syntax-num",
  typ: "text-syntax-typ",
}

export type LineKind = "add" | "del" | "context" | "header" | "marker"

/** The five capture groups, in order: comment, string, keyword, number, type. `(?!)` never matches. */
interface Grammar {
  readonly com?: string
  readonly str?: string
  readonly kw?: string
  readonly num?: string
  readonly typ?: string
  readonly flags?: string
}

const C_COM = String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`
const HASH_COM = String.raw`#[^\n]*`
const STR = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`"
const NUM = String.raw`\b\d+(?:\.\d+)?\b`
const CAP = String.raw`\b[A-Z][A-Za-z0-9]+\b`
const words = (list: string): string => String.raw`\b(?:${list.trim().split(/\s+/).join("|")})\b`

const JS: Grammar = {
  com: C_COM,
  str: STR,
  kw: words(
    "const let var export import from return if else for while of in new function class extends interface type enum readonly async await default switch case break continue throw try catch finally typeof instanceof void null undefined true false number string boolean this",
  ),
  num: NUM,
  typ: CAP,
}

const GRAMMARS: Readonly<Record<string, Grammar>> = {
  js: JS,
  bash: {
    com: HASH_COM,
    str: STR,
    kw: words(
      "if then else elif fi for while until do done case esac in function export local return exit cd echo set unset source true false",
    ),
    num: NUM,
    typ: String.raw`\$(?:\w+|\{[^}\n]*\}|\([^)\n]*\))`,
  },
  json: {
    str: String.raw`"(?:[^"\\\n]|\\.)*"`,
    kw: words("true false null"),
    num: String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`,
  },
  yaml: {
    com: HASH_COM,
    str: STR,
    kw: words("true false null yes no on off"),
    num: NUM,
    typ: String.raw`^[ \t-]*[\w./-]+(?=:)`,
    flags: "m",
  },
  toml: {
    com: HASH_COM,
    str: STR,
    kw: words("true false"),
    num: NUM,
    typ: String.raw`^\[[^\]\n]+\]|^[\w.-]+(?=\s*=)`,
    flags: "m",
  },
  graphql: {
    com: HASH_COM,
    str: String.raw`"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"`,
    kw: words(
      "query mutation subscription fragment on type input enum interface union scalar schema extend directive implements true false null",
    ),
    num: NUM,
    typ: CAP,
  },
  python: {
    com: HASH_COM,
    str: String.raw`"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`,
    kw: words(
      "def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await None True False self",
    ),
    num: NUM,
    typ: CAP,
  },
  sql: {
    com: String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`,
    str: String.raw`'(?:[^']|'')*'|"[^"\n]*"`,
    kw: words(
      "select from where and or not insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as distinct union null is in like primary key foreign references default case when then else end",
    ),
    num: NUM,
    typ: CAP,
    flags: "i",
  },
  go: {
    com: C_COM,
    str: STR,
    kw: words(
      "package import func return if else for range switch case default break continue go defer chan select struct interface map type var const nil true false",
    ),
    num: NUM,
    typ: CAP,
  },
  css: {
    com: String.raw`\/\*[\s\S]*?\*\/`,
    str: STR,
    kw: String.raw`@[\w-]+|(?<![\w-])[\w-]+(?=\s*:)`,
    num: String.raw`-?\b\d*\.?\d+(?:[a-z%]+)?`,
    typ: String.raw`[.#][A-Za-z_][\w-]*`,
  },
  html: {
    com: String.raw`<!--[\s\S]*?-->`,
    str: STR,
    kw: String.raw`<\/?[A-Za-z][\w-]*|\/?>`,
    num: NUM,
    typ: String.raw`(?<![\w:-])[\w:-]+(?==)`,
  },
  diff: {
    com: String.raw`^(?:\+\+\+|---|diff |index ).*`,
    str: String.raw`^-.*`,
    kw: String.raw`^@@.*`,
    typ: String.raw`^\+.*`,
    flags: "m",
  },
}

const ALIASES: Readonly<Record<string, string>> = {
  ts: "js",
  tsx: "js",
  typescript: "js",
  jsx: "js",
  javascript: "js",
  mjs: "js",
  cjs: "js",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  jsonc: "json",
  yml: "yaml",
  gql: "graphql",
  py: "python",
  golang: "go",
  scss: "css",
  xml: "html",
  svg: "html",
  vue: "html",
}

const NEVER = "(?!)"
const compile = (g: Grammar): RegExp =>
  new RegExp(
    [g.com, g.str, g.kw, g.num, g.typ].map((part) => `(${part ?? NEVER})`).join("|"),
    `g${g.flags ?? ""}`,
  )

const COMPILED = new Map<string, RegExp>()
const regexFor = (language: string): RegExp | undefined => {
  const key = ALIASES[language] ?? language
  const grammar = GRAMMARS[key]
  if (grammar === undefined) return undefined
  let re = COMPILED.get(key)
  if (re === undefined) COMPILED.set(key, (re = compile(grammar)))
  return re
}

/** Which of the regex's five capture groups matched — exactly one is set per match. */
const classNameOf = (match: RegExpExecArray): string => {
  const [, com, str, kw, num] = match
  if (com !== undefined) return "com"
  if (str !== undefined) return "str"
  if (kw !== undefined) return "kw"
  if (num !== undefined) return "num"
  return "typ"
}

/**
 * Single-pass tokenizer: each character is visited at most once, and a
 * matched token is never re-scanned, so a string literal like `"const"` is one
 * `str` token. No `language` means the JS/TS grammar (diff hunks); a language
 * with no grammar renders as one plain token.
 */
export const tokenize = (code: string, language: string | undefined = "js"): Token[] => {
  const source = regexFor(language.toLowerCase())
  if (source === undefined) return [{ text: code }]
  const re = new RegExp(source)
  const tokens: Token[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (m[0] === "") {
      re.lastIndex++
      continue
    }
    if (m.index > lastIndex) tokens.push({ text: code.slice(lastIndex, m.index) })
    tokens.push({ text: m[0], className: classNameOf(m) })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < code.length) tokens.push({ text: code.slice(lastIndex) })
  return tokens
}

/** A hunk header (`@@ ... @@`) first, then git's own `\ No newline at end of file` marker (a bare `\`-prefixed line `Diff.ts` keeps verbatim in `hunk.lines`, never a `+`/`-`/context source line), else the diff prefix character — `+`/`-`/anything else (context, including a missing prefix on the last, unterminated line). */
export const lineKind = (line: string): LineKind => {
  if (line.startsWith("@@")) return "header"
  if (line.startsWith("\\")) return "marker"
  if (line.startsWith("+")) return "add"
  if (line.startsWith("-")) return "del"
  return "context"
}

/**
 * Tokenizes one diff line for rendering. A hunk header OR a `\ No newline at
 * end of file` marker is returned as a single plain token — never handed to
 * `tokenize`, and never `.slice(1)`'d — so it renders unhighlighted and
 * intact, matching the prototype for headers and (T8: "added, removed and
 * context lines are visually distinguishable" — this is deliberately NONE
 * of the three, so it must never be silently folded into "context") a
 * distinct fourth kind for the marker. Every other kind has its leading
 * diff-prefix character stripped before tokenizing.
 */
export const highlightDiffLine = (
  line: string,
): { readonly kind: LineKind; readonly tokens: readonly Token[] } => {
  const kind = lineKind(line)
  if (kind === "header" || kind === "marker") return { kind, tokens: [{ text: line }] }
  return { kind, tokens: tokenize(line.slice(1)) }
}

/** A body line's position in the old and new file; a side is absent where the line does not exist (`+` has no old number, `-` no new one, header and marker neither). */
export interface LineNumbers {
  readonly old?: number
  readonly new?: number
}

const HUNK_START = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Numbers every body line of a whole (unsliced) hunk from its `@@` header. */
export const numberHunkLines = (header: string, lines: readonly string[]): LineNumbers[] => {
  const match = HUNK_START.exec(header)
  if (match === null) return lines.map(() => ({}))
  let oldLine = Number(match[1])
  let newLine = Number(match[2])
  return lines.map((line): LineNumbers => {
    const kind = lineKind(line)
    if (kind === "add") return { new: newLine++ }
    if (kind === "del") return { old: oldLine++ }
    if (kind === "context") return { old: oldLine++, new: newLine++ }
    return {}
  })
}

/**
 * A range slice keeps the whole hunk's header, so its numbers come from
 * finding the slice inside the whole hunk's body (a slice is always a
 * contiguous run of it). No numbers when the slice is not found there.
 */
export const numberSlicedLines = (
  header: string,
  wholeLines: readonly string[],
  slice: readonly string[],
): LineNumbers[] => {
  const numbers = numberHunkLines(header, wholeLines)
  for (let start = 0; start + slice.length <= wholeLines.length; start++) {
    if (slice.every((line, i) => wholeLines[start + i] === line)) {
      return numbers.slice(start, start + slice.length)
    }
  }
  return slice.map(() => ({}))
}
