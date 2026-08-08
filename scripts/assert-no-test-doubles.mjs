import { readFileSync } from "node:fs"

// `src/testing/InMemRepo.ts`'s `TEST_DOUBLE_SENTINEL` is embedded in every
// runtime value the fake reaches (a public instance field, and the tail of
// `strictGitOperations`'s default not-implemented message) — so a leak of
// either into the shipped CLI bundle shows up here as a plain string match.
// The real guarantee is the bundle graph (tsdown's `entry: src/main.ts`,
// `codeSplitting: false`); this is a cheap, fast-failing tripwire on top of it.
const SENTINEL = "gtd:test-double:never-ship"
const bundlePath = "dist/gtd.bundle.mjs"

const bundle = readFileSync(bundlePath, "utf8")
if (bundle.includes(SENTINEL)) {
  console.error(
    `${bundlePath} contains the test-double sentinel "${SENTINEL}" — src/testing/** leaked into the shipped bundle.`,
  )
  process.exit(1)
}
