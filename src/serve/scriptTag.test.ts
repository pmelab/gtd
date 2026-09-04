import { describe, expect, it } from "vitest"
import { inlineScript } from "./scriptTag.mjs"

describe("inlineScript", () => {
  it("does not expand $& (or other replacement-pattern syntax) found literally inside the script being inlined", () => {
    const template = '<!doctype html><body><script type="module" src="./main.js"></script></body>'
    // React's real key-escaping does exactly this: .replace(re, "$&/").
    const script = 'const escaped = key.replace(RE, "$&/")'
    const html = inlineScript(template, script)
    expect(html).toContain(script)
    expect(html.match(/<\/script>/g)?.length).toBe(1)
  })

  it("escapes a literal </script> inside the script being inlined, so it cannot terminate the tag early", () => {
    const template = '<!doctype html><body><script type="module" src="./main.js"></script></body>'
    const script = 'const s = "</script>"'
    const html = inlineScript(template, script)
    expect(html.match(/<\/script>/g)?.length).toBe(1)
    expect(html).toContain('"<\\/script>"')
  })
})
