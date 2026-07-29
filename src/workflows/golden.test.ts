import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
import { describe, expect, it } from "vitest"
import { compileWorkflowConfig } from "../PatternConfig.js"

/**
 * The GOLDEN EQUIVALENCE guarantee for Option C (sub-machines).
 *
 * `unified.yaml` (the shipped bundled template) is authored with
 * `submachines:`/`use:` for dedup + comprehension. `unified.flat.yaml` is the
 * FROZEN, hand-flat reference — exactly the template as it stood before the
 * sub-machine rewrite. This test compiles both through the real
 * `compileWorkflowConfig` (which expands sub-machines) and asserts the resulting
 * `WorkflowDefinition`s are DEEP-EQUAL: same state names, same `on`-edge order,
 * same `retry`/flags, same rendered content strings.
 *
 * That makes "sub-machine expansion introduces NO external behavior change" a
 * checked invariant, not a claim: the engine only ever sees the flat states, and
 * they are byte-for-byte what a hand-written flat workflow produces. Editing
 * `unified.yaml`'s shape must keep this green (update BOTH the template and the
 * flat reference deliberately, never weaken this test).
 */
const compileFile = (name: string) => {
  const text = readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")
  return compileWorkflowConfig(parseYaml(text), ".").definition
}

describe("unified.yaml golden equivalence (sub-machine form === flat form)", () => {
  it("compiles byte-identically to the pinned flat definition", () => {
    expect(compileFile("./unified.yaml")).toEqual(compileFile("./unified.flat.yaml"))
  })
})
