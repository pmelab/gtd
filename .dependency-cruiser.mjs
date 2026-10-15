// Every import rule this repository enforces, stated once each. The rules are
// generic over path SHAPE — `$1`/`$2` back-reference the captures in
// `from.path` — so "its own implementation file" and "its own boundary" need no
// per-module enumeration.
//
// A unit test is allowed its own implementation file, any boundary's published
// `index.ts`, its boundary's `*.fixture.ts` helpers, and type-only imports
// (erased at compile time, so no runtime coupling). What it may NOT reach is
// another FILE's internals — including its own neighbour's. The two variants
// exist only because `src/Foo.test.ts` and `src/mod/Foo.test.ts` capture
// differently; dependency-cruiser rejects the single optional-group regex that
// would unify them as ReDoS-unsafe.
// `test-owns-impl`'s path-tail capture is `.+` (not `[^/]+`) so a test nested
// more than one directory below its boundary is still matched — the boundary
// capture itself stays `[^/]+`, deliberately single-segment. Its fixture
// exception uses `.*` (not `(.+/)?[^/]+`) for the same reason: `safe-regex`
// rejects the natural optional-group spelling as star-height 2.
// `root-test-owns-impl` gains only `tsx?` here, not depth — its one capture
// stays `[^/]+` and matches nothing nested, by design.
const testMayReach = (own) => [
  own,
  "^src/[^/]+/index\\.ts$",
  "^src/[^/]+\\.ts$",
  "\\.(ya?ml|json|html)$",
]

// --- spec 03 ---
const productionExcluded =
  "(\\.test\\.tsx?|\\.fixture\\.ts|\\.steps\\.ts|\\.stories\\.tsx?)$|^tests/"

const compositionRoots = [
  // CLI entrypoint bundled as dist/gtd.bundle.mjs (tsdown.config.ts).
  "^src/main\\.ts$",
  // Wires the drivers and tools behind gtd's subcommands into the CLI.
  "^src/program\\.ts$",
]
const compositionRootTests = compositionRoots.map((root) =>
  root.replace("\\.ts$", "\\.test\\.tsx?$"),
)

// --- spec 20: unit map ---
// The target unit map. Every src/ folder belongs to exactly one unit; the
// rules below say which units, and which npm packages, each unit may import.
// They bind production code; a rule that says "tests included" binds a unit's
// tests too.
const units = {
  contracts: "^src/(flows|wire|steering)/",
  core: "^src/(cli|edge|emit|flags|install|platform|replay|step|workflow)/",
  kit: "^src/workflow-kit/",
  workflows: "^src/workflows/",
  drivers: "^(src/loop|claude)/",
  tools: "^src/(ui|web|lsp|judges)/",
  testkit: "^src/testkit/",
}
// What any import of repository code resolves to, as opposed to a package or builtin.
const local = ["^(src|claude|tests|evals|scripts)/", "^[^/]+\\.[cm]?[jt]sx?$"]
// Test support outside a test file: the web client's Storybook/Vitest browser helpers.
const testSupport = [productionExcluded, units.testkit, "^src/web/testing/"]
// Repository-root tooling config (vitest.config.ts, …) the tests import.
const rootConfig = "^[^/]+\\.[cm]?[jt]s$"

const pkg = (name) => `^(node_modules/)?${name.replace("*", "[^/]+")}(/|$)`

// Who may use each third-party package — derived from what each unit imports
// today. A package missing here fails `npm-unlisted`: a new dependency is a
// decision, not an accident.
const npmAllowList = [
  {
    packages: ["effect"],
    units: [
      units.core,
      units.workflows,
      units.testkit,
      "^src/(loop|lsp|ui)/",
      ...compositionRoots,
      ...compositionRootTests,
      "^tests/",
    ],
  },
  {
    packages: ["@effect/platform"],
    units: [units.testkit, "^src/(platform|ui)/", ...compositionRoots, ...compositionRootTests],
  },
  {
    packages: ["@effect/platform-node"],
    units: [
      units.testkit,
      "^src/cli/",
      ...compositionRoots,
      "^src/(platform|ui|workflow)/.+\\.test\\.ts$",
      "^tests/",
    ],
  },
  { packages: ["@standard-schema/spec"], units: ["^src/flows/"] },
  {
    packages: [
      "@types/mdast",
      "mdast-util-from-markdown",
      "mdast-util-gfm-*",
      "micromark-extension-gfm-*",
    ],
    units: ["^src/steering/"],
  },
  { packages: ["jiti"], units: ["^src/workflow/"] },
  {
    packages: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "@trpc/react-query",
      "tailwind-merge",
      "tailwindcss",
      "@tailwindcss/*",
      "zustand",
    ],
    units: ["^src/web/"],
  },
  { packages: ["@trpc/server", "@trpc/client"], units: ["^src/(ui|web)/", "^tests/"] },
  {
    packages: ["vscode-languageserver", "vscode-languageserver-textdocument"],
    units: ["^src/lsp/"],
  },
  { packages: ["claude-code"], units: ["^claude/"] },
  { packages: ["promptfoo"], units: ["^evals/"] },
  {
    packages: [
      "vitest",
      "@vitest/*",
      "fast-check",
      "quickpickle",
      "storybook",
      "@storybook/*",
      "vite",
      "yaml",
    ],
    units: testSupport,
    label: "tests and test support",
  },
]

const npmRules = npmAllowList.map(({ packages, units: allowed, label }) => ({
  name: `npm-${packages[0].replace(/[@/*]/g, "")}-only-where-used`,
  comment: `Unit map, npm dependencies: ${packages.join(", ")} only in ${label ?? allowed.join(", ")}.`,
  severity: "error",
  from: { pathNot: [...allowed, rootConfig] },
  to: { path: packages.map(pkg) },
}))

export default {
  forbidden: [
    {
      name: "test-owns-impl",
      comment:
        "A unit test under src/<boundary>/ imports the file it is named after, published barrels and its boundary's fixtures — never a neighbour's internals.",
      severity: "error",
      from: { path: "^src/([^/]+)/(.+)\\.test\\.tsx?$" },
      to: {
        path: "^src/",
        dependencyTypesNot: ["type-only"],
        pathNot: [...testMayReach("^src/$1/$2\\.(tsx?|mjs)$"), "^src/$1/.*\\.fixture\\.ts$"],
      },
    },
    {
      name: "root-test-owns-impl",
      comment: "Same rule for a test beside a root module: src/Foo.test.ts sees src/Foo.ts.",
      severity: "error",
      from: { path: "^src/([^/]+)\\.test\\.tsx?$" },
      to: {
        path: "^src/",
        dependencyTypesNot: ["type-only"],
        pathNot: testMayReach("^src/$1\\.(tsx?|mjs)$"),
      },
    },
    {
      name: "boundary-via-barrel",
      comment:
        "Files inside one src/<boundary>/ import each other freely; another boundary is reachable only through its index.ts.",
      severity: "error",
      from: { path: "^src/([^/]+)/" },
      to: {
        path: "^src/(?!$1/)[^/]+/(?!index\\.ts$)",
      },
    },
    {
      name: "root-reaches-in-via-barrel",
      comment:
        "src/*.ts stays deep-importable BY anyone (it has no barrel), but reaches into a boundary only through that boundary's index.ts.",
      severity: "error",
      from: { path: "^src/[^/]+\\.ts$" },
      to: { path: "^src/[^/]+/(?!index\\.ts$)" },
    },
    {
      name: "integration-via-barrel",
      comment: "tests/** sees published barrels only, never a module's internals.",
      severity: "error",
      from: { path: "^tests/" },
      to: { path: "^src/", pathNot: "^src/[^/]+/index\\.ts$" },
    },

    // --- spec 03 ---
    {
      name: "no-circular",
      comment: "Production modules form no import cycle.",
      severity: "error",
      from: { pathNot: productionExcluded },
      to: { circular: true, pathNot: productionExcluded },
    },
    {
      name: "root-no-boundary",
      comment:
        "A root module in src/*.ts imports no src/<boundary>/ — only composition roots wire boundaries together.",
      severity: "error",
      from: { path: "^src/[^/]+\\.tsx?$", pathNot: [productionExcluded, ...compositionRoots] },
      to: { path: "^src/[^/]+/" },
    },
    {
      name: "composition-root-not-imported",
      comment: "Nothing but another composition root or its own test imports a composition root.",
      severity: "error",
      from: {
        pathNot: [...compositionRoots, ...compositionRootTests],
      },
      to: { path: compositionRoots },
    },

    // --- spec 04 ---
    {
      name: "root-holds-composition-roots",
      comment:
        "src/ holds only composition roots and their tests; every other module lives in a boundary or contract folder.",
      severity: "error",
      from: {},
      module: {
        path: "^src/[^/]+$",
        pathNot: [...compositionRoots, ...compositionRootTests],
        // A module rule needs a dependents count to match on, and the schema
        // caps it at 100 — far above any module in this repository.
        numberOfDependentsLessThan: 100,
      },
    },

    // --- spec 11 ---
    {
      name: "workflows-only-through-subpath",
      comment:
        "The shipped workflows reach the engine only through a repository's gtd.config.ts: nothing outside src/workflows/ imports it — its index.ts is the @pmelab/gtd/workflows build entry.",
      severity: "error",
      from: { pathNot: "^src/workflows/" },
      to: { path: "^src/workflows/" },
    },

    // --- spec 20: unit map ---
    {
      name: "unit-map-is-total",
      comment:
        "Unit map, units: every src/ folder belongs to exactly one unit — a new folder is placed in the map before it lands.",
      severity: "error",
      from: {},
      module: {
        path: "^src/[^/]+/",
        pathNot: Object.values(units),
        numberOfDependentsLessThan: 100,
      },
    },
    {
      name: "contracts-import-nothing-outside-themselves",
      comment:
        "Unit map, contracts import nothing outside themselves: src/flows/, src/wire/ and src/steering/ each import only their own folder.",
      severity: "error",
      from: { path: "^src/(flows|wire|steering)/", pathNot: productionExcluded },
      to: { path: local, pathNot: "^src/$1/" },
    },
    {
      name: "flows-tests-import-no-src",
      comment:
        "Unit map, contracts import nothing outside themselves (tests included for flows): a src/flows/ test reaches no other src/ folder, so the facade loads standalone.",
      severity: "error",
      from: { path: "^src/flows/.+\\.test\\.tsx?$" },
      to: { path: "^src/(?!flows/)" },
    },
    {
      name: "core-imports-only-contracts",
      comment:
        "Unit map, core imports only contracts: the engine folders import each other and src/flows/, src/wire/, src/steering/ — never the kit, a workflow, a driver, a tool or testkit.",
      severity: "error",
      from: { path: units.core, pathNot: productionExcluded },
      to: { path: local, pathNot: [units.core, units.contracts] },
    },
    {
      name: "kit-imports-only-flows-and-steering",
      comment:
        "Unit map, kit imports only flows and steering: src/workflow-kit/ is policy-free building blocks.",
      severity: "error",
      from: { path: units.kit, pathNot: productionExcluded },
      to: { path: local, pathNot: [units.kit, "^src/(flows|steering)/"] },
    },
    {
      name: "kit-never-imports-workflows",
      comment:
        "Unit map, kit imports only flows and steering (tests included): the kit carries no workflow's policy.",
      severity: "error",
      from: { path: units.kit },
      to: { path: units.workflows },
    },
    {
      name: "workflows-import-only-flows-kit-steering",
      comment:
        "Unit map, workflows import only flows, kit and steering: a workflow folder under src/workflows/ imports, of src/, only those, src/workflows/shared/ and itself.",
      severity: "error",
      from: { path: "^src/workflows/([^/]+)/", pathNot: productionExcluded },
      to: {
        path: local,
        pathNot: ["^src/(flows|workflow-kit|steering)/", "^src/workflows/(shared|$1)/"],
      },
    },
    {
      name: "workflows-never-import-each-other",
      comment:
        "Unit map, workflows never import each other (tests included): feature, review and fix interact only through git and steering files; shared/ imports none of them.",
      severity: "error",
      from: { path: "^src/workflows/([^/]+)/" },
      to: { path: "^src/workflows/(?!shared/|$1/)[^/]+/" },
    },
    {
      name: "drivers-import-only-contracts",
      comment:
        "Unit map, drivers import only contracts (tests included): src/loop/ and claude/ reach core only through the wire contract and the gtd binary they spawn.",
      severity: "error",
      from: { path: "^(src/loop|claude)/", pathNot: "^claude/.+\\.test\\.tsx?$" },
      to: { path: local, pathNot: ["^$1/", units.contracts] },
    },
    {
      name: "claude-tests-import-only-contracts-and-judges",
      comment:
        "Unit map, drivers import only contracts (tests included): claude/'s tests may also read src/judges/, to pin the judge prompt the hooks mirror.",
      severity: "error",
      from: { path: "^claude/.+\\.test\\.tsx?$" },
      to: { path: local, pathNot: ["^claude/", units.contracts, "^src/judges/"] },
    },
    {
      name: "tools-import-only-contracts",
      comment:
        "Unit map, tools import only contracts (tests included): src/ui/, src/lsp/ and src/judges/ import their own folder and the contracts — never core.",
      severity: "error",
      from: { path: "^src/(ui|lsp|judges)/", pathNot: "^src/ui/.+\\.(test\\.tsx?|fixture\\.ts)$" },
      to: { path: local, pathNot: ["^src/$1/", units.contracts] },
    },
    {
      name: "ui-tests-import-only-contracts-and-platform",
      comment:
        "Unit map, tools import only contracts (tests included): src/ui/'s tests and fixtures may also build real src/platform/ layers.",
      severity: "error",
      from: { path: "^src/ui/.+\\.(test\\.tsx?|fixture\\.ts)$" },
      to: { path: local, pathNot: ["^src/ui/", units.contracts, "^src/platform/"] },
    },
    {
      name: "web-imports-only-contracts",
      comment:
        "Unit map, tools import only contracts: src/web/ imports itself and the contracts, plus the ui router's TYPES — the tRPC client is typed by the server it talks to, and a type import is erased before it runs.",
      severity: "error",
      from: { path: "^src/web/" },
      to: { path: local, pathNot: ["^src/web/", units.contracts, "^src/ui/index\\.ts$"] },
    },
    {
      name: "web-sees-ui-types-only",
      comment: "Unit map, tools import only contracts: src/web/ never imports ui code at runtime.",
      severity: "error",
      from: { path: "^src/web/" },
      to: { path: "^src/ui/", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "testkit-imports-only-core-and-flows",
      comment:
        "Unit map, testkit imports only core and flows: src/testkit/ runs any workflow against the real engine — never a workflow, the kit, a driver or a tool. Core's own vocabulary, src/wire/ and src/steering/, comes with it.",
      severity: "error",
      from: { path: units.testkit },
      to: { path: "^src/", pathNot: [units.testkit, units.core, units.contracts] },
    },
    {
      name: "production-never-imports-testkit",
      comment: "Unit map, production code never imports testkit.",
      severity: "error",
      from: { pathNot: [productionExcluded, units.testkit] },
      to: { path: units.testkit },
    },
    {
      name: "only-composition-roots-import-drivers-and-tools",
      comment:
        "Unit map, only composition roots import drivers and tools: they reach the CLI as the ToolCommands port, provided in src/program.ts.",
      severity: "error",
      from: { path: "^(src/[^/]+|claude)/", pathNot: productionExcluded },
      to: {
        path: [units.drivers, units.tools],
        pathNot: "^$1/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "pure-units-use-no-builtin",
      comment:
        "Unit map, npm dependencies — a Node builtin is one too: src/flows/ and src/steering/ load standalone, the kit and claude/'s hooks run where Node's modules may be missing.",
      severity: "error",
      from: {
        path: ["^src/(flows|steering|workflow-kit)/", "^claude/"],
        pathNot: productionExcluded,
      },
      to: { dependencyTypes: ["core"] },
    },

    {
      name: "flags-only-at-composition-points",
      comment:
        "src/flags/ is value-imported only by src/main.ts, src/program.ts, src/cli/Cli.ts, the CI lint scripts/lint-flags.ts and itself; type-only imports and test support are exempt.",
      severity: "error",
      from: {
        pathNot: [
          ...testSupport,
          "^src/flags/",
          ...compositionRoots,
          "^src/cli/Cli\\.ts$",
          "^scripts/lint-flags\\.ts$",
        ],
      },
      to: { path: "^src/flags/", dependencyTypesNot: ["type-only"] },
    },

    // --- spec 21 ---
    {
      name: "composition-roots-load-tools-lazily",
      comment:
        "Package entrypoints: a composition root reaches a driver or tool only through a dynamic import, so a command that runs none of them loads none.",
      severity: "error",
      from: { path: compositionRoots },
      to: {
        path: [units.drivers, units.tools],
        dependencyTypesNot: ["dynamic-import", "type-only"],
      },
    },
    ...npmRules,
    {
      name: "npm-standard-schemaspec-types-only",
      comment:
        "Unit map, npm dependencies: @standard-schema/spec is named for its types, never imported at runtime.",
      severity: "error",
      from: {},
      to: { path: pkg("@standard-schema/spec"), dependencyTypesNot: ["type-only"] },
    },
    {
      name: "npm-unlisted",
      comment:
        "Unit map, npm dependencies: a package no unit is allowed yet — add it to npmAllowList with the units that use it.",
      severity: "error",
      from: { pathNot: rootConfig },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-optional",
          "npm-peer",
          "npm-bundled",
          "npm-no-pkg",
          "npm-unknown",
        ],
        pathNot: npmAllowList.flatMap(({ packages }) => packages.map(pkg)),
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
}
