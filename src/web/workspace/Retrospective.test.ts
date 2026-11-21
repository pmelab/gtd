import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { RetrospectiveView } from "./Retrospective.js"
import { fullRun } from "./retrospective.fixture.js"

type History = Parameters<typeof RetrospectiveView>[0]["history"]

// The wire type makes `undefined` fields optional; the fixture sets them explicitly.
const html = (history = fullRun as unknown as History): string =>
  renderToStaticMarkup(RetrospectiveView({ history }))

describe("Retrospective", () => {
  it("shows a script step's exit: unknown, passed, or failed", () => {
    const out = html()
    expect(out).toContain("Failed · exit 1")
    expect(out).toContain("Exit 0")
    expect(out).toContain("Exit unknown")
  })

  it("shows the short hash and subject of a ship step's ship", () => {
    expect(html()).toContain("Shipped a1b2c3d feat: add it")
  })

  it("marks only the finished process", () => {
    expect(html().match(/ · finished/g)).toHaveLength(1)
  })

  it("lists the newest process first and opens only it", () => {
    const out = html()
    expect(out.indexOf("Add a retrospective tab")).toBeLessThan(out.indexOf("An older job"))
    expect(out.match(/data-testid="retro-process"/g)).toHaveLength(2)
    expect(out.match(/<details open="" class="min-w-0 rounded-lg/g)).toHaveLength(1)
  })

  it("shows only the worktree total when there is no process", () => {
    const out = html({ processes: [], total: 0, byModel: {} })
    expect(out).toContain("Worktree total $0.00")
    expect(out).not.toContain("retro-process")
  })
})
