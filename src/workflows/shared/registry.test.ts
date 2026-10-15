import { afterEach, describe, expect, it } from "vitest"
import { installContext } from "../../flows/index.js"
import { flagReferences, flipProblems, registryEntry, requireFlag } from "./registry.js"

const ONE_LINE = `export const FLAGS = [
  { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
  { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release", defaultOn: true },
  { name: "gamma", owner: "c", expiry: "2027-03-01", kind: "ops" },
] as const
`

const WRAPPED = `export const FLAGS = [
  {
    name: "alpha",
    owner: "a",
    expiry: "2027-01-01",
    kind: "release",
  },
  {
    name: "beta",
    owner: "b",
    expiry: "2027-02-01",
    kind: "release",
    defaultOn: true,
  },
] as const
`

describe("registryEntry", () => {
  it("finds name, kind and defaultOn in a one-line entry", () => {
    expect(registryEntry(ONE_LINE, "alpha")).toEqual({
      kind: "release",
      defaultOn: false,
    })
    expect(registryEntry(ONE_LINE, "beta")).toEqual({
      kind: "release",
      defaultOn: true,
    })
    expect(registryEntry(ONE_LINE, "gamma")?.kind).toBe("ops")
  })

  it("finds them in an oxfmt-wrapped entry", () => {
    expect(registryEntry(WRAPPED, "alpha")).toEqual({
      kind: "release",
      defaultOn: false,
    })
    expect(registryEntry(WRAPPED, "beta")?.defaultOn).toBe(true)
  })

  it("is undefined for an unknown name", () => {
    expect(registryEntry(ONE_LINE, "delta")).toBeUndefined()
  })

  it("ignores a kind inside a block comment ahead of the real one", () => {
    const text = 'export const FLAGS = [{ name: "alpha", /* kind: "ops" */ kind: "release" }]'
    expect(registryEntry(text, "alpha")?.kind).toBe("release")
  })

  it("reads no kind from one with no closing quote", () => {
    const text = 'export const FLAGS = [{ name: "alpha", kind: "release-candidate" }]'
    expect(registryEntry(text, "alpha")?.kind).toBe("")
  })

  it("reads the kind right after a comment with no space between", () => {
    const text = 'export const FLAGS = [{ name: "alpha", /*x*/kind: "release" }]'
    expect(registryEntry(text, "alpha")?.kind).toBe("release")
  })

  it("ignores a kind inside a line comment on a prior line", () => {
    const text =
      'export const FLAGS = [{\n  name: "alpha",\n  // kind: "ops"\n  kind: "release",\n}]'
    expect(registryEntry(text, "alpha")?.kind).toBe("release")
  })

  it("ignores a kind inside a string ahead of the real one", () => {
    const text = `export const FLAGS = [{ name: "alpha", owner: "kind: 'ops'", kind: "release" }]`
    expect(registryEntry(text, "alpha")?.kind).toBe("release")
  })
})

describe("flipProblems", () => {
  it("is empty when defaultOn is added to the named entry", () => {
    const after = ONE_LINE.replace(
      'kind: "release" },\n  { name: "beta"',
      'kind: "release", defaultOn: true },\n  { name: "beta"',
    )
    expect(after).not.toBe(ONE_LINE)
    expect(flipProblems(ONE_LINE, after, "alpha")).toEqual([])
  })

  it("is empty when false flips to true", () => {
    const before = ONE_LINE.replace('kind: "release" },', 'kind: "release", defaultOn: false },')
    const after = ONE_LINE.replace('kind: "release" },', 'kind: "release", defaultOn: true },')
    expect(flipProblems(before, after, "alpha")).toEqual([])
  })

  it("ignores re-wrapping and a trailing comma inside the entry", () => {
    const after = WRAPPED.replace(
      'kind: "release",\n  },',
      'kind: "release",\n    defaultOn: true,\n  },',
    )
    expect(flipProblems(WRAPPED, after, "alpha")).toEqual([])
    const oneLiner = ONE_LINE.replace(
      'kind: "release" },\n  { name: "beta"',
      'kind: "release", defaultOn: true, },\n  { name: "beta"',
    )
    expect(flipProblems(ONE_LINE, oneLiner, "alpha")).toEqual([])
  })

  describe("with a non-BMP character in the entry", () => {
    const EMOJI =
      'export const FLAGS = [\n  { name: "alpha", owner: "Team 🚀", kind: "release" },\n]'

    it("is empty for an oxfmt re-wrap with a trailing comma", () => {
      const after =
        'export const FLAGS = [\n  {\n    name: "alpha",\n    owner: "Team 🚀",\n    kind: "release",\n    defaultOn: true,\n  },\n]'
      expect(flipProblems(EMOJI, after, "alpha")).toEqual([])
    })

    it("faults an out-of-scope edit to a field after the emoji", () => {
      const before =
        'export const FLAGS = [\n  { name: "alpha", owner: "Team 🚀", kind: " release", defaultOn: false },\n]'
      const after =
        'export const FLAGS = [\n  { name: "alpha", owner: "Team 🚀", kind: "release", defaultOn: true },\n]'
      expect(flipProblems(before, after, "alpha")).toContain(
        'entry "alpha" changed beyond defaultOn',
      )
    })
  })

  it("faults a change to a second entry", () => {
    const after = ONE_LINE.replace(
      'kind: "release" },',
      'kind: "release", defaultOn: true },',
    ).replace('owner: "c"', 'owner: "z"')
    expect(flipProblems(ONE_LINE, after, "alpha")).not.toEqual([])
  })

  it("faults an owner or expiry change inside the entry", () => {
    const owner = ONE_LINE.replace(
      'owner: "a", expiry: "2027-01-01", kind: "release"',
      'owner: "q", expiry: "2027-01-01", kind: "release", defaultOn: true',
    )
    const expiry = ONE_LINE.replace(
      'owner: "a", expiry: "2027-01-01", kind: "release"',
      'owner: "a", expiry: "2030-01-01", kind: "release", defaultOn: true',
    )
    expect(flipProblems(ONE_LINE, owner, "alpha")).not.toEqual([])
    expect(flipProblems(ONE_LINE, expiry, "alpha")).not.toEqual([])
  })

  it("faults a comment outside the entry", () => {
    const after = `// note\n${ONE_LINE.replace('kind: "release" },', 'kind: "release", defaultOn: true },')}`
    expect(flipProblems(ONE_LINE, after, "alpha")).not.toEqual([])
  })

  it("faults defaultOn: false", () => {
    const after = ONE_LINE.replace('kind: "release" },', 'kind: "release", defaultOn: false },')
    expect(flipProblems(ONE_LINE, after, "alpha")).not.toEqual([])
  })

  it("faults an unchanged registry", () => {
    expect(flipProblems(ONE_LINE, ONE_LINE, "alpha")).toEqual([
      '"alpha" is not set to defaultOn: true',
    ])
  })

  it("faults a removed entry", () => {
    expect(flipProblems(ONE_LINE, "export const FLAGS = []\n", "alpha")).toEqual([
      'entry "alpha" is gone',
    ])
  })

  it("faults defaultOn smuggled into a string instead of set as a property", () => {
    const after = ONE_LINE.replace('owner: "a"', 'owner: "adefaultOn: true"')
    expect(flipProblems(ONE_LINE, after, "alpha")).not.toEqual([])
  })

  it("faults whitespace edited inside a string", () => {
    const before = ONE_LINE.replace('owner: "a"', 'owner: "a b"')
    const after = before
      .replace('owner: "a b"', 'owner: "ab"')
      .replace('kind: "release" },', 'kind: "release", defaultOn: true },')
    expect(flipProblems(before, after, "alpha")).not.toEqual([])
  })

  it("is empty for a flip when a JSDoc example of the entry precedes the array", () => {
    const doc = '/** e.g. { name: "alpha", kind: "ops" } */\n'
    const after = ONE_LINE.replace('kind: "release" },', 'kind: "release", defaultOn: true },')
    expect(flipProblems(doc + ONE_LINE, doc + after, "alpha")).toEqual([])
  })
})

describe("flipProblems trailing commas", () => {
  const flip = (s: string) => s.replace('kind: "release" }', 'kind: "release", defaultOn: true }')

  it("faults a comma-brace dropped inside a string", () => {
    const before = ONE_LINE.replace('owner: "a"', 'owner: "team,}blue"')
    const after = flip(before).replace('"team,}blue"', '"team}blue"')
    expect(flipProblems(before, after, "alpha")).toContain('entry "alpha" changed beyond defaultOn')
  })

  it("faults a comma-brace dropped inside a comment", () => {
    const before = ONE_LINE.replace('kind: "release" }', 'kind: "release", /* a,} */ }')
    const after = flip(before).replace("/* a,} */", "/* a} */")
    expect(flipProblems(before, after, "alpha")).toContain('entry "alpha" changed beyond defaultOn')
  })

  it("passes a real trailing comma added or removed", () => {
    const comma = flip(ONE_LINE).replace("defaultOn: true }", "defaultOn: true, }")
    expect(flipProblems(ONE_LINE, comma, "alpha")).toEqual([])
    const before = ONE_LINE.replace('kind: "release" }', 'kind: "release", }')
    expect(flipProblems(before, flip(ONE_LINE), "alpha")).toEqual([])
  })
})

describe("requireFlag", () => {
  afterEach(() => installContext(undefined))

  const asFile = (text: string | undefined) =>
    installContext({
      read: (path: string) => (path === "reg.ts" ? text : undefined),
      refuse: (message: string): never => {
        throw new Error(message)
      },
    } as never)

  it("accepts a flag that matches", () => {
    asFile(ONE_LINE)
    expect(() => requireFlag("rollout", "reg.ts", "alpha", false)).not.toThrow()
    expect(() => requireFlag("cleanup", "reg.ts", "beta", true)).not.toThrow()
  })

  it("refuses an empty name", () => {
    asFile(ONE_LINE)
    expect(() => requireFlag("rollout", "reg.ts", "", false)).toThrow(
      "gtd: rollout needs --var flag=<name>",
    )
  })

  it("refuses an unknown flag, and a missing registry", () => {
    asFile(ONE_LINE)
    expect(() => requireFlag("cleanup", "reg.ts", "nope", true)).toThrow(
      'gtd: cleanup: no flag "nope" in reg.ts',
    )
    asFile(undefined)
    expect(() => requireFlag("rollout", "reg.ts", "alpha", false)).toThrow(
      'gtd: rollout: no flag "alpha" in reg.ts',
    )
  })

  it("refuses a non-release flag", () => {
    asFile(ONE_LINE)
    expect(() => requireFlag("rollout", "reg.ts", "gamma", false)).toThrow(
      'gtd: rollout: flag "gamma" is ops, not release',
    )
  })

  it("refuses the wrong default", () => {
    asFile(ONE_LINE)
    expect(() => requireFlag("rollout", "reg.ts", "beta", false)).toThrow(
      'gtd: rollout: flag "beta" is already default-on',
    )
    expect(() => requireFlag("cleanup", "reg.ts", "alpha", true)).toThrow(
      'gtd: cleanup: flag "alpha" is not default-on — roll it out first',
    )
  })
})

describe("flagReferences", () => {
  it("reports path:line for the flag's env var in shipped sources", () => {
    const files = [
      { path: "src/a.ts", text: "x\nconst on = env.GTD_FLAG_ALPHA\n" },
      { path: "src/web/b.tsx", text: "GTD_FLAG_ALPHA\n\nGTD_FLAG_ALPHA" },
      { path: "src/c.ts", text: "nothing\n" },
    ]
    expect(flagReferences(files, "alpha")).toEqual([
      "src/a.ts:2",
      "src/web/b.tsx:1",
      "src/web/b.tsx:3",
    ])
  })

  it("ignores test, fixture and stories files and longer names", () => {
    const text = "GTD_FLAG_ALPHA\n"
    const files = [
      { path: "src/a.test.ts", text },
      { path: "src/a.fixture.ts", text },
      { path: "src/a.stories.tsx", text },
      { path: "src/b.ts", text: "GTD_FLAG_ALPHA_X\nXGTD_FLAG_ALPHA\n" },
    ]
    expect(flagReferences(files, "alpha")).toEqual([])
  })

  it("matches regex metacharacters in the name literally", () => {
    const files = [
      { path: "src/a.ts", text: "GTD_FLAG_AXB\nGTD_FLAG_A.B\n" },
      { path: "src/b.ts", text: "GTD_FLAG_AAB\nGTD_FLAG_A+B\n" },
    ]
    expect(flagReferences(files, "a.b")).toEqual(["src/a.ts:2"])
    expect(flagReferences(files, "a+b")).toEqual(["src/b.ts:2"])
    expect(() => flagReferences(files, "a(b")).not.toThrow()
    expect(flagReferences(files, "a(b")).toEqual([])
  })
})
