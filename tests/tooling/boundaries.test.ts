import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
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

function buildSpec03Fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "boundaries-spec03-"))
  mkdirSync(join(dir, "src", "a"), { recursive: true })
  mkdirSync(join(dir, "src", "b"), { recursive: true })
  writeFileSync(join(dir, "tsconfig.json"), FIXTURE_TSCONFIG)
  const files: Record<string, string> = {
    "src/a/index.ts": `import { b } from "../b/index.js"\nexport const a = () => b\n`,
    "src/b/index.ts": `import { a } from "../a/index.js"\nexport const b = () => a\n`,
    "src/a/x.test.ts": `import { y } from "./y.test.js"\nexport const x = y\n`,
    "src/a/y.test.ts": `import { x } from "./x.test.js"\nexport const y = x\n`,
    "src/a/f.fixture.ts": `import { g } from "./g.fixture.js"\nexport const f = () => g\n`,
    "src/a/g.fixture.ts": `import { f } from "./f.fixture.js"\nexport const g = () => f\n`,
    "src/a/S.stories.tsx": `import { t } from "./T.stories.js"\nexport const s = () => t\n`,
    "src/a/T.stories.tsx": `import { s } from "./S.stories.js"\nexport const t = () => s\n`,
    "src/Root.ts": `import { a } from "./a/index.js"\nexport const root = a\n`,
    "src/main.ts": `import { a } from "./a/index.js"\nimport { run } from "./program.js"\nvoid a\nvoid run\n`,
    "src/program.ts": `import { b } from "./b/index.js"\nexport const run = b\n`,
    "src/program.test.ts": `import { run } from "./program.js"\nvoid run\n`,
    "src/Root.test.ts": `import { run } from "./program.js"\nvoid run\n`,
  }
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content)
  return dir
}

describe("spec 03: cycle and root-module rules", () => {
  it("flags production cycles, root-to-boundary imports and importers of composition roots", () => {
    const violations = cruise(buildSpec03Fixture(), join(REPO_ROOT, ".dependency-cruiser.mjs"))
    const byRule = (rule: string) =>
      violations.filter((v) => v.rules.includes(rule)).map((v) => `${v.from} -> ${v.to}`)

    expect(byRule("no-circular").toSorted()).toEqual([
      "src/a/index.ts -> src/b/index.ts",
      "src/b/index.ts -> src/a/index.ts",
    ])
    expect(byRule("root-no-boundary")).toEqual(["src/Root.ts -> src/a/index.ts"])
    expect(byRule("composition-root-not-imported").toSorted()).toEqual([
      "src/Root.test.ts -> src/program.ts",
      "src/main.ts -> src/program.ts",
    ])
  })

  it("lint:boundaries fails once a baseline entry no longer occurs", () => {
    const dir = buildSpec03Fixture()
    mkdirSync(join(dir, "tests"))
    copyFileSync(join(REPO_ROOT, ".dependency-cruiser.mjs"), join(dir, ".dependency-cruiser.mjs"))
    const bin = join(REPO_ROOT, "node_modules", ".bin")
    execFileSync(join(bin, "depcruise-baseline"), ["src", "tests"], { cwd: dir })
    const lint = () =>
      spawnSync("node", [join(REPO_ROOT, "scripts", "lint-boundaries.mjs")], {
        cwd: dir,
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
        encoding: "utf8",
      })

    expect(lint().status).toBe(0)
    writeFileSync(join(dir, "src", "Root.ts"), `export const root = 1\n`)
    const stale = lint()
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain(
      "1 .dependency-cruiser-known-violations.json entries no longer occur",
    )
  })

  // Holds vacuously once later specs empty the baseline — it pins "nothing
  // else", not that the current cycles are recorded.
  it("baseline records only violations of the spec 03 rules", () => {
    const baseline = JSON.parse(
      readFileSync(join(REPO_ROOT, ".dependency-cruiser-known-violations.json"), "utf8"),
    ) as Array<{ rule: { name: string } }>
    const rules = new Set(baseline.map((v) => v.rule.name))
    for (const rule of rules)
      expect(["no-circular", "root-no-boundary", "composition-root-not-imported"]).toContain(rule)
  })
})
