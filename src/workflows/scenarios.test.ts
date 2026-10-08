import { afterEach, describe, expect, it } from "vitest"
import { installContext, type StepRequest } from "../flows/index.js"
import {
  driftedScenarios,
  freezeScenarios,
  guarded,
  holdWording,
  scenarioText,
} from "./scenarios.js"
import { fixtureContext, renderText } from "./text.fixture.js"

afterEach(() => installContext(undefined))

const tree = (files: Record<string, string>) => ({
  read: (path: string) => files[path],
})

describe("scenarioText", () => {
  it("ignores comments, tags, blank lines and indentation", () => {
    const loose = [
      "@wip @slow",
      "Feature: x",
      "",
      "  # a comment",
      "    @tag",
      "  Scenario: y",
      "      Given a thing",
    ].join("\n")
    const tight = "Feature: x\nScenario: y\nGiven a thing"
    expect(scenarioText(loose)).toBe(scenarioText(tight))
  })

  it("keeps changed wording", () => {
    expect(scenarioText("Given a")).not.toBe(scenarioText("Given b"))
  })
})

describe("freezeScenarios", () => {
  it("snapshots wording at head, nothing frozen is undefined", () => {
    const files = { "a.feature": "@t\nGiven a" }
    renderText(() => {
      expect(freezeScenarios([])).toBeUndefined()
    })
    installContext(fixtureContext({ head: "h1" }, tree(files)))
    expect(freezeScenarios(["a.feature"])).toEqual({
      at: "h1",
      texts: { "a.feature": scenarioText("Given a") },
    })
  })

  it("merges over previous, a new path overriding an old one", () => {
    installContext(
      fixtureContext({ head: "h2" }, tree({ "b.feature": "Given b", "a.feature": "Given a2" })),
    )
    const merged = freezeScenarios(["a.feature", "b.feature"], {
      at: "h1",
      texts: { "a.feature": "Given a", "c.feature": "Given c" },
    })
    expect(merged).toEqual({
      at: "h2",
      texts: {
        "a.feature": "Given a2",
        "b.feature": "Given b",
        "c.feature": "Given c",
      },
    })
  })

  it("keeps previous untouched when no paths are given", () => {
    const previous = { at: "h1", texts: { "a.feature": "Given a" } }
    installContext(fixtureContext({ head: "h2" }, tree({})))
    expect(freezeScenarios([], previous)).toBe(previous)
  })
})

describe("driftedScenarios", () => {
  const frozen = { at: "h1", texts: { "a.feature": "Given a", "b.feature": "Given b" } }

  it("flags edited and deleted files, ignores comment-only edits and other paths", () => {
    installContext(
      fixtureContext({}, tree({ "a.feature": "# note\nGiven a2", "other.feature": "Given z" })),
    )
    expect(driftedScenarios(frozen)).toEqual(["a.feature", "b.feature"])
  })

  it("is empty while wording is unchanged", () => {
    installContext(
      fixtureContext({}, tree({ "a.feature": "  @x\n  Given a", "b.feature": "Given b" })),
    )
    expect(driftedScenarios(frozen)).toEqual([])
  })
})

describe("holdWording", () => {
  const run = async (
    files: () => Record<string, string>,
    frozen: Parameters<typeof holdWording>[0],
    head = "h2",
  ): Promise<StepRequest[]> => {
    const steps: StepRequest[] = []
    installContext(
      fixtureContext(
        { head },
        {
          read: (path) => files()[path],
          step: (request) => {
            steps.push(request)
            return Promise.resolve()
          },
        },
      ),
    )
    await holdWording(frozen)
    return steps
  }

  it("does nothing without a freeze or without drift", async () => {
    expect(await run(() => ({}), undefined)).toEqual([])
    const frozen = { at: "h1", texts: { "a.feature": "Given a" } }
    expect(await run(() => ({ "a.feature": "Given a" }), frozen)).toEqual([])
  })

  it("rests at scenario-wording with the removed and added lines and the restore command", async () => {
    const frozen = { at: "h1", texts: { "my dir/a.feature": "Given a\nThen ok" } }
    const steps = await run(() => ({ "my dir/a.feature": "Given a\nThen better" }), frozen)
    const [step] = steps
    if (step?.kind !== "human") throw new Error("expected a human step")
    expect(step.name).toBe("scenario-wording")
    expect(step.options.acceptClean).toBe(true)
    expect(step.options.base).toBe("h1")
    const message = step.options.message ?? ""
    expect(message).toContain("- Then ok")
    expect(message).toContain("+ Then better")
    expect(message).toContain("git checkout h1 -- 'my dir/a.feature'")
    expect(message).toContain("partial accept")
  })

  const shownDiff = async (before: string, after: string): Promise<string[]> => {
    const frozen = { at: "h1", texts: { "a.feature": before } }
    const [step] = await run(() => ({ "a.feature": after }), frozen)
    if (step?.kind !== "human") throw new Error("expected a human step")
    return (step.options.message ?? "").split("\n").filter((l) => /^[-+] /.test(l))
  }

  it("shows a moved step as one removal and one addition of it, in place", async () => {
    expect(await shownDiff("Given a\nWhen b\nThen c", "When b\nGiven a\nThen c")).toEqual([
      "- Given a",
      "+ Given a",
    ])
  })

  it("shows a repeated step as its added copy", async () => {
    expect(await shownDiff("Given a\nThen c", "Given a\nGiven a\nThen c")).toEqual(["+ Given a"])
  })

  it("accepts still-differing files by moving the snapshot to head", async () => {
    const frozen = { at: "h1", texts: { "a.feature": "Given a", "b.feature": "Given b" } }
    await run(() => ({ "a.feature": "Given a2", "b.feature": "Given b2" }), frozen)
    expect(frozen).toEqual({
      at: "h2",
      texts: { "a.feature": "Given a2", "b.feature": "Given b2" },
    })
  })

  it("rejects restored files, keeping the original wording frozen", async () => {
    const frozen = { at: "h1", texts: { "a.feature": "Given a", "b.feature": "Given b" } }
    let files: Record<string, string> = { "a.feature": "Given a2", "b.feature": "Given b2" }
    installContext(
      fixtureContext(
        { head: "h2" },
        {
          read: (path) => files[path],
          step: () => {
            files = { "a.feature": "Given a", "b.feature": "Given b2" }
            return Promise.resolve()
          },
        },
      ),
    )
    await holdWording(frozen)
    expect(frozen.texts).toEqual({ "a.feature": "Given a", "b.feature": "Given b2" })
  })

  it("drops an accepted deletion from the snapshot", async () => {
    const frozen = { at: "h1", texts: { "a.feature": "Given a" } }
    await run(() => ({}), frozen)
    expect(frozen.texts).toEqual({})
  })
})

describe("guarded", () => {
  it("runs the turn, then holds wording", async () => {
    const order: string[] = []
    const frozen = { at: "h1", texts: { "a.feature": "Given a" } }
    installContext(
      fixtureContext(
        { head: "h2" },
        {
          read: () => "Given changed",
          step: (request) => {
            order.push(request.kind)
            return Promise.resolve()
          },
        },
      ),
    )
    await guarded(frozen, () => {
      order.push("turn")
      return Promise.resolve()
    })()
    expect(order).toEqual(["turn", "human"])
  })

  it("is the bare turn without a freeze", async () => {
    const order: string[] = []
    installContext(fixtureContext())
    await guarded(undefined, () => {
      order.push("turn")
      return Promise.resolve()
    })()
    expect(order).toEqual(["turn"])
  })
})
