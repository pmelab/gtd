import { describe, expect, test } from "vitest"

import { pastedCommand } from "./paste"

describe("pastedCommand", () => {
  test("a long multi-line /gtd prompt yields the whole argument", () => {
    const body = Array.from({ length: 60 }, (_, i) => `- requirement ${i} with some detail`).join(
      "\n\n",
    )
    expect(body.length).toBeGreaterThan(1000)
    expect(pastedCommand(`/gtd ${body}\n`)).toEqual({ arg: body })
  })

  test("trims only the ends", () => {
    expect(pastedCommand("/gtd   a\n\n  b  \n")).toEqual({ arg: "a\n\n  b" })
  })

  test("an unexpanded placeholder is lost, pointing at .gtd/TODO.md", () => {
    const r = pastedCommand("/gtd [Pasted text #1 +40 lines]")
    expect(r).toHaveProperty("lost")
    const lost = (r as { lost: string }).lost
    expect(lost).toContain(".gtd/TODO.md")
    expect(lost).toContain("/gtd")
  })

  test("a placeholder after typed words is lost too", () => {
    expect(pastedCommand("/gtd build this: [Pasted text #2 +5 lines]")).toHaveProperty("lost")
  })

  test.each(["plain text", "/gtdx do it", "please run /gtd now", "/gtd", "/gtd   ", ""])(
    "%j is not a pasted command",
    (text) => {
      expect(pastedCommand(text)).toBeUndefined()
    },
  )
})
