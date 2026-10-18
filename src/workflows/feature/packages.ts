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
  readonly unchanged: boolean
}

const TEST_LINE = /^-\s+(unit|e2e):\s+`([^`]+)`(.*)$/
const MARKER = /^[ \t]+\(unchanged\)(?=\s|$)/i
const ITEM = /^\s*-\s/

/** The `## Tests` entries of a package file; malformed entries are ignored. */
export const declaredTests = (packageText: string): readonly DeclaredTest[] => {
  const found: DeclaredTest[] = []
  let inTests = false
  let entry: string | undefined
  const flush = () => {
    const match = entry === undefined ? null : TEST_LINE.exec(entry)
    if (match)
      found.push({
        level: match[1] as DeclaredTest["level"],
        path: match[2]!,
        unchanged: MARKER.test(match[3]!),
      })
    entry = undefined
  }
  // An entry is a list line plus its indented continuation lines (oxfmt wraps
  // long ones); a blank line, a new item or a heading ends it.
  for (const line of packageText.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^##\s/.test(line)) {
      flush()
      inTests = /^##\s+Tests\s*$/.test(line)
    } else if (!inTests) continue
    else if (ITEM.test(line)) {
      flush()
      entry = line.trim()
    } else if (entry !== undefined && /^\s/.test(line) && line.trim() !== "")
      entry = `${entry} ${line.trim()}`
    else flush()
  }
  flush()
  return found
}

export type DeclaredTestsTurn = "build" | "fix"

type Unmet = "notInDiff" | "modifiedMarked" | "deletedMarked" | "notInTree"

type Declared = { path: string; unchanged: boolean }

const diffBucket = (
  test: Declared,
  status: string | undefined,
  turn: DeclaredTestsTurn,
  satisfied: boolean,
): Unmet | undefined => {
  if (test.unchanged)
    return turn === "build" && status === "modified" ? "modifiedMarked" : undefined
  return !satisfied && (status === undefined || status === "deleted") ? "notInDiff" : undefined
}

const treeBucket = (test: Declared, status: string | undefined): Unmet | undefined => {
  if (read(test.path) !== undefined) return undefined
  return test.unchanged && status === "deleted" ? "deletedMarked" : "notInTree"
}

const unmetBucket = (
  test: Declared,
  change: { status: string } | undefined,
  turn: DeclaredTestsTurn,
  satisfied: boolean,
): Unmet | undefined =>
  diffBucket(test, change?.status, turn, satisfied) ?? treeBucket(test, change?.status)

/**
 * Refuse a build or fix turn unless every test `pkg` declares exists and is in the
 * diff since `since`. The package text is read as of `since`, so a builder
 * editing its own `## Tests` (or adding `(unchanged)`) cannot dodge the guard;
 * with `.gtd/SATISFIED.md` written, or the line marked, existing suffices. The
 * build turn must also leave a marked test unmodified; a fix turn may edit it.
 */
export const requireDeclaredTests = (
  pkg: string,
  since: string,
  turn: DeclaredTestsTurn = "fix",
): void => {
  const range = changesSince(since)
  const text = range.get(pkg)?.before ?? read(pkg) ?? ""
  const satisfied = read(".gtd/SATISFIED.md") !== undefined
  const buckets = {
    notInDiff: [] as string[],
    modifiedMarked: [] as string[],
    deletedMarked: [] as string[],
    notInTree: [] as string[],
  }
  const entries = declaredTests(text)
  for (const test of entries) {
    // A file listed both ways is written by the package: the unmarked entry wins.
    if (test.unchanged && entries.some((e) => !e.unchanged && e.path === test.path)) continue
    const bucket = unmetBucket(test, range.get(test.path), turn, satisfied)
    if (bucket) buckets[bucket].push(test.path)
  }
  const { notInDiff, modifiedMarked, deletedMarked, notInTree } = buckets
  const groups = [
    ["not in the package's diff — write them", notInDiff],
    ["marked (unchanged) but modified — revert them", modifiedMarked],
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
  const declared = (turn: () => Promise<void>, kind: DeclaredTestsTurn) => async () => {
    await turn()
    requireDeclaredTests(pkg, from, kind)
  }
  await declared(() => build(pkg), "build")()
  await healthy(declared(fixSuite, "fix"))
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
