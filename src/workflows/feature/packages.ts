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
import { build, fixSuite } from "./steps.js"

export interface DeclaredTest {
  readonly level: "unit" | "e2e"
  readonly path: string
}

const TEST_LINE = /^\s*-\s+(unit|e2e):\s+`([^`]+)`/

/** The `## Tests` entries of a package file; malformed lines are ignored. */
export const declaredTests = (packageText: string): readonly DeclaredTest[] => {
  const found: DeclaredTest[] = []
  let inTests = false
  for (const line of packageText.split("\n")) {
    if (/^##\s/.test(line)) inTests = /^##\s+Tests\s*$/.test(line)
    else if (inTests) {
      const match = TEST_LINE.exec(line)
      if (match) found.push({ level: match[1] as DeclaredTest["level"], path: match[2]! })
    }
  }
  return found
}

/**
 * Refuse a build or fix turn unless every test `pkg` declares exists and is in the
 * diff since `since`. The package text is read as of `since`, so a builder
 * editing its own `## Tests` cannot dodge the guard; with `.gtd/SATISFIED.md`
 * written, existing in the tree suffices.
 */
export const requireDeclaredTests = (pkg: string, since: string): void => {
  const range = changesSince(since)
  const text = range.get(pkg)?.before ?? read(pkg) ?? ""
  const satisfied = read(".gtd/SATISFIED.md") !== undefined
  const missing = declaredTests(text)
    .map((test) => test.path)
    .filter((path) =>
      satisfied
        ? read(path) === undefined
        : range.get(path) === undefined ||
          range.get(path)?.status === "deleted" ||
          read(path) === undefined,
    )
  if (missing.length === 0) return
  refuse(
    `gtd land: declared-tests: ${pkg} declares tests that are ${satisfied ? "missing from the tree" : "not in the package's diff"} — write them first:\n${missing.map((path) => `  - ${path}`).join("\n")}`,
  )
}

export interface PackageRange {
  readonly pkg: string
  readonly from: string
  readonly to: string
}

export interface BuiltPlan {
  readonly ranges: readonly PackageRange[]
}

/** Build `pkg`, check its declared tests, keep the fast suite green, and close it out, which removes it. */
export const packageItem = async (pkg: string): Promise<PackageRange> => {
  const from = head()
  // Rechecked after every fix too: a fix deleting a red declared test would
  // otherwise green the suite.
  const declared = (turn: () => Promise<void>) => async () => {
    await turn()
    requireDeclaredTests(pkg, from)
  }
  await declared(() => build(pkg))()
  await healthy(declared(fixSuite), { suite: "fast" })
  await run("closing", removeScript([pkg, ".gtd/SATISFIED.md"]), {
    label: "Closing out the package",
  })
  return { pkg, from, to: head() }
}

/** The first queued package — the one a package step works on. */
export const nextPackage = (): string | undefined => [...glob(".gtd/packages/*.md")].sort()[0]

/** Build every package file under `.gtd/packages/`, in name order. */
export const packages = (): Promise<BuiltPlan> =>
  scope("packages", async () => {
    const ranges: PackageRange[] = []
    for (let pkg = nextPackage(); pkg !== undefined; pkg = nextPackage()) {
      ranges.push(await scope("item", () => packageItem(pkg)))
    }
    return { ranges }
  })
