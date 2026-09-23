import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const turbo = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8"))
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

const taskKeys = Object.keys(turbo.tasks)
const nonBuildTaskKeys = taskKeys.filter((key) => key !== "build")

describe("turbo.json / package.json invariants", () => {
  it("has a package.json script for every turbo task", () => {
    for (const key of taskKeys) {
      expect(pkg.scripts, `missing script for turbo task "${key}"`).toHaveProperty(key)
    }
  })

  it("names exactly the non-build tasks in the test script's turbo run", () => {
    const match = pkg.scripts.test.match(/^turbo run (.+)$/)
    expect(match, `"test" script must start with "turbo run": ${pkg.scripts.test}`).not.toBeNull()
    const invoked = match![1].split(/\s+/)
    expect(new Set(invoked)).toEqual(new Set(nonBuildTaskKeys))
  })

  it("does not name itself as a turbo task (no recursion)", () => {
    expect(taskKeys).not.toContain("test")
  })

  it("declares no pre<task> script for any task key, except the allowlisted postbuild", () => {
    for (const key of taskKeys) {
      expect(pkg.scripts, `"pre${key}" bypasses the turbo graph`).not.toHaveProperty(`pre${key}`)
    }
    // postbuild is part of the build itself (schema generation + the
    // no-test-doubles bundle assertion), not a duplicate graph edge.
    expect(pkg.scripts).toHaveProperty("postbuild")
  })

  it("makes test:e2e:live depend on build", () => {
    expect(turbo.tasks["test:e2e:live"].dependsOn).toContain("build")
  })

  it("lists docs/** as an input to test:unit and both e2e tasks", () => {
    expect(turbo.tasks["test:unit"].inputs).toContain("docs/**")
    expect(turbo.tasks["test:e2e:inmem"].inputs).toContain("docs/**")
    expect(turbo.tasks["test:e2e:live"].inputs).toContain("docs/**")
  })

  it("lists tests/**, scripts/**, and dev/** as inputs to test:unit", () => {
    // tests/tooling/stale-paths.test.ts scans the whole of src/ and tests/
    // (feature files included) for backtick-quoted src/tests/docs/scripts/dev
    // paths, so a stale path anywhere under those five roots must invalidate
    // this task's cache — a narrower inputs array lets turbo replay a green
    // run over a tree that would now fail the scan.
    expect(turbo.tasks["test:unit"].inputs).toContain("tests/**")
    expect(turbo.tasks["test:unit"].inputs).toContain("scripts/**")
    expect(turbo.tasks["test:unit"].inputs).toContain("dev/**")
  })

  it("lists evals/** as an input to typecheck, lint, analyze, and test:unit", () => {
    // tests/tooling/eval-baseline.test.ts imports evals/compare-baseline.mjs,
    // and tsconfig.json's allowJs+include pulls that .mjs into `tsc --noEmit`
    // — a change to evals/**/*.mjs that breaks the type-check must invalidate
    // every task that actually depends on it, or Turborepo replays a stale
    // cached green.
    expect(turbo.tasks["typecheck"].inputs).toContain("evals/**")
    expect(turbo.tasks["lint"].inputs).toContain("evals/**")
    expect(turbo.tasks["analyze"].inputs).toContain("evals/**")
    expect(turbo.tasks["test:unit"].inputs).toContain("evals/**")
  })

  it("lists .storybook/** as an input to lint and analyze", () => {
    // `.storybook/main.ts`/`preview.ts` are covered by `oxlint .`'s own glob
    // and by fallow's own `storybook` plugin discovery, but nothing else
    // pinned that turbo's cache actually invalidates on a change there — an
    // under-declared `inputs` here would replay a cached green over a real
    // .storybook/** lint/dead-code finding (T7's own "covered by
    // format:check and lint" criterion needs a REAL cache dependency, not
    // just an unpinned coincidence of a tool's own glob matching that
    // directory).
    expect(turbo.tasks["lint"].inputs).toContain(".storybook/**")
    expect(turbo.tasks["analyze"].inputs).toContain(".storybook/**")
  })

  it("lists ALL of src/** (not just src/web/**) and .storybook/** as inputs to test:web", () => {
    // T7's own criterion: "that inputs array covers both the client
    // directory and .storybook/". `src/web/**` alone under-declares this:
    // `src/web/screens/Question.tsx` value-imports `isAnswered`/
    // `FREE_TEXT_PLACEHOLDER` from `src/steering/qa.ts`, `Hunk.tsx`/
    // `Review.tsx` import `src/ui/Diff.ts`, `App.tsx` imports
    // `src/ui/Beat.ts`, and several files import `src/steering/SteeringFormat.ts` —
    // none of those live under `src/web/**`, so a change to the
    // answeredness predicate (say) would replay a cached green here instead
    // of re-running the storybook suite that actually exercises it.
    // `src/**` is the same safe baseline every other task in this file
    // already uses.
    expect(turbo.tasks["test:web"].inputs).toContain("src/**")
    expect(turbo.tasks["test:web"].inputs).toContain(".storybook/**")
  })

  it("excludes src/web/generated.html (a build OUTPUT, not a test:web input) from test:web's own inputs", () => {
    // `src/web/generated.html` is `build`'s own declared `outputs` entry
    // (gitignored, regenerated by `npm run build`) — leaving it inside
    // `test:web`'s `src/**` input glob unexcluded would bust that task's
    // cache on every build, for a file `test:web` never actually reads.
    expect(turbo.tasks["test:web"].inputs).toContain("!src/web/generated.html")
  })

  it("keeps browser-only web-client packages out of dependencies — only @trpc/server ships at runtime", () => {
    // Requirement 8: "tRPC's server half becomes the FIRST runtime
    // dependency this package carries purely for the web surface" — singular.
    // react/react-dom/@tanstack/react-query/@trpc/client/@trpc/react-query
    // are all inlined into src/web/generated.html at BUILD time
    // (tsdown.config.ts's `web` config bundles everything); a `dependencies`
    // entry for any of them means every `npm i -g @pmelab/gtd` installs React
    // for nothing.
    for (const name of [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "@trpc/client",
      "@trpc/react-query",
    ]) {
      expect(pkg.dependencies, `"${name}" must not be a runtime dependency`).not.toHaveProperty(
        name,
      )
      expect(pkg.devDependencies, `"${name}" must be a devDependency`).toHaveProperty(name)
    }
    expect(pkg.dependencies).toHaveProperty("@trpc/server")
  })

  it("makes analyze's inputs a superset of lint's", () => {
    // fallow reaches everything oxlint does plus its own .fallowrc.json —
    // a targeted superset check (not full equality) pins that direction
    // without requiring analyze's extra entries (package.json) in lint too.
    const analyzeInputs = new Set(turbo.tasks["analyze"].inputs)
    for (const input of turbo.tasks["lint"].inputs) {
      expect(analyzeInputs, `analyze's inputs are missing lint's "${input}"`).toContain(input)
    }
  })

  it("declares an explicit inputs array for every task except format:check", () => {
    for (const key of taskKeys) {
      if (key === "format:check") continue
      expect(
        Array.isArray(turbo.tasks[key].inputs),
        `task "${key}" must declare explicit inputs`,
      ).toBe(true)
    }
  })
})
