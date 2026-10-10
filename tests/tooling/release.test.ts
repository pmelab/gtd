import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { parse } from "yaml"

const root = new URL("../../", import.meta.url).pathname
const publishCmd = (): string =>
  JSON.parse(readFileSync(join(root, ".releaserc.json"), "utf8")).plugins.find(
    (p: unknown) => Array.isArray(p) && p[0] === "@semantic-release/exec",
  )[1].publishCmd
const workflow = parse(readFileSync(join(root, ".github/workflows/release.yml"), "utf8"))

// Runs the promotion against a fake registry: `npm` on PATH answers the exact
// `view` call the script makes from, and applies `dist-tag add` to, one JSON
// file of dist-tags. Any other invocation fails, so a changed call fails here.
const dirs: string[] = []
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const registry = (tags: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "promote-"))
  dirs.push(dir)
  const state = join(dir, "tags.json")
  writeFileSync(state, JSON.stringify(tags))
  writeFileSync(
    join(dir, "npm"),
    `#!/usr/bin/env node
const fs = require("fs"), argv = process.argv.slice(2), [cmd, sub, spec, tag] = argv
const tags = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, "utf8"))
if (argv.join(" ") === "view @pmelab/gtd dist-tags --json") process.stdout.write(JSON.stringify(tags))
else if (cmd === "dist-tag" && sub === "add" && argv.length === 4) {
  tags[tag] = spec.split("@").pop()
  fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(tags))
  fs.appendFileSync(${JSON.stringify(join(dir, "log"))}, [sub, spec, tag].join(" ") + "\\n")
} else process.exit(1)
`,
  )
  chmodSync(join(dir, "npm"), 0o755)
  return {
    promote: (...args: string[]) =>
      execFileSync("node", [join(root, "scripts/promote.mjs"), ...args], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      }),
    tags: () => JSON.parse(readFileSync(state, "utf8")),
    calls: () => {
      try {
        return readFileSync(join(dir, "log"), "utf8").trim().split("\n")
      } catch {
        return []
      }
    },
  }
}

describe("release batching", () => {
  it("publishes every merge to next, with provenance", () => {
    expect(publishCmd()).toMatch(/--tag next\b/)
    expect(publishCmd()).toContain("--provenance")
  })

  it("promotes on a schedule and on manual dispatch, never on push", () => {
    expect(workflow.on.schedule).toHaveLength(1)
    expect(workflow.on).toHaveProperty("workflow_dispatch")
    expect(workflow.jobs.promote.if).toBe(
      "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.backfill == '')",
    )
    expect(workflow.jobs.promote.steps.at(-1).run).toBe("node scripts/promote.mjs")
  })

  it("runs semantic-release only on push", () => {
    expect(workflow.jobs.test.if).toBe("github.event_name == 'push'")
    expect(workflow.jobs.release.needs).toBe("test")
  })

  it("backfills only a semver tag on main, never publishing to latest", () => {
    const job = workflow.jobs.backfill
    const run = job.steps.map((step: { run?: string }) => step.run ?? "").join("\n")
    expect(job.if).toBe("github.event_name == 'workflow_dispatch' && inputs.backfill != ''")
    expect(job.steps[0].with.ref).toBe("refs/tags/v${{ inputs.backfill }}")
    expect(run).toContain("grep -Eqx '[0-9]+\\.[0-9]+\\.[0-9]+'")
    expect(run).toContain("git merge-base --is-ancestor HEAD origin/main")
    expect(run).toContain(`test "$(node -p "require('./package.json').version")" = "$VERSION"`)
    expect(run).toMatch(/npm publish --access public --provenance --tag backfill\n/)
    expect(run).toContain('promote.mjs" backfill next')
  })

  it("moves latest to the newest next, and a second run does nothing", () => {
    const npm = registry({ latest: "20.0.1", next: "22.1.0" })
    expect(npm.promote()).toContain("promoted 22.1.0")
    expect(npm.tags()).toEqual({ latest: "22.1.0", next: "22.1.0" })
    expect(npm.promote()).toContain("nothing to promote")
    expect(npm.calls()).toEqual(["add @pmelab/gtd@22.1.0 latest"])
  })

  it("compares versions numerically, never moving latest backwards", () => {
    const npm = registry({ latest: "20.10.0", next: "20.9.0" })
    npm.promote()
    expect(npm.calls()).toEqual([])
  })

  it("moves next to a backfilled newest release, but not to an older one", () => {
    const newest = registry({ latest: "20.0.1", next: "20.0.1", backfill: "20.1.0" })
    newest.promote("backfill", "next")
    expect(newest.calls()).toEqual(["add @pmelab/gtd@20.1.0 next"])
    const older = registry({ latest: "20.0.1", next: "20.0.1", backfill: "17.1.0" })
    older.promote("backfill", "next")
    expect(older.calls()).toEqual([])
  })

  it("does nothing before anything was published to next", () => {
    const npm = registry({ latest: "20.0.1" })
    npm.promote()
    expect(npm.calls()).toEqual([])
  })
})
