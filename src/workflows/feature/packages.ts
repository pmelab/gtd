import {
  changesSince,
  glob,
  head,
  read,
  refuse,
  removeScript,
  run,
  scope,
} from "../../flows/index.js"
import { healthy } from "../shared/health.js"
import { ARCHITECTURE } from "../shared/steps.js"
import { build, fixSuite } from "./steps.js"

export interface DeclaredTest {
  readonly level: "unit" | "e2e"
  readonly path: string
  /** Decompose placed ` (unchanged)`: the test must exist, not be in the diff. */
  readonly unchanged: boolean
}

const TEST_LINE = /^\s*-\s+(unit|e2e):\s+`([^`]+)`(.*)$/
const MARKER = /^[ \t]+\(unchanged\)(?=\s|$)/i

/** The `## Tests` entries of a package file; malformed lines are ignored. */
export const declaredTests = (packageText: string): readonly DeclaredTest[] => {
  const found: DeclaredTest[] = []
  let inTests = false
  // oxfmt wraps a long line's ` (unchanged)` onto its own continuation line;
  // `[ \t]`, not `\s`, so the rejoin never crosses a blank line.
  const text = packageText.replace(/\r\n?/g, "\n").replace(/\n[ \t]+(?=\(unchanged\))/gi, " ")
  for (const line of text.split("\n")) {
    if (/^##\s/.test(line)) inTests = /^##\s+Tests\s*$/.test(line)
    else if (inTests) {
      const match = TEST_LINE.exec(line)
      if (match)
        found.push({
          level: match[1] as DeclaredTest["level"],
          path: match[2]!,
          unchanged: MARKER.test(match[3]!),
        })
    }
  }
  return found
}

/**
 * Refuse a build or fix turn unless every test `pkg` declares exists and is in the
 * diff since `since`. The package text is read as of `since`, so a builder
 * editing its own `## Tests` (or adding `(unchanged)`) cannot dodge the guard;
 * with `.gtd/SATISFIED.md` written, or the line marked, existing suffices.
 */
export const requireDeclaredTests = (pkg: string, since: string): void => {
  const range = changesSince(since)
  const text = range.get(pkg)?.before ?? read(pkg) ?? ""
  const satisfied = read(".gtd/SATISFIED.md") !== undefined
  const notInDiff: string[] = []
  const deletedMarked: string[] = []
  const notInTree: string[] = []
  for (const test of declaredTests(text)) {
    const change = range.get(test.path)
    const inDiff = change !== undefined && change.status !== "deleted"
    if (!satisfied && !test.unchanged && !inDiff) notInDiff.push(test.path)
    else if (read(test.path) === undefined)
      (test.unchanged && change?.status === "deleted" ? deletedMarked : notInTree).push(test.path)
  }
  const groups = [
    ["not in the package's diff — write them", notInDiff],
    ["marked (unchanged) but deleted — restore them", deletedMarked],
    ["missing from the tree", notInTree],
  ] as const
  const reasons = groups.filter(([, paths]) => paths.length > 0)
  if (reasons.length === 0) return
  refuse(
    `gtd land: declared-tests: ${pkg} declares tests this turn left unmet:\n${reasons
      .map(([reason, paths]) => `${reason}:\n${paths.map((path) => `  - ${path}`).join("\n")}`)
      .join("\n")}`,
  )
}

/**
 * Build `pkg`, check its declared tests, keep the full suite green, and close
 * it out, which removes it — and `.gtd/ARCHITECTURE.md` with the last one.
 */
export const packageItem = async (pkg: string): Promise<void> => {
  const from = head()
  // Rechecked after every fix too: a fix deleting a red declared test would
  // otherwise green the suite.
  const declared = (turn: () => Promise<void>) => async () => {
    await turn()
    requireDeclaredTests(pkg, from)
  }
  await declared(() => build(pkg))()
  await healthy(declared(fixSuite))
  const last = glob(".gtd/packages/*.md").length === 1
  await run("closing", removeScript([pkg, ".gtd/SATISFIED.md", ...(last ? [ARCHITECTURE] : [])]), {
    label: "Closing out the package",
  })
}

/** The first queued package — the one a package step works on. */
export const nextPackage = (): string | undefined => [...glob(".gtd/packages/*.md")].sort()[0]

/** Build every package file under `.gtd/packages/`, in name order. */
export const packages = (): Promise<void> =>
  scope("packages", async () => {
    for (let pkg = nextPackage(); pkg !== undefined; pkg = nextPackage()) {
      await scope("item", () => packageItem(pkg))
    }
  })
