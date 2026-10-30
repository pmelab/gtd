import { readFileSync } from "node:fs"

// Cheap tripwire on top of the real guarantee (tsdown's bundle graph): a leak
// of `src/twins/**` (or `src/testkit/**`) into the shipped bundle carries this sentinel with it.
const SENTINEL = "gtd:test-double:never-ship"

for (const bundlePath of ["dist/gtd.bundle.mjs", "dist/gtd.core.mjs"]) {
  const bundle = readFileSync(bundlePath, "utf8")
  if (bundle.includes(SENTINEL)) {
    console.error(
      `${bundlePath} contains the test-double sentinel "${SENTINEL}" — src/twins/** or src/testkit/** leaked into the shipped bundle.`,
    )
    process.exit(1)
  }
}
