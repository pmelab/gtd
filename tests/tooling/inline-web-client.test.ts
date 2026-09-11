import { describe, expect, it } from "vitest"
import { buildGeneratedHtml } from "../../scripts/inline-web-client.mjs"

const TEMPLATE =
  '<!doctype html><head><link rel="stylesheet" href="./main.css" /></head>' +
  '<body><script type="module" src="./main.js"></script></body>'
const SCRIPT = "console.log('client')"
const CSS = "body{color:red}"

describe("buildGeneratedHtml", () => {
  it("throws when dist/web/main.css is missing", () => {
    expect(() => buildGeneratedHtml(TEMPLATE, SCRIPT, undefined, ["main.js"])).toThrow(
      /main\.css is missing/,
    )
  })

  it("throws when dist/web/main.css is empty", () => {
    expect(() => buildGeneratedHtml(TEMPLATE, SCRIPT, "   ", ["main.js", "main.css"])).toThrow(
      /main\.css is empty/,
    )
  })

  it("throws when any other emitted dist/web/ asset is left un-inlined", () => {
    expect(() =>
      buildGeneratedHtml(TEMPLATE, SCRIPT, CSS, ["main.js", "main.css", "main.js.map"]),
    ).toThrow(/main\.js\.map/)
  })

  it("inlines both the script and the css into one self-contained document", () => {
    const html = buildGeneratedHtml(TEMPLATE, SCRIPT, CSS, ["main.js", "main.css"])
    expect(html).not.toContain('src="./main.js"')
    expect(html).not.toContain('href="./main.css"')
    expect(html).toContain(SCRIPT)
    expect(html).toContain(CSS)
  })

  it("escapes a literal </style> inside the compiled CSS so it can't terminate the tag early", () => {
    const dangerousCss = "body{color:red}</style><script>alert(1)</script>"
    const html = buildGeneratedHtml(TEMPLATE, SCRIPT, dangerousCss, ["main.js", "main.css"])
    expect(html.match(/<\/style>/g)?.length).toBe(1)
  })

  it("throws when the script tag is missing from the template", () => {
    const noScriptTemplate = '<head><link rel="stylesheet" href="./main.css" /></head><body></body>'
    expect(() =>
      buildGeneratedHtml(noScriptTemplate, SCRIPT, CSS, ["main.js", "main.css"]),
    ).toThrow(/expected.*script/)
  })

  it("throws when the stylesheet link tag is missing from the template", () => {
    const noLinkTemplate = '<body><script type="module" src="./main.js"></script></body>'
    expect(() => buildGeneratedHtml(noLinkTemplate, SCRIPT, CSS, ["main.js", "main.css"])).toThrow(
      /expected.*link/,
    )
  })
})
