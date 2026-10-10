import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

// Beyond depcruise's own check, a baseline entry that no longer occurs fails
// too: the baseline only shrinks, so a fixed violation must leave it, or it
// could come back unnoticed. The count comes from a second, JSON cruise: the
// first one's output is for people.
const BASELINE = ".dependency-cruiser-known-violations.json"
const args = ["src", "tests", "--ignore-known"]

try {
  execFileSync("depcruise", args, { stdio: "inherit" })
} catch (error) {
  process.exit(error.status ?? 1)
}

const { summary } = JSON.parse(
  execFileSync("depcruise", [...args, "--output-type", "json"], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }),
)
const stale = JSON.parse(readFileSync(BASELINE, "utf8")).length - summary.ignore
console.log(`depcruise baseline: ${summary.ignore} known violations`)
if (stale > 0) {
  console.error(
    `${stale} ${BASELINE} entries no longer occur — remove them (\`npx depcruise-baseline src tests\` once no new violation is reported).`,
  )
  process.exit(1)
}
