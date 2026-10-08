import {
  changesSince,
  type Change,
  glob,
  head,
  read,
  refuse,
  removeScript,
  run,
  scope,
} from "../flows/index.js"
import { healthy } from "./health.js"
import { freezeScenarios, guarded, type FrozenScenarios } from "./scenarios.js"
import { build, fixSuite } from "./steps.js"

/** Package 0: the e2e scenarios, written red. */
export const SCENARIO_PACKAGE = ".gtd/packages/00-e2e-scenarios.md"

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
 * Refuse the build turn unless every test `pkg` declares exists and is in the
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
  /** Paths package 0 added / modified outside `.gtd/`. */
  readonly scenarios: { readonly added: readonly string[]; readonly changed: readonly string[] }
  /** The wording snapshot after this run, to guard the tail and later laps. */
  readonly frozen: FrozenScenarios | undefined
}

/** Build `pkg`, check its declared tests, keep the fast suite green, and close it out, which removes it. */
export const packageItem = async (pkg: string, frozen?: FrozenScenarios): Promise<PackageRange> => {
  const from = head()
  await guarded(frozen, () => build(pkg))()
  requireDeclaredTests(pkg, from)
  await healthy(guarded(frozen, fixSuite), { suite: "fast" })
  await run("closing", removeScript([pkg, ".gtd/SATISFIED.md"]), {
    label: "Closing out the package",
  })
  return { pkg, from, to: head() }
}

/** The first queued package — the one a package step works on. */
export const nextPackage = (): string | undefined => [...glob(".gtd/packages/*.md")].sort()[0]

const outsideGtd = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

/** Build every package file under `.gtd/packages/`, in name order. */
export const packages = (carried?: FrozenScenarios): Promise<BuiltPlan> =>
  scope("packages", async () => {
    let frozen = carried
    const ranges: PackageRange[] = []
    // Captured right after package 0: a later diff to the tree would also hold what 01…N touch.
    let touched: readonly Change[] = []
    for (let pkg = nextPackage(); pkg !== undefined; pkg = nextPackage()) {
      const range = await scope("item", () =>
        packageItem(pkg, pkg === SCENARIO_PACKAGE ? undefined : frozen),
      )
      ranges.push(range)
      if (pkg === SCENARIO_PACKAGE) {
        touched = changesSince(range.from).filter(
          (c) => outsideGtd(c.path) && c.status !== "deleted",
        )
        frozen = freezeScenarios(
          touched.filter((c) => c.path.endsWith(".feature")).map((c) => c.path),
          frozen,
        )
      }
    }
    const paths = (status: string): string[] =>
      touched.filter((c) => c.status === status).map((c) => c.path)
    return { ranges, scenarios: { added: paths("added"), changed: paths("modified") }, frozen }
  })
