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

export type LineKind = "add" | "del" | "context" | "header" | "marker"

/**
 * Ported verbatim from the prototype's own tokenizer, down to the token
 * classes: comment, string, keyword, number, capitalized identifier (typ).
 * Deliberately no grammar bundle — a `+`/`-`/` ` diff line on a phone screen
 * doesn't need one.
 */
const TOKEN_RE =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|\b(const|let|export|import|from|return|if|else|for|interface|type|readonly|number|string|undefined|new|of|function)\b|\b(\d+)\b|\b([A-Z][A-Za-z0-9]+)\b/g

/** Which of `TOKEN_RE`'s five capture groups matched — the regex guarantees exactly one is set per match, so the last (`typ`, the capitalized-identifier group) is the fallback. */
const classNameOf = (match: RegExpExecArray): string => {
  const [, com, str, kw, num] = match
  if (com !== undefined) return "com"
  if (str !== undefined) return "str"
  if (kw !== undefined) return "kw"
  if (num !== undefined) return "num"
  return "typ"
}

/**
 * Single-pass tokenizer: `exec` on a global regex advances its own
 * `lastIndex` forward through `code` on every call, so each character is
 * visited at most once. A matched token's text is pushed straight into the
 * output and never handed back to `TOKEN_RE` — so a string literal like
 * `"const"` is emitted whole, as one `str` token, and never re-scanned for
 * the keyword its contents happen to spell.
 */
export const tokenize = (code: string): Token[] => {
  const tokens: Token[] = []
  let lastIndex = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(code))) {
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
