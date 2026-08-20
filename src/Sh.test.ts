import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { renderShDocument, shQuote, shVarNames, type ShShape } from "./Sh.js"

const binaryString = () => fc.string({ unit: "binary" }).filter((s) => !s.includes("\0"))

/**
 * Mirrors real `sh` parsing of exactly the narrow grammar `shQuote` emits:
 * runs of `'...'` (copy verbatim until the next `'`) interleaved with a
 * literal `\'` outside quotes (the escaped-quote idiom `shQuote` uses to
 * splice an embedded `'` back in). Carries the bulk of the round-trip
 * property fast, without a subprocess per run.
 */
const unquoteSh = (encoded: string): string => {
  let result = ""
  let inQuotes = false
  let i = 0
  while (i < encoded.length) {
    const ch = encoded[i]
    if (inQuotes) {
      if (ch === "'") {
        inQuotes = false
        i++
        continue
      }
      result += ch
      i++
      continue
    }
    if (ch === "'") {
      inQuotes = true
      i++
      continue
    }
    if (ch === "\\" && encoded[i + 1] === "'") {
      result += "'"
      i += 2
      continue
    }
    result += ch
    i++
  }
  return result
}

describe("shQuote", () => {
  it("round-trips arbitrary strings through a pure POSIX unquoter", () => {
    fc.assert(
      fc.property(binaryString(), (s) => {
        expect(unquoteSh(shQuote(s))).toBe(s)
      }),
      { numRuns: 2000 },
    )
  })

  it("round-trips arbitrary strings through a real sh -c invocation", () => {
    fc.assert(
      fc.property(binaryString(), (s) => {
        const out = execFileSync("sh", ["-c", `x=${shQuote(s)}; printf %s "$x"`], {
          encoding: "utf8",
        })
        expect(out).toBe(s)
      }),
      { numRuns: 300 },
    )
  })

  it.each([
    ["an empty string", ""],
    ["only quotes", "'''"],
    ["a tab", "a\tb"],
    ["a newline", "a\nb"],
    ["a string that's literally '\\''", "'\\''"],
  ])("round-trips %s through a real sh -c invocation", (_label, s) => {
    const out = execFileSync("sh", ["-c", `x=${shQuote(s)}; printf %s "$x"`], { encoding: "utf8" })
    expect(out).toBe(s)
  })
})

describe("unset under set -u", () => {
  it("exits 0 on an already-unset variable", () => {
    const out = execFileSync("sh", ["-c", "set -u; unset nonexistent_var_xyz; echo $?"], {
      encoding: "utf8",
    })
    expect(out.trim()).toBe("0")
  })
})

const documentShape: ShShape = {
  kind: "scalar",
  idle: "bool",
  session: { id: "scalar", resume: "scalar" },
  changes: "list",
}

describe("renderShDocument — no variable survives its own document", () => {
  it("unsets every leaf absent from a sparse document, never leaving a prior document's value standing", () => {
    const full = renderShDocument("gtd", documentShape, {
      kind: "prompt",
      idle: true,
      session: { id: "abc123", resume: "xyz789" },
      changes: [{ pattern: "foo", target: "bar" }],
    })
    const sparse = renderShDocument("gtd", documentShape, { kind: "message" })

    const probe = [
      'printf "kind=[%s]\\n" "${gtd_kind:-}"',
      'printf "idle=[%s]\\n" "${gtd_idle:-}"',
      'printf "session_id=[%s]\\n" "${gtd_session_id:-}"',
      'printf "session_resume=[%s]\\n" "${gtd_session_resume:-}"',
      'printf "changes=[%s]\\n" "${gtd_changes:-}"',
    ].join("\n")

    const out = execFileSync("sh", ["-c", `${full}\n${sparse}\n${probe}`], { encoding: "utf8" })

    expect(out).toBe(
      ["kind=[message]", "idle=[]", "session_id=[]", "session_resume=[]", "changes=[]", ""].join(
        "\n",
      ),
    )
  })
})

describe("renderShDocument", () => {
  const shape: ShShape = {
    kind: "scalar",
    idle: "bool",
    disabled: "bool",
    label: "scalar",
    session: { id: "scalar", resume: "bool" },
    edges: "list",
  }

  it("emits exactly one unset line, naming every shape leaf, before any assignment", () => {
    const doc = renderShDocument("gtd", shape, { kind: "prompt" })
    const lines = doc.split("\n")
    expect(lines[0]).toBe(
      "unset gtd_kind gtd_idle gtd_disabled gtd_label gtd_session_id gtd_session_resume gtd_edges",
    )
    expect(lines.filter((l) => l.startsWith("unset")).length).toBe(1)
  })

  it("emits nothing for false, null, or an absent field — never 0/1 or an empty assignment", () => {
    const doc = renderShDocument("gtd", shape, {
      idle: false,
      disabled: null,
      label: undefined,
    })
    expect(doc).not.toContain("gtd_idle=")
    expect(doc).not.toContain("gtd_disabled=")
    expect(doc).not.toContain("gtd_label=")
  })

  it("emits `name=true` for a true boolean", () => {
    const doc = renderShDocument("gtd", shape, { idle: true })
    expect(doc).toContain("gtd_idle=true")
  })

  it("emits nothing for an empty array", () => {
    const doc = renderShDocument("gtd", shape, { edges: [] })
    expect(doc).not.toContain("gtd_edges=")
  })

  it("flattens nested objects with `_`", () => {
    const doc = renderShDocument("gtd", shape, { session: { id: "abc", resume: true } })
    expect(doc).toContain("gtd_session_id='abc'")
    expect(doc).toContain("gtd_session_resume=true")
  })

  it("derives TSV columns from the union of keys across rows, in first-seen order", () => {
    const doc = renderShDocument(
      "gtd",
      { edges: "list" },
      {
        edges: [
          { pattern: "a", target: "b" },
          { pattern: "c", target: "d", describe: "e" },
        ],
      },
    )
    expect(doc).toContain(`gtd_edges='a\tb\t\nc\td\te'`)
  })

  it("renders an empty column for a key absent from a given row, never misaligning the row", () => {
    const doc = renderShDocument(
      "gtd",
      { changes: "list" },
      {
        changes: [
          { pattern: null, target: "kept" },
          { pattern: "set", target: "kept" },
        ],
      },
    )
    expect(doc).toContain(`gtd_changes='\tkept\nset\tkept'`)
  })

  it("replaces a tab or newline inside a list cell's value with a single space", () => {
    const doc = renderShDocument(
      "gtd",
      { edges: "list" },
      {
        edges: [{ describe: "line one\nline two\tend" }],
      },
    )
    expect(doc).toContain(`gtd_edges='line one line two end'`)
  })

  it("does not replace tabs/newlines outside of list cells — a scalar's own quoting is untouched", () => {
    const doc = renderShDocument("gtd", shape, { label: "a\tb\nc" })
    expect(doc).toContain(`gtd_label='a\tb\nc'`)
  })
})

describe("shVarNames", () => {
  it("flattens leaves in shape declaration order", () => {
    expect(shVarNames("gtd", { a: "scalar", b: "bool", c: "list" })).toEqual([
      "gtd_a",
      "gtd_b",
      "gtd_c",
    ])
  })

  it("flattens one level of nesting with `_`, in declaration order", () => {
    expect(
      shVarNames("gtd", { kind: "scalar", session: { id: "scalar", resume: "bool" } }),
    ).toEqual(["gtd_kind", "gtd_session_id", "gtd_session_resume"])
  })

  it("flattens multiple levels of nesting", () => {
    expect(shVarNames("gtd", { x: { y: { z: "scalar" } } })).toEqual(["gtd_x_y_z"])
  })
})
