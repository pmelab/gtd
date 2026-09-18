import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// AGENTS.md's own-implementation-boundary rules are generic over path SHAPE,
// so they must be pinned against a real cruise of a fixture tree — not the
// live src/ tree, which happens to report zero violations either way and so
// can't tell a tightened pattern from a silently-wrong one.
//
// In-process `cruise()` with a `baseDir` option is NOT used here: `baseDir`
// does not rebase module resolution, every dependency resolves relative to
// this repo's own cwd, the fixture's `^src/` anchors never match, and the
// cruise reports zero violations regardless of the fixture's shape — the
// exact false green this test exists to catch. Spawning the real `depcruise`
// binary with `cwd` set to the fixture directory is the only way the `^src/`
// anchors see the fixture's own paths.
const REPO_ROOT = join(import.meta.dirname, "..", "..")

const FIXTURE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "NodeNext",
    moduleResolution: "nodenext",
    jsx: "react-jsx",
    allowJs: true,
    allowImportingTsExtensions: true,
    strict: true,
  },
  include: ["src"],
})

function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "boundaries-fixture-"))
  mkdirSync(join(dir, "src", "web", "screens"), { recursive: true })
  mkdirSync(join(dir, "src", "web", "testing"), { recursive: true })
  writeFileSync(join(dir, "tsconfig.json"), FIXTURE_TSCONFIG)
  writeFileSync(join(dir, "src", "web", "Neighbour.tsx"), `export const Neighbour = () => null\n`)
  writeFileSync(join(dir, "src", "web", "screens", "Hunk.tsx"), `export const Hunk = () => null\n`)
  writeFileSync(
    join(dir, "src", "web", "testing", "helper.fixture.ts"),
    `export const helper = 1\n`,
  )
  writeFileSync(
    join(dir, "src", "web", "screens", "Hunk.test.tsx"),
    [
      `import { Hunk } from "./Hunk.js"`,
      `import { Neighbour } from "../Neighbour.js"`,
      `import { helper } from "../testing/helper.fixture.js"`,
      `void Hunk`,
      `void Neighbour`,
      `void helper`,
      ``,
    ].join("\n"),
  )
  writeFileSync(join(dir, "src", "Foo.tsx"), `export const Foo = () => null\n`)
  writeFileSync(
    join(dir, "src", "Foo.test.tsx"),
    [
      `import { Foo } from "./Foo.js"`,
      `import { Hunk } from "./web/screens/Hunk.js"`,
      `void Foo`,
      `void Hunk`,
      ``,
    ].join("\n"),
  )
  return dir
}

const DEPCRUISE_BIN = join(REPO_ROOT, "node_modules", ".bin", "depcruise")

function cruise(fixtureDir: string, configPath: string) {
  const raw = execFileSync(
    DEPCRUISE_BIN,
    ["src", "--config", configPath, "--output-type", "json"],
    { cwd: fixtureDir, encoding: "utf8" },
  )
  const report = JSON.parse(raw) as {
    modules: Array<{
      source: string
      dependencies?: Array<{ resolved: string; valid: boolean; rules?: Array<{ name: string }> }>
    }>
  }
  const violations = report.modules.flatMap((m) =>
    (m.dependencies ?? [])
      .filter((d) => d.valid === false)
      .map((d) => ({
        from: m.source,
        to: d.resolved,
        rules: (d.rules ?? []).map((r) => r.name),
      })),
  )
  return violations
}

describe("import-boundary rules match nested tests and root .test.tsx", () => {
  it("reports both holes against the real .dependency-cruiser.mjs", () => {
    const fixtureDir = buildFixture()
    const violations = cruise(fixtureDir, join(REPO_ROOT, ".dependency-cruiser.mjs"))

    expect(violations).toContainEqual({
      from: "src/web/screens/Hunk.test.tsx",
      to: "src/web/Neighbour.tsx",
      rules: ["test-owns-impl"],
    })
    expect(violations).toContainEqual({
      from: "src/Foo.test.tsx",
      to: "src/web/screens/Hunk.tsx",
      rules: ["root-test-owns-impl"],
    })

    // The two allowed edges — nested test to its own implementation, and
    // nested test to its boundary's fixture helper — must stay clean, so a
    // pattern tightened past its intent fails here, not later on real code.
    const flaggedFromHunkTest = violations.filter((v) => v.from === "src/web/screens/Hunk.test.tsx")
    expect(flaggedFromHunkTest).toHaveLength(1)
    expect(violations).toHaveLength(2)
  })

  it("does not report either hole against the pre-fix rule shape", () => {
    const fixtureDir = buildFixture()
    const preFixConfigPath = join(fixtureDir, "pre-fix.dependency-cruiser.mjs")
    writeFileSync(
      preFixConfigPath,
      [
        `export default {`,
        `  forbidden: [`,
        `    {`,
        `      name: "test-owns-impl",`,
        `      severity: "error",`,
        `      from: { path: "^src/([^/]+)/([^/]+)\\\\.test\\\\.tsx?$" },`,
        `      to: { path: "^src/", pathNot: ["^src/$1/$2\\\\.(tsx?|mjs)$", "^src/[^/]+\\\\.ts$"] },`,
        `    },`,
        `    {`,
        `      name: "root-test-owns-impl",`,
        `      severity: "error",`,
        `      from: { path: "^src/([^/]+)\\\\.test\\\\.ts$" },`,
        `      to: { path: "^src/", pathNot: ["^src/$1\\\\.ts$"] },`,
        `    },`,
        `  ],`,
        `  options: { doNotFollow: { path: "node_modules" }, tsPreCompilationDeps: true, tsConfig: { fileName: "tsconfig.json" } },`,
        `}`,
        ``,
      ].join("\n"),
    )

    const violations = cruise(fixtureDir, preFixConfigPath)
    expect(violations).toHaveLength(0)
  })
})
