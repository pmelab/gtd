import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { compileTemplate } from "../../src/workflows/templates.js"
import {
  buildCloseWindowScript,
  buildOpenWindowScript,
  REVIEW_BASE_REF,
  REVIEW_HEAD_REF,
} from "../../src/ReviewWindow.js"

// Cross-checks the corpus file names against the COMPILED definition itself
// (not a hand-maintained list of state names), so a new `script` state added
// to src/workflows/unified.yaml with no matching corpus file fails here
// loudly instead of shipping uncovered by the shellcheck -s sh gate.
const CORPUS_DIR = new URL("../shell/corpus/", import.meta.url)

const readCorpus = (name: string): string =>
  readFileSync(new URL(name, CORPUS_DIR), "utf8").trimEnd()

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

// `scripts/generate-shell-corpus.ts` does NOT import `../src/ReviewWindow.js`
// (jiti can't load its transitive `unified.yaml` import — see the generator's
// own doc comment) — it replicates `buildOpenWindowScript`/
// `buildCloseWindowScript`'s bodies by hand instead. This test runs under
// vitest (which handles that import fine) and cross-checks the committed
// corpus against the REAL builders for the same fixture inputs, so a future
// change to either builder that the generator's copy doesn't follow fails
// here loudly instead of drifting silently.
describe("tests/shell/corpus/'s review-window fixtures match the real builders", () => {
  const SAMPLE_HEAD = "a".repeat(40)
  const SAMPLE_HEAD_2 = "b".repeat(40)

  it("review-window.open.bare.sh matches buildOpenWindowScript for the generator's fixture inputs", () => {
    const expected = buildOpenWindowScript({ base: SAMPLE_HEAD, head: "HEAD" })
    expect(readCorpus("review-window.open.bare.sh")).toBe(expected)
  })

  it("review-window.close.bare.sh matches buildCloseWindowScript for the generator's fixture inputs", () => {
    const expected = buildCloseWindowScript({
      headRef: REVIEW_HEAD_REF,
      baseRef: REVIEW_BASE_REF,
      headHash: SAMPLE_HEAD_2,
      legacy: false,
    })
    expect(readCorpus("review-window.close.bare.sh")).toBe(expected)
  })
})
