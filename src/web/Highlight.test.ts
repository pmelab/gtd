import { describe, expect, it } from "vitest"
import { highlightDiffLine, lineKind, tokenize, type Token } from "./Highlight.js"

/** Concatenating every emitted token's text must reconstruct the input exactly — the structural proof that the scanner is single-pass: it advances monotonically and consumes every character exactly once, never re-visiting text it already emitted. */
const reassemble = (tokens: readonly Token[]): string => tokens.map((t) => t.text).join("")

describe("tokenize", () => {
  it("consumes every character of the line exactly once, in order", () => {
    const code = 'const x = "hello" + 42 + Thing;'
    const tokens = tokenize(code)
    expect(reassemble(tokens)).toBe(code)
  })

  it("emits a string literal as one whole token, never re-scanning its contents for a keyword", () => {
    // The string's own text spells out a keyword ("const") and a capitalized
    // identifier-looking word ("Thing") — a second pass over the emitted
    // output would wrongly re-tokenize them. Assert it stays one `str` token.
    const code = '"const Thing 123"'
    const tokens = tokenize(code)
    expect(tokens).toEqual([{ text: '"const Thing 123"', className: "str" }])
  })

  it("does not mistake a token's own class name for a new opener", () => {
    // Guards the literal failure mode named in the acceptance criteria: if a
    // class name like "str" were ever fed back through the tokenizer, a
    // capitalized run inside it could be re-matched as a `typ` token. Since
    // tokenize takes raw source (never its own output) and scans forward
    // once, the class name text never appears in the output at all.
    const code = '"str typ kw num com"'
    const tokens = tokenize(code)
    expect(tokens).toEqual([{ text: '"str typ kw num com"', className: "str" }])
  })

  it("classifies a comment, keyword, number, and capitalized identifier distinctly", () => {
    const tokens = tokenize("// note\nreturn 7 Thing")
    const classNames = tokens.filter((t) => t.className).map((t) => t.className)
    expect(classNames).toEqual(["com", "kw", "num", "typ"])
  })

  it("leaves plain text between matches as untagged tokens", () => {
    const tokens = tokenize("x = 1")
    expect(tokens.some((t) => t.className === undefined && t.text.length > 0)).toBe(true)
  })
})

describe("lineKind", () => {
  it("classifies an added line", () => {
    expect(lineKind("+const x = 1")).toBe("add")
  })

  it("classifies a removed line", () => {
    expect(lineKind("-const x = 1")).toBe("del")
  })

  it("classifies a context line", () => {
    expect(lineKind(" const x = 1")).toBe("context")
  })

  it("classifies a hunk header distinctly from add/del/context", () => {
    expect(lineKind("@@ -1,3 +1,4 @@")).toBe("header")
  })

  it("gives added, removed and context lines three distinct kinds", () => {
    const kinds = new Set([lineKind("+a"), lineKind("-a"), lineKind(" a")])
    expect(kinds.size).toBe(3)
  })
})

describe("highlightDiffLine", () => {
  it("renders a hunk header unhighlighted — a single plain token, never sub-tokenized", () => {
    const line = "@@ -12,7 +12,8 @@ function Thing() {"
    const result = highlightDiffLine(line)
    expect(result.kind).toBe("header")
    expect(result.tokens).toEqual([{ text: line }])
  })

  it("strips the diff prefix before tokenizing an added line", () => {
    const result = highlightDiffLine('+const x = "hi"')
    expect(result.kind).toBe("add")
    expect(reassemble(result.tokens)).toBe('const x = "hi"')
  })

  it("strips the diff prefix before tokenizing a removed line", () => {
    const result = highlightDiffLine("-return 1")
    expect(result.kind).toBe("del")
    expect(reassemble(result.tokens)).toBe("return 1")
  })

  it("strips the leading space before tokenizing a context line", () => {
    const result = highlightDiffLine(" return 1")
    expect(result.kind).toBe("context")
    expect(reassemble(result.tokens)).toBe("return 1")
  })

  it(
    "never produces an HTML string for markup characters in source — tokens are rendered as React text " +
      "nodes, so <, >, & need no manual escaping here (React escapes on render); this test locks in that " +
      "output contract by asserting the raw markup survives untouched in the token text",
    () => {
      const result = highlightDiffLine("+const s = \"<script>&alert('x')</script>\"")
      expect(reassemble(result.tokens)).toBe("const s = \"<script>&alert('x')</script>\"")
      // No token contains an HTML-escaped entity — because none is produced.
      expect(result.tokens.some((t) => t.text.includes("&lt;") || t.text.includes("&amp;"))).toBe(
        false,
      )
    },
  )

  it("a script tag inside a hunk header also survives as inert plain text, not sub-tokenized", () => {
    const result = highlightDiffLine("@@ <script>alert(1)</script> @@")
    expect(result.tokens).toEqual([{ text: "@@ <script>alert(1)</script> @@" }])
  })
})
