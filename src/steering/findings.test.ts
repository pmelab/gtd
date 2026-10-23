import { describe, expect, it } from "vitest"
import { applySteeringEdits, findingEntries, steeringFormatFor } from "./index.js"

const format = steeringFormatFor("findings")!

const gate = (box: string, guidance = ""): string =>
  `# Quality\n\n## a\n\nBody.\n\n${box}\n${guidance === "" ? "" : `\n${guidance}\n`}`

const messages = (content: string): string[] => format.validate(content).map((f) => f.message)

describe("the findings format", () => {
  it("reads a ticked box and the guidance below it", () => {
    expect(findingEntries(gate("- [x] fix", "Round half up."))).toEqual([
      expect.objectContaining({ title: "a", body: "Body.", fix: true, guidance: "Round half up." }),
    ])
  })

  it("reads guidance a formatter folded into the box's own line", () => {
    expect(findingEntries(gate("- [x] fix use a map"))[0]).toMatchObject({
      fix: true,
      guidance: "use a map",
    })
  })

  it("refuses guidance under an unticked box", () => {
    expect(messages(gate("- [ ] fix", "Round half up."))).toEqual([
      '"a" has guidance under an unticked box — tick it to fix the finding, or delete the text to drop it',
    ])
  })

  it("refuses a finding with no box, or with two", () => {
    expect(messages(gate("- [ ] maybe"))[0]).toContain("has no `- [ ] fix` box")
    expect(messages(gate("- [ ] fix\n- [x] fix"))[0]).toContain("has 2 `fix` boxes")
  })

  it("ticks with guidance, and unticking drops the guidance with the tick", () => {
    const write = (content: string, opts: { checked?: boolean; text?: string }): string => {
      const result = format.apply(content, { kind: "chunk", index: 0 }, opts)
      if (!result.ok) throw new Error(result.reason)
      return applySteeringEdits(content, result.edits)
    }
    const ticked = write(gate("- [ ] fix"), { checked: true, text: "Round half up." })
    expect(ticked).toBe(gate("- [x] fix", "Round half up."))
    expect(write(ticked, { checked: false })).toBe(gate("- [ ] fix"))
    expect(write(ticked, { checked: true, text: "Round half up." })).toBe(ticked)
  })
})
