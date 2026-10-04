import { describe, expect, it } from "vitest"
import { interpolate, isBashExemptPath } from "./interpolate.js"

describe("interpolate", () => {
  it("expands `$NAME` from the environment", () => {
    const { value, diagnostics } = interpolate(
      { vars: { model: "$BUILD_MODEL" } },
      { BUILD_MODEL: "smart" },
    )

    expect(value).toEqual({ vars: { model: "smart" } })
    expect(diagnostics).toEqual([])
  })

  it("expands `${NAME}` the same as the bare form", () => {
    const { value, diagnostics } = interpolate(
      { vars: { model: "${BUILD_MODEL}-fast" } },
      { BUILD_MODEL: "smart" },
    )

    expect(value).toEqual({ vars: { model: "smart-fast" } })
    expect(diagnostics).toEqual([])
  })

  it("recurses into arrays, rewriting string leaves only", () => {
    const { value, diagnostics } = interpolate(
      { skills: ["$A", "literal", 2, true, null] },
      { A: "expanded" },
    )

    expect(value).toEqual({ skills: ["expanded", "literal", 2, true, null] })
    expect(diagnostics).toEqual([])
  })

  it("passes numbers, booleans and null through untouched", () => {
    const { value, diagnostics } = interpolate(
      { ui: { port: 4173, strict: true, extra: null } },
      {},
    )

    expect(value).toEqual({ ui: { port: 4173, strict: true, extra: null } })
    expect(diagnostics).toEqual([])
  })

  it("`$$` consumes two characters and emits one literal `$`", () => {
    const { value, diagnostics } = interpolate({ vars: { price: "$$5" } }, {})

    expect(value).toEqual({ vars: { price: "$5" } })
    expect(diagnostics).toEqual([])
  })

  it("leaves a value with no `$` untouched", () => {
    const { value, diagnostics } = interpolate({ vars: { plannerModel: "smart" } }, {})

    expect(value).toEqual({ vars: { plannerModel: "smart" } })
    expect(diagnostics).toEqual([])
  })

  it.each([["$"], ["a$"], ["$1"], ["$-"], ["$ "]])("emits any other `$` literally: %s", (raw) => {
    const { value, diagnostics } = interpolate({ vars: { v: raw } }, {})

    expect(value).toEqual({ vars: { v: raw } })
    expect(diagnostics).toEqual([])
  })

  it("does NOT re-scan an expanded value that itself contains `$`", () => {
    const { value, diagnostics } = interpolate(
      { vars: { a: "$A" } },
      { A: "$B", B: "should-never-appear" },
    )

    expect(value).toEqual({ vars: { a: "$B" } })
    expect(diagnostics).toEqual([])
  })

  it("an unset name produces an error Diagnostic naming the config path, and leaves the value as-is", () => {
    const { value, diagnostics } = interpolate({ vars: { model: "$MISSING" } }, {})

    expect(value).toEqual({ vars: { model: "$MISSING" } })
    expect(diagnostics).toEqual([
      {
        severity: "error",
        path: ["vars", "model"],
        message: '"$MISSING" references environment variable "MISSING", which is not set',
        origin: "",
      },
    ])
  })

  describe("the bash exemption", () => {
    it("keeps `modes.*.format` byte-for-byte", () => {
      const { value, diagnostics } = interpolate(
        { modes: { adr: { format: "prettier --write $GTD_FILE" } } },
        {},
      )

      expect(value).toEqual({ modes: { adr: { format: "prettier --write $GTD_FILE" } } })
      expect(diagnostics).toEqual([])
    })

    it("keeps `modes.*.validate` byte-for-byte", () => {
      const { value, diagnostics } = interpolate(
        { modes: { adr: { validate: "adr-lint $GTD_FILE" } } },
        {},
      )

      expect(value).toEqual({ modes: { adr: { validate: "adr-lint $GTD_FILE" } } })
      expect(diagnostics).toEqual([])
    })

    it("keeps `ui.format` byte-for-byte", () => {
      const { value, diagnostics } = interpolate({ ui: { format: "oxfmt --write $GTD_FILE" } }, {})

      expect(value).toEqual({ ui: { format: "oxfmt --write $GTD_FILE" } })
      expect(diagnostics).toEqual([])
    })

    it("is a predicate over the path, not the value — a mode command naming a different variable still stays untouched", () => {
      const { value, diagnostics } = interpolate(
        { modes: { adr: { validate: "echo $SOME_OTHER_VAR" } } },
        {},
      )

      expect(value).toEqual({ modes: { adr: { validate: "echo $SOME_OTHER_VAR" } } })
      expect(diagnostics).toEqual([])
    })

    it("still expands `ui.host`, which is NOT exempt", () => {
      const { value, diagnostics } = interpolate({ ui: { host: "$HOST" } }, { HOST: "0.0.0.0" })

      expect(value).toEqual({ ui: { host: "0.0.0.0" } })
      expect(diagnostics).toEqual([])
    })
  })

  describe("isBashExemptPath", () => {
    it.each([
      [["modes", "adr", "format"], true],
      [["modes", "qa", "validate"], true],
      [["ui", "format"], true],
      [["ui", "host"], false],
      [["modes", "adr", "lint"], false],
      [["vars", "format"], false],
      [["ui"], false],
    ])("%j -> %s", (path, expected) => {
      expect(isBashExemptPath(path as readonly (string | number)[])).toBe(expected)
    })
  })
})
