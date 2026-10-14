import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { applyEmittedScript, InMemRepo, makeCapturingCliIo, testLayers } from "../testkit/index.js"
import { runCli } from "./index.js"
import { historyEntries, resolveHistoryRef, type HistoryEntry } from "./History.js"

const CONFIG = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("building", "build-prompt")
}
`

const land = async (repo: InMemRepo, files: Record<string, string>): Promise<string> => {
  for (const [path, content] of Object.entries(files)) repo.writeFile(path, content)
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", "land", "--json"], io))
  const { stdout, exitCode, stderr } = result()
  if (exitCode !== 0) throw new Error(`land exited ${exitCode}: ${stderr}`)
  const outcome = applyEmittedScript(
    repo,
    new Map(),
    (JSON.parse(stdout) as { script: string }).script,
  )
  if (!outcome.ok) throw new Error(outcome.error)
  return repo.resolveRef("HEAD")!
}

const finishedProcess = async (repo: InMemRepo, file: string) => {
  const entry = await land(repo, { [file]: `${file}\n` })
  const tip = await land(repo, { [`${file}.out`]: "out\n" })
  return { entry, tip }
}

const repoWithConfig = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile("gtd.config.ts", CONFIG)
  repo.commitAllWithPrefix("chore: add workflow")
  return repo
}

const entries = (repo: InMemRepo): Promise<readonly HistoryEntry[]> =>
  Effect.runPromise(historyEntries.pipe(Effect.provide(testLayers(repo, {}))))

const entry = (over: Partial<HistoryEntry> & { entry: string }): HistoryEntry => ({
  ref: `refs/gtd/history/${over.entry}`,
  branch: null,
  tip: "t".repeat(40),
  date: "1",
  subject: "s",
  ...over,
})

const resolve = (
  arg: string,
  list: readonly HistoryEntry[],
): Promise<Exit.Exit<HistoryEntry, Error>> => Effect.runPromiseExit(resolveHistoryRef(arg, list))

const failureText = (exit: Exit.Exit<unknown, Error>): string =>
  Exit.isFailure(exit) ? String(exit.cause) : ""

describe("historyEntries", () => {
  it("is empty without refs", async () => {
    expect(await entries(repoWithConfig())).toEqual([])
  })

  it("lists finished processes newest tip first, with branch and entry subject", async () => {
    const repo = repoWithConfig()
    const first = await finishedProcess(repo, "a.txt")
    const second = await finishedProcess(repo, "b.txt")
    const list = await entries(repo)
    expect(list.map((e) => e.entry)).toEqual([second.entry, first.entry])
    expect(list[0]).toMatchObject({
      ref: `refs/gtd/history/${second.entry}`,
      branch: repo.branchName(),
      tip: second.tip,
      subject: "gtd(human): idle → building",
    })
  })

  it("skips a ref whose name suffix is not an entry hash", async () => {
    const repo = repoWithConfig()
    const { entry: hash } = await finishedProcess(repo, "a.txt")
    repo.updateRef("refs/gtd/history/--output=x", "HEAD")
    expect((await entries(repo)).map((e) => e.entry)).toEqual([hash])
  })

  it("has a null branch when the tip records none", async () => {
    const repo = repoWithConfig()
    const { entry: hash } = await finishedProcess(repo, "a.txt")
    repo.writeFile("x.txt", "x\n")
    repo.commitAllWithPrefix("chore: bare tip")
    repo.updateRef(`refs/gtd/history/${hash}`, "HEAD")
    expect((await entries(repo))[0]?.branch).toBeNull()
  })
})

describe("resolveHistoryRef", () => {
  const a = entry({ entry: "abc1230000", branch: "feat/x", date: "1" })
  const b = entry({ entry: "abc9990000", branch: "feat/x", date: "2" })
  const c = entry({ entry: "def4560000", branch: "other", date: "3" })
  const list = [c, b, a]

  it("accepts the full ref", async () => {
    expect(await resolve(a.ref, list)).toEqual(Exit.succeed(a))
  })

  it("accepts the entry hash or a unique hex prefix", async () => {
    expect(await resolve("abc1230000", list)).toEqual(Exit.succeed(a))
    expect(await resolve("def", list)).toEqual(Exit.succeed(c))
  })

  it("refuses an ambiguous prefix, listing every match", async () => {
    const exit = await resolve("abc", list)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureText(exit)).toContain(a.entry)
    expect(failureText(exit)).toContain(b.entry)
    expect(failureText(exit)).not.toContain(c.entry)
  })

  it("resolves a branch name to its newest ref by tip date", async () => {
    expect(await resolve("feat/x", list)).toEqual(Exit.succeed(b))
  })

  it("resolves a hex-looking branch name matching no entry as a branch", async () => {
    const dead = entry({ entry: "1111110000", branch: "beef", date: "9" })
    expect(await resolve("beef", [dead, ...list])).toEqual(Exit.succeed(dead))
  })

  it("fails when nothing matches", async () => {
    const exit = await resolve("nope", list)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureText(exit)).toContain("nope")
  })
})

const gtd = async (repo: InMemRepo, ...args: string[]) => {
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
  return result()
}

describe("gtd history list", () => {
  it("prints the fetch hint and exits 0 without refs", async () => {
    const out = await gtd(repoWithConfig(), "history", "list")
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe("no history refs; run gtd history fetch | sh to pull them\n")
  })

  it("prints [] under --json without refs", async () => {
    const out = await gtd(repoWithConfig(), "history", "list", "--json")
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.stdout)).toEqual([])
  })

  it("prints one text line per ref and a full-hash JSON array", async () => {
    const repo = repoWithConfig()
    const { entry: hash, tip } = await finishedProcess(repo, "a.txt")
    const text = await gtd(repo, "history", "list")
    const line = text.stdout.trimEnd().split("\n")
    expect(line).toHaveLength(1)
    expect(
      line[0]!.startsWith(`${hash.slice(0, 7)} ${repo.branchName()} ${tip.slice(0, 7)} `),
    ).toBe(true)
    expect(line[0]!.endsWith(" gtd(human): idle → building")).toBe(true)
    const json = await gtd(repo, "history", "list", "--json")
    expect(JSON.parse(json.stdout)).toEqual([
      expect.objectContaining({
        ref: `refs/gtd/history/${hash}`,
        entry: hash,
        branch: repo.branchName(),
        tip,
        subject: "gtd(human): idle → building",
      }),
    ])
    expect((await gtd(repo, "history", "list", "--json=0.entry")).stdout).toBe(`${hash}\n`)
  })
})

describe("gtd history show", () => {
  it("prints header, steps and the ending", async () => {
    const repo = repoWithConfig()
    const { entry: hash, tip } = await finishedProcess(repo, "a.txt")
    const out = await gtd(repo, "history", "show", hash.slice(0, 7))
    expect(out.exitCode).toBe(0)
    const lines = out.stdout.trimEnd().split("\n")
    expect(lines[0]).toBe(
      `refs/gtd/history/${hash} (branch ${repo.branchName()}, tip ${tip.slice(0, 7)})`,
    )
    expect(out.stdout).toContain("gtd(human): idle → building")
    expect(lines[lines.length - 1]).toBe("ended (return)")
  })

  it("--json carries the trail and the entry fields", async () => {
    const repo = repoWithConfig()
    const { entry: hash, tip } = await finishedProcess(repo, "a.txt")
    const out = await gtd(repo, "history", "show", hash, "--json")
    const doc = JSON.parse(out.stdout)
    expect(doc).toMatchObject({ entry: hash, tip, ended: "return", branch: repo.branchName() })
    expect(doc.steps.length).toBeGreaterThan(0)
    expect(doc.version).toHaveProperty("running")
  })

  it("exits 1 for an unknown ref", async () => {
    const out = await gtd(repoWithConfig(), "history", "show", "nope")
    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe("")
  })
})

describe("gtd history fetch", () => {
  it("prints a script fetching from origin and writes no git", async () => {
    const repo = repoWithConfig()
    const out = await gtd(repo, "history", "fetch")
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain("git fetch 'origin' 'refs/gtd/history/*:refs/gtd/history/*'")
    expect(repo.resolveRef("refs/gtd/history/x")).toBeNull()
  })

  it("takes the remote as an argument", async () => {
    const out = await gtd(repoWithConfig(), "history", "fetch", "upstream")
    expect(out.stdout).toContain("git fetch 'upstream'")
  })
})
