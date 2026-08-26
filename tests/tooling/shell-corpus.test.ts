import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { compileTemplate } from "../../src/workflows/templates.js"

// Cross-checks the corpus file names against the COMPILED definition itself
// (not a hand-maintained list of state names), so a new `script` state added
// to src/workflows/unified.yaml with no matching corpus file fails here
// loudly instead of shipping uncovered by the shellcheck -s sh gate.
const CORPUS_DIR = new URL("../shell/corpus/", import.meta.url)

describe("tests/shell/corpus/ covers every script-content state of the bundled workflow", () => {
  it("has exactly one workflow.<state>.sh file per compiled script state, and no orphans", () => {
    const { definition } = compileTemplate()
    const scriptStateNames = Object.entries(definition.states)
      .filter(([, state]) => state.script !== undefined)
      .map(([name]) => name)
      .sort()

    expect(scriptStateNames.length).toBeGreaterThan(0)

    const corpusFiles = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".sh"))
    const workflowCorpusFiles = corpusFiles.filter((f) => f.startsWith("workflow."))
    const namesFromCorpus = workflowCorpusFiles
      .map((f) => f.slice("workflow.".length, -".sh".length))
      .sort()

    expect(namesFromCorpus).toEqual(scriptStateNames)
  })
})
