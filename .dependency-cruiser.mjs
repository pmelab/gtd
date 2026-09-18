// Every import rule this repository enforces, stated once each. The rules are
// generic over path SHAPE — `$1`/`$2` back-reference the captures in
// `from.path` — so "its own implementation file" and "its own boundary" need no
// per-module enumeration, and adding a `src/<boundary>/` needs no edit here.
//
// A unit test is allowed its own implementation file, any boundary's published
// `index.ts`, the shared `src/*.ts` vocabulary, its boundary's `*.fixture.ts`
// helpers, and type-only imports (erased at compile time, so no runtime
// coupling). What it may NOT reach is another FILE's internals — including its
// own neighbour's. The two variants exist only because `src/Foo.test.ts` and
// `src/mod/Foo.test.ts` capture differently; dependency-cruiser rejects the
// single optional-group regex that would unify them as ReDoS-unsafe.
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

export default {
  forbidden: [
    {
      name: "test-owns-impl",
      comment:
        "A unit test under src/<boundary>/ imports the file it is named after, published barrels, root vocabulary, and its boundary's fixtures — never a neighbour's internals.",
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
      name: "integration-via-barrel",
      comment: "tests/** sees published barrels only, never a module's internals.",
      severity: "error",
      from: { path: "^tests/" },
      to: { path: "^src/", pathNot: "^src/[^/]+/index\\.ts$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
}
