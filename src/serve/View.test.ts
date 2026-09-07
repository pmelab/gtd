import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { QA_FORMAT } from "../OpenQuestions.js"
import { REVIEW_FORMAT } from "../ReviewDoc.js"
import type { SteeringAnchor, SteeringViewNode } from "../SteeringFormat.js"
import { steeringViewFor } from "./View.js"

const flattenAnchors = (nodes: readonly SteeringViewNode[]): readonly SteeringAnchor[] =>
  nodes.flatMap((node) => [node.anchor, ...flattenAnchors(node.children ?? [])])

describe("steeringViewFor", () => {
  it("delegates a review-mode document to REVIEW_FORMAT's own view, verbatim", () => {
    const result = steeringViewFor("review", REVIEW_FORMAT.sample)
    expect(result).toEqual({ ok: true, view: REVIEW_FORMAT.view(REVIEW_FORMAT.sample) })
  })

  it("delegates a qa-mode document to QA_FORMAT's own view, verbatim", () => {
    const result = steeringViewFor("qa", QA_FORMAT.sample)
    expect(result).toEqual({ ok: true, view: QA_FORMAT.view(QA_FORMAT.sample) })
  })

  it("yields a review view whose anchors are chunk/hunk-shaped, never question/option-shaped", () => {
    const result = steeringViewFor("review", REVIEW_FORMAT.sample)
    if (!result.ok) throw new Error("expected ok")
    const kinds = flattenAnchors(result.view.nodes).map((a) => a.kind)
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds).not.toContain("question")
    expect(kinds).not.toContain("option")
  })

  it("returns the typed unsupported-mode refusal for an unregistered mode name, not a throw or an empty view", () => {
    const result = steeringViewFor("not-a-real-mode", "some content")
    expect(result).toEqual({ ok: false, reason: "unsupported-mode" })
  })

  it("imports no format module and switches on no mode-name string", () => {
    const source = readFileSync(fileURLToPath(new URL("./View.ts", import.meta.url)), "utf8")
    expect(source).not.toMatch(/from ["']\.\.\/ReviewDoc\.js["']/)
    expect(source).not.toMatch(/from ["']\.\.\/OpenQuestions\.js["']/)
    expect(source).not.toMatch(/\bswitch\s*\(/)
    expect(source).not.toMatch(/mode\s*===\s*["'](qa|review)["']/)
  })
})
