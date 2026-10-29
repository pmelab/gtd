import { describe, expect, it } from "vitest"
import { importsFrom } from "./imports.js"

const lookup = (specifier: string): string => `REG(${JSON.stringify(specifier)})`
const mod = { default: 1, a: 2, b: 3 }
const rewrite = (source: string): string => importsFrom(source, { "#w": mod }, lookup)

describe("importsFrom", () => {
  it("binds named, renamed, default and namespace imports", () => {
    expect(rewrite(`import d, { a, b as c, type T } from "#w"\nimport * as ns from '#w';`)).toBe(
      [
        `const __testkit_module_1 = REG("#w")`,
        `const d = __testkit_module_1["default"]`,
        `const a = __testkit_module_1["a"]`,
        `const c = __testkit_module_1["b"]`,
        `const __testkit_module_2 = REG("#w")`,
        `const ns = __testkit_module_2`,
      ].join("\n"),
    )
  })

  it("re-exports by name, as default, as a namespace and wholesale", () => {
    expect(
      rewrite(
        `export {\n  a as default,\n  b,\n} from "#w"\nexport * as ns from "#w"\nexport * from "#w"`,
      ),
    ).toBe(
      [
        `const __testkit_module_1 = REG("#w")`,
        `export default __testkit_module_1["a"]`,
        `export const b = __testkit_module_1["b"]`,
        `const __testkit_module_2 = REG("#w")`,
        `export const ns = __testkit_module_2`,
        `const __testkit_module_3 = REG("#w")`,
        `export const a = __testkit_module_3["a"]`,
        `export const b = __testkit_module_3["b"]`,
      ].join("\n"),
    )
  })

  it("drops type-only and bare imports, and leaves every other specifier alone", () => {
    const other = `import { agent } from "@pmelab/gtd/flows"\nexport default agent`
    expect(rewrite(`import type { T } from "#w"\nimport "#w"\n${other}`)).toBe(`\n\n${other}`)
  })

  it("never reads a statement across the code before it", () => {
    const source = `export default tiny\nimport { a } from "#w"`
    expect(rewrite(source)).toBe(
      `export default tiny\nconst __testkit_module_1 = REG("#w")\nconst a = __testkit_module_1["a"]`,
    )
  })

  it("refuses a name the module does not export", () => {
    expect(() => rewrite(`import { nope } from "#w"`)).toThrow(
      'testkit: module "#w" has no export "nope"',
    )
  })
})
