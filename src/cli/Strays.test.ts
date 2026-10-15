import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { EXIT_OK, EXIT_RUNTIME_ERROR, EXIT_STRAYS_FOUND } from "../wire/index.js"
import { InMemRepo, makeCapturingCliIo } from "../testkit/index.js"
import { runCli } from "./index.js"

const seed = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile("README.md", "x\n")
  repo.commitAllWithPrefix("base")
  repo.updateRef("base", "HEAD")
  repo.writeFile("src/a.ts", "a\n")
  repo.writeFile("notes/b.md", "b\n")
  repo.writeFile("notes/c.md", "c\n")
  repo.commitAllWithPrefix("work")
  return repo
}

const strays = async (repo: InMemRepo, ...args: string[]) => {
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", "strays", ...args], io))
  return result()
}

describe("gtd strays — stderr commentary", () => {
  it("quiet: only the N of M summary", async () => {
    const { stderr, exitCode } = await strays(seed(), "base..HEAD", "src/**")
    expect(stderr).toBe("gtd strays: 2 of 3 touched files outside the allowlist\n")
    expect(exitCode).toBe(EXIT_STRAYS_FOUND)
  })

  it("--verbose: one stray: line per path, then the summary", async () => {
    const { stderr } = await strays(seed(), "base..HEAD", "src/**", "--verbose")
    expect(stderr).toBe(
      'stray: "notes/b.md"\nstray: "notes/c.md"\ngtd strays: 2 of 3 touched files outside the allowlist\n',
    )
  })

  it("a path with a line break and an escape reaches stderr JSON-quoted", async () => {
    const repo = seed()
    repo.writeFile("x\n\x1b[2J", "x\n")
    repo.commitAllWithPrefix("odd")
    const { stderr } = await strays(repo, "base..HEAD", "src/**", "--verbose")
    expect(stderr).toContain('stray: "x\\n\\u001b[2J"\n')
    expect(stderr).not.toContain("\x1b")
  })

  it("clean run: the single all-inside line", async () => {
    const { stderr, exitCode } = await strays(seed(), "base..HEAD", "src/**", "notes/*")
    expect(stderr).toBe("gtd strays: no strays — 3 touched files, all inside the allowlist\n")
    expect(exitCode).toBe(EXIT_OK)
  })
})

describe("gtd strays --json=<index>", () => {
  it("--json=0 prints the first stray, exit 10", async () => {
    const { stdout, exitCode } = await strays(seed(), "base..HEAD", "src/**", "--json=0")
    expect(stdout).toBe("notes/b.md\n")
    expect(exitCode).toBe(EXIT_STRAYS_FOUND)
  })

  it("--json=0 on a clean range prints nothing, exit 0", async () => {
    const { stdout, exitCode } = await strays(seed(), "base..HEAD", "src/**", "notes/*", "--json=0")
    expect(stdout).toBe("")
    expect(exitCode).toBe(EXIT_OK)
  })

  it("an index past the end prints nothing and keeps exit 10", async () => {
    const { stdout, exitCode } = await strays(seed(), "base..HEAD", "src/**", "--json=5")
    expect(stdout).toBe("")
    expect(exitCode).toBe(EXIT_STRAYS_FOUND)
  })
})

describe("gtd strays — unknown revisions", () => {
  it.each([
    ["nope..HEAD", "nope"],
    ["HEAD..nope", "nope"],
    ["HEAD..--output=x", "--output=x"],
  ])("%s: exit 1, empty stdout, no file written", async (range, side) => {
    const repo = seed()
    const { stdout, stderr, exitCode } = await strays(repo, range)
    expect(stdout).toBe("")
    expect(stderr).toContain(`unknown revision '${side}'`)
    expect(exitCode).toBe(EXIT_RUNTIME_ERROR)
    expect(repo.readFile("x")).toBeUndefined()
  })
})
