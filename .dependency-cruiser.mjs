// Every import rule this repository enforces, stated once each. The rules are
// generic over path SHAPE — `$1`/`$2` back-reference the captures in
// `from.path` — so "its own implementation file" and "its own boundary" need no
// per-module enumeration, and adding a `src/<boundary>/` needs no edit here.
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
const productionExcluded = "(\\.test\\.tsx?|\\.fixture\\.ts|\\.stories\\.tsx?)$|^tests/"

const compositionRoots = [
  // CLI entrypoint bundled as dist/gtd.bundle.mjs (tsdown.config.ts).
  "^src/main\\.ts$",
  // Command dispatch: wires every boundary into the runnable commands.
  "^src/program\\.ts$",
]

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
        // `src/ui/Server.ts` imports `../web/generated.html`, a build-time
        // asset inlined by scripts/inline-web-client.mjs — not a module
        // crossing a boundary.
        pathNot: "\\.html$",
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
      name: "judges-is-leaf",
      comment:
        "src/judges/ imports nothing else from src/ — a later extraction is a git mv plus a bin entry.",
      severity: "error",
      from: { path: "^src/judges/" },
      to: { path: "^src/(?!judges/)" },
    },
    {
      name: "judges-only-from-dispatch",
      comment:
        "Only the CLI dispatch (src/program.ts) imports src/judges/; flows and engine never do.",
      severity: "error",
      from: { path: "^src/(?!judges/|program\\.ts$)", pathNot: "\\.test\\.tsx?$" },
      to: { path: "^src/judges/" },
    },
    {
      name: "integration-via-barrel",
      comment: "tests/** sees published barrels only, never a module's internals.",
      severity: "error",
      from: { path: "^tests/" },
      to: { path: "^src/", pathNot: "^src/[^/]+/index\\.ts$" },
    },

    // --- spec 03 ---
    // Known violations live in .dependency-cruiser-known-violations.json and
    // are skipped via --ignore-known; later specs shrink it to zero.
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
      comment: "Nothing outside its own test imports a composition root.",
      severity: "error",
      from: { pathNot: compositionRoots.map((root) => root.replace("\\.ts$", "\\.test\\.tsx?$")) },
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
        pathNot: [
          ...compositionRoots,
          ...compositionRoots.map((root) => root.replace("\\.ts$", "\\.test\\.tsx?$")),
        ],
        // A module rule needs a dependents count to match on, and the schema
        // caps it at 100 — far above any module in this repository.
        numberOfDependentsLessThan: 100,
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
}
