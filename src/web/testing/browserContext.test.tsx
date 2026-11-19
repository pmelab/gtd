/// <reference types="vite/client" />
import { composeStory, setProjectAnnotations } from "@storybook/react-vite"
import { unmountElement } from "@storybook/react-dom-shim"
import { describe, expect, test } from "vitest"
import preview from "../../../.storybook/preview.js"
import { auditLayout, viewport } from "./browserContext.js"

setProjectAnnotations([preview])

const stories = import.meta.glob<Record<string, unknown>>("../**/*.stories.tsx", { eager: true })
const WIDTHS = [
  [360, 800],
  [1440, 900],
] as const
const THEME = "light"

const settle = async (): Promise<void> => {
  await document.fonts.ready
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

// The token the theme toolbar pins on <html>; empty when no theme is pinned.
const pinnedBackground = (): string =>
  document.documentElement.style.getPropertyValue("--color-background")

const renderIn = async (theme: string): Promise<void> => {
  const composed = composeStory({ render: () => <div /> }, {}, { initialGlobals: { theme } })
  const canvasElement = document.createElement("div")
  document.body.appendChild(canvasElement)
  await composed.run({ canvasElement })
  unmountElement(canvasElement)
  canvasElement.remove()
}

const mount = (html: string): HTMLElement => {
  const host = document.createElement("div")
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

test("the theme toolbar pins a different background for light and dark", async () => {
  await renderIn("light")
  const light = pinnedBackground()
  await renderIn("dark")
  const dark = pinnedBackground()
  expect(light).not.toBe("")
  expect(dark).not.toBe("")
  expect(dark).not.toBe(light)
})

describe("auditLayout", () => {
  test("fails a page that scrolls sideways", async () => {
    await viewport(360, 800)
    const host = mount('<div style="width:900px;height:10px"></div>')
    expect(auditLayout(host, { targets: true }).join()).toMatch(/scrolls sideways/)
    host.remove()
  })

  test("passes a code box that scrolls inside itself", async () => {
    await viewport(360, 800)
    const host = mount(
      '<pre style="width:300px;overflow:auto"><div style="width:900px;height:10px"></div></pre>',
    )
    expect(auditLayout(host, { targets: true })).toEqual([])
    host.remove()
  })

  test("fails a small target, but not a document-text link", async () => {
    await viewport(360, 800)
    const host = mount(
      '<button style="width:20px;height:20px">x</button><p><a href="#">l</a></p><h3><a href="#">h</a></h3>',
    )
    const problems = auditLayout(host, { targets: true })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/button/)
    expect(problems[1]).toMatch(/<a> "h"/)
    host.remove()
  })

  test("skips disabled and hidden targets", async () => {
    await viewport(360, 800)
    const host = mount(
      '<button disabled style="width:20px;height:20px">x</button><button style="display:none">y</button>',
    )
    expect(auditLayout(host, { targets: true })).toEqual([])
    host.remove()
  })

  test("skips target checks when targets is false", async () => {
    await viewport(360, 800)
    const host = mount('<button style="width:20px;height:20px">x</button>')
    expect(auditLayout(host, { targets: false })).toEqual([])
    host.remove()
  })
})

describe.each(Object.entries(stories))("%s", (file, module) => {
  const meta = module["default"] as Parameters<typeof composeStory>[1]
  for (const [name, story] of Object.entries(module)) {
    if (name === "default") continue
    for (const [width, height] of WIDTHS) {
      test(`${name} at ${width}px in ${THEME}`, async () => {
        await viewport(width, height)
        const composed = composeStory(
          { ...(story as object), play: undefined } as unknown as Parameters<
            typeof composeStory
          >[0],
          meta,
          { initialGlobals: { theme: THEME } },
          name,
        )
        const canvasElement = document.createElement("div")
        document.body.appendChild(canvasElement)
        let problems: string[]
        try {
          await composed.run({ canvasElement })
          await settle()
          expect(pinnedBackground()).not.toBe("")
          expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe(THEME)
          problems = auditLayout(canvasElement, { targets: width === 360 })
        } finally {
          unmountElement(canvasElement)
          canvasElement.remove()
        }
        if (problems.length > 0) throw new Error(`${file} ${name}: ${problems.join(" | ")}`)
      })
    }
  }
})
