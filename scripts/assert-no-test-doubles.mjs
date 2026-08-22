import { readFileSync } from "node:fs"

// Cheap tripwire on top of the real guarantee (tsdown's bundle graph): a leak
// of `src/testing/**` into the shipped bundle carries this sentinel with it.
const SENTINEL = "gtd:test-double:never-ship"
const bundlePath = "dist/gtd.bundle.mjs"

const bundle = readFileSync(bundlePath, "utf8")
if (bundle.includes(SENTINEL)) {
  console.error(
    `${bundlePath} contains the test-double sentinel "${SENTINEL}" — src/testing/** leaked into the shipped bundle.`,
  )
  process.exit(1)
}
