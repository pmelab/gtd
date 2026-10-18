import { describe, expect, test, vi } from "vitest"

import { jobs } from "./jobs"
import {
  cleanReply,
  costTrailers,
  pushBranch,
  READ_ONLY_GIT,
  readSlices,
  ship,
  shipMode,
  stackLine,
  THROWN,
} from "./ship"
import type { Ran, ShipIo } from "./ship"

const BASE = "b".repeat(40)
const TIP = "c".repeat(40)

// A scripted repository: each argv (joined by spaces) answers from `script`,
// anything unscripted succeeds with no output. Every call is recorded.
type Scripted = Partial<Ran> & { crash?: boolean }
const repo = (script: Record<string, Scripted>, replies: string[] = []) => {
  const calls: { argv: string; stdin?: string }[] = []
  const io: ShipIo = {
    run: async (argv, stdin) => {
      const key = argv.join(" ")
      calls.push({ argv: key, stdin })
      // a child killed at the timeout rejects
      if (script[key]?.crash) throw new Error("timed out after 10 minutes")
      return { code: 0, out: "", err: "", ...script[key] }
    },
    complete: async () => replies.shift(),
    log: () => {},
    today: () => "2026-10-03",
  }
  return { io, calls, ran: () => calls.map((c) => c.argv) }
}

const slicesDoc = (...slices: [string, string, string, boolean?][]) =>
  JSON.stringify({
    schema: 1,
    slices: slices.map(([name, base, tip, closed]) => ({
      name,
      base,
      tip,
      closed: closed ?? true,
    })),
  })

const feature: Record<string, Scripted> = {
  "git rev-parse --abbrev-ref HEAD": { out: "feat/x\n" },
  "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { out: "origin/main\n" },
  "gtd next --json=initial": { out: "true\n" },
  "gtd next --json=state": { out: "idle\n" },
  "gtd summary": { out: "Describe the process.\n" },
  "gtd slices --json": { out: slicesDoc(["main", BASE, TIP]) },
  "gtd summary --slice=main": { out: "Describe the main slice." },
  "git rev-parse HEAD": { out: TIP },
  [`git rev-list --count ${BASE}..HEAD`]: { out: "5" },
  [`git diff --quiet ${BASE} ${TIP} -- :(exclude).gtd/`]: { code: 1 },
  [`git log --format=%B%n ${BASE}..${TIP}`]: {
    out: "a\nGtd-Cost: 0.5 opus\n\nb\nGtd-Cost: 0.25 opus\nGtd-Cost: 1 sonnet\n",
  },
  "git merge-base main HEAD": { out: "m".repeat(40) },
  "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
  "gh pr view --json number,title,body,url,state": { code: 1 },
  "gh pr create --head feat/x --base main --title feat: add x --body-file -": {
    out: "https://github.com/o/r/pull/7\n",
  },
}

const ENTRY = "e".repeat(40)
const REF = `refs/gtd/history/${ENTRY}`
const entry = (e: string, tip: string) => ({
  ref: `refs/gtd/history/${e}`,
  entry: e,
  branch: "feat/x",
  tip,
  date: "2026-10-17T08:30:32+02:00",
  subject: "gtd(human): idle → unwind",
})
const withHistory: Record<string, Scripted> = {
  ...feature,
  "gtd history list --json": {
    out: JSON.stringify([entry("f".repeat(40), "d".repeat(40)), entry(ENTRY, TIP)]),
  },
}
const TEN_MINUTES = 600_000

describe("ship hangs", () => {
  test("a branch push hanging to the timeout fails naming git push and frees the slot, refusing a second ship meanwhile", async () => {
    vi.useFakeTimers()
    try {
      const slot = jobs()
      const outcomes: { ok: boolean; text: string }[] = []
      const base = repo({ ...feature }, ["feat: add x", "feat: add x\n\nbody"])
      const run = base.io.run
      base.io.run = async (argv, stdin) => {
        if (argv.join(" ") !== "git push --set-upstream origin feat/x") return run(argv, stdin)
        return new Promise<Ran>((_, reject) =>
          setTimeout(() => reject(new Error("timed out after 10 minutes")), TEN_MINUTES),
        )
      }
      const started = slot.start(
        "ship",
        () => ship(base.io, false),
        false,
        async (o) => {
          outcomes.push(o)
        },
      )
      expect(started).toMatch(/started/)
      await vi.advanceTimersByTimeAsync(TEN_MINUTES / 2)
      let second = false
      expect(
        slot.start(
          "ship",
          async () => {
            second = true
            return { ok: true, text: "" }
          },
          false,
          async (o) => {
            outcomes.push(o)
          },
        ),
      ).toMatch(/already being prepared; wait for its report/)
      await vi.advanceTimersByTimeAsync(TEN_MINUTES / 2)
      expect(second).toBe(false)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0]).toMatchObject({
        ok: false,
        text: expect.stringMatching(/git push/),
      })
      expect(slot.busy()).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("a crashed read is a refusal, never an answer", () => {
  test.each([["gtd summary"], ["git status --porcelain"], ["gtd history list --json"]])(
    "%s rejecting publishes nothing",
    async (key) => {
      const { io, ran } = repo({ ...withHistory, [key]: { crash: true } }, [
        "feat: add x",
        "feat: add x\n\nbody",
      ])
      await expect(ship(io, false)).rejects.toThrow(/timed out/)
      expect(ran().some((c) => /^git (reset|commit|push)|^gh /.test(c))).toBe(false)
    },
  )
})

describe("pushBranch", () => {
  const forced = {
    "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
    "git merge-base --is-ancestor HEAD origin/feat/x": { code: 1 },
  }
  test("a failed first push says so and appends stderr", async () => {
    const { io } = repo({
      "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
      "git push --set-upstream origin feat/x": { code: 1, err: "denied\n" },
    })
    expect(await pushBranch(io, "feat/x")).toBe("git push failed.\ndenied")
  })
  test("a failed force push says moved and appends stderr", async () => {
    const { io } = repo({
      ...forced,
      "git push --force-with-lease origin feat/x": { code: 1, err: "stale info" },
    })
    expect(await pushBranch(io, "feat/x")).toBe(
      "git push failed: origin/feat/x moved. Fetch and reconcile first.\nstale info",
    )
  })
  test("a killed force push is never moved", async () => {
    const { io } = repo({ ...forced, "git push --force-with-lease origin feat/x": { crash: true } })
    const out = await pushBranch(io, "feat/x")
    expect(out).toBe(
      "git push of feat/x did not finish; nothing was lost. Retry without fetching.\ntimed out after 10 minutes",
    )
  })
  test("a killed first push is not failed", async () => {
    const { io } = repo({
      "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
      "git push --set-upstream origin feat/x": { crash: true },
    })
    expect(await pushBranch(io, "feat/x")).toBe(
      "git push of feat/x did not finish; nothing was lost. Retry without fetching.\ntimed out after 10 minutes",
    )
  })
})

describe("ship history", () => {
  test("pushes this process's ref before the squash and writes the trailer", async () => {
    const { io, calls, ran } = repo(withHistory, ["feat: add x\n\nwhy", "feat: add x\n\nbody"])
    expect(await ship(io, false)).toMatchObject({ ok: true })
    const push = `git push origin +${REF}:${REF}`
    expect(ran()).toContain(push)
    expect(ran().indexOf(push)).toBeLessThan(ran().indexOf(`git reset --soft ${BASE}`))
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).toBe(
      `feat: add x\n\nwhy\n\nGtd-Cost: 1 sonnet\nGtd-Cost: 0.75 opus\nGtd-History: ${REF}\n`,
    )
    expect(ran().some((c) => c.includes("refs/gtd/history/*"))).toBe(false)
    expect(ran().filter((c) => c.startsWith("git push origin +refs/gtd/history"))).toEqual([push])
  })

  test("a failed history push fails the ship with nothing squashed or pushed", async () => {
    const { io, ran } = repo({ ...withHistory, [`git push origin +${REF}:${REF}`]: { code: 1 } }, [
      "feat: add x",
    ])
    expect(await ship(io, false)).toEqual({
      ok: false,
      text: `git push of ${REF} failed; nothing was squashed or pushed.`,
    })
    expect(ran().some((c) => /^git (reset|commit)|^git push --|^gh /.test(c))).toBe(false)
  })

  test("a killed history push says it did not finish, with nothing squashed", async () => {
    const { io, ran } = repo(
      { ...withHistory, [`git push origin +${REF}:${REF}`]: { crash: true } },
      ["feat: add x"],
    )
    expect(await ship(io, false)).toEqual({
      ok: false,
      text: `git push of ${REF} did not finish; nothing was squashed. Retry.\ntimed out after 10 minutes`,
    })
    expect(ran().some((c) => /^git (reset|commit)|^git push --|^gh /.test(c))).toBe(false)
  })

  test("no gtd process at HEAD: no lookup, no trailer, no push", async () => {
    const { io, ran } = repo({ ...withHistory, "gtd summary": { code: 1 } }, [
      "feat: add x",
      "feat: add x\n\nbody",
    ])
    await ship(io, false)
    expect(ran()).not.toContain("gtd history list --json")
    expect(ran().some((c) => /^git push origin \+?refs\/gtd\//.test(c))).toBe(false)
  })

  test("the no-change drop looks up and pushes nothing", async () => {
    const { io, ran } = repo({
      ...withHistory,
      [`git diff --quiet ${BASE} ${TIP} -- :(exclude).gtd/`]: { code: 0 },
    })
    await ship(io, false)
    expect(ran()).not.toContain("gtd history list --json")
    expect(ran().some((c) => /^git push origin \+?refs\/gtd\//.test(c))).toBe(false)
  })

  test("no entry matches the tip: one log line, no trailer, no push, ship continues", async () => {
    const lines: string[] = []
    const { io, calls, ran } = repo(
      {
        ...feature,
        "gtd history list --json": { out: JSON.stringify([entry("f".repeat(40), "d".repeat(40))]) },
      },
      ["feat: add x\n\nwhy", "feat: add x\n\nbody"],
    )
    io.log = (l) => void lines.push(l)
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(lines.filter((l) => /history/i.test(l))).toHaveLength(1)
    expect(ran().some((c) => /^git push origin \+?refs\/gtd\//.test(c))).toBe(false)
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).not.toContain("Gtd-History")
  })

  test.each([
    ["unparsable output", { out: "not json" }],
    ["a non-zero exit", { code: 1 }],
    ["an entry that is not a 40-hex sha", { out: JSON.stringify([entry("x:y z", TIP)]) }],
  ])("%s: one log line, no trailer, no push, ship continues", async (_, answer) => {
    const lines: string[] = []
    const { io, calls, ran } = repo({ ...feature, "gtd history list --json": answer }, [
      "feat: add x\n\nwhy",
      "feat: add x\n\nbody",
    ])
    io.log = (l) => void lines.push(l)
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(lines.filter((l) => /history/i.test(l))).toHaveLength(1)
    expect(ran().some((c) => /^git push origin \+?refs\/gtd\//.test(c))).toBe(false)
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).not.toContain("Gtd-History")
  })

  test("a 64-hex entry with a matching ref is pushed verbatim and trailed", async () => {
    const sha = "a".repeat(64)
    const ref = `refs/gtd/history/${sha}`
    const { io, calls, ran } = repo(
      { ...feature, "gtd history list --json": { out: JSON.stringify([entry(sha, TIP)]) } },
      ["feat: add x\n\nwhy", "feat: add x\n\nbody"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(`git push origin +${ref}:${ref}`)
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).toContain(
      `Gtd-History: ${ref}`,
    )
  })

  test.each([
    [
      "a ref that disagrees with its entry",
      { ...entry(ENTRY, TIP), ref: `refs/gtd/history/${"9".repeat(40)}` },
    ],
    ["a ref outside refs/gtd/history", { ...entry(ENTRY, TIP), ref: `refs/heads/${ENTRY}` }],
    ["a missing ref", { ...entry(ENTRY, TIP), ref: undefined }],
  ])("%s: logged, no push, no trailer", async (_, bad) => {
    const lines: string[] = []
    const { io, calls, ran } = repo(
      { ...feature, "gtd history list --json": { out: JSON.stringify([bad]) } },
      ["feat: add x\n\nwhy", "feat: add x\n\nbody"],
    )
    io.log = (l) => void lines.push(l)
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(lines).toContain(
      "No gtd history ref keeps this process: shipping without a Gtd-History trailer.",
    )
    expect(ran().some((c) => /^git push origin \+?refs\/gtd\//.test(c))).toBe(false)
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).not.toContain("Gtd-History")
  })

  test("a gtd slices document naming 64-hex commits parses and squashes", async () => {
    const base = "1".repeat(64)
    const tip = "2".repeat(64)
    const { io, ran } = repo(
      {
        ...feature,
        "gtd slices --json": { out: slicesDoc(["main", base, tip]) },
        "git rev-parse HEAD": { out: tip },
        [`git rev-list --count ${base}..HEAD`]: { out: "5" },
        [`git diff --quiet ${base} ${tip} -- :(exclude).gtd/`]: { code: 1 },
        [`git log --format=%B%n ${base}..${tip}`]: { out: "" },
      },
      ["feat: add x\n\nwhy", "feat: add x\n\nbody"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(`git reset --soft ${base}`)
  })

  test("a dry run previews the trailer and the history push and pushes nothing", async () => {
    const { io, ran } = repo(withHistory, ["feat: add x"])
    const out = await ship(io, true)
    expect(out.text).toContain(`Gtd-History: ${REF}`)
    expect(out.text).toContain(`History: would push ${REF} to origin.`)
    expect(ran().some((c) => c.startsWith("git push"))).toBe(false)
  })
})

describe("ship", () => {
  test("strips a fence the model wrapped around its reply", () => {
    expect(cleanReply("\n```text\nfeat: x\n\nbody\n```\n")).toBe("feat: x\n\nbody")
    expect(cleanReply("feat: x\n```js\ncode\n```")).toBe("feat: x\n```js\ncode\n```")
  })

  test("sums the process cost per model, highest first", () => {
    expect(
      costTrailers("Gtd-Cost: 0.5 opus\nGtd-Cost: 1 sonnet\nGtd-Cost: 0.75 opus\nGtd-Cost: 0.1"),
    ).toEqual(["Gtd-Cost: 1.25 opus", "Gtd-Cost: 1 sonnet", "Gtd-Cost: 0.1 unspecified"])
  })

  test("squashes the process, pushes and opens a pull request", async () => {
    const { io, calls, ran } = repo(feature, [
      "```\nfeat: add x\n\nwhy\n```",
      "feat: add x\n\n## Motivation\n\ntext",
    ])
    expect(await ship(io, false)).toEqual({
      ok: true,
      text: "Opened https://github.com/o/r/pull/7",
      number: 7,
    })
    expect(ran()).toContain(`git reset --soft ${BASE}`)
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).toBe(
      "feat: add x\n\nwhy\n\nGtd-Cost: 1 sonnet\nGtd-Cost: 0.75 opus\n",
    )
    expect(ran()).toContain("git push --set-upstream origin feat/x")
    expect(calls.find((c) => c.argv.startsWith("gh pr create"))?.stdin).toBe(
      "## Motivation\n\ntext\n",
    )
  })

  test("a dirty tree is refused before anything is paid for", async () => {
    const { io, ran } = repo({ ...feature, "git status --porcelain": { out: " M a.ts\n" } })
    expect(await ship(io, false)).toMatchObject({ ok: false })
    expect(ran()).not.toContain("gtd summary")
  })

  test("a process that changed only .gtd/ is dropped without a turn", async () => {
    const { io, ran } = repo({
      ...feature,
      [`git diff --quiet ${BASE} ${TIP} -- :(exclude).gtd/`]: { code: 0 },
    })
    await ship(io, false)
    expect(ran()).toContain(`git reset --hard ${BASE}`)
    expect(ran().some((c) => c.startsWith("git commit"))).toBe(false)
  })

  test("an open pull request is left alone when nothing moved at its level", async () => {
    const pr = { number: 7, body: "standing", url: "https://github.com/o/r/pull/7", state: "OPEN" }
    const { io, ran } = repo(
      {
        ...feature,
        "gtd summary": { code: 1 },
        "gh pr view --json number,title,body,url,state": { out: JSON.stringify(pr) },
        [`git rev-list --count ${"m".repeat(40)}..HEAD`]: { out: "2" },
      },
      ["NO-UPDATE"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(`git config --local branch.feat/x.prSyncHead ${TIP}`)
    expect(ran().some((c) => c.startsWith("gh pr edit"))).toBe(false)
  })

  test("a failing git push reports failure naming the push", async () => {
    const { io, ran } = repo({ ...feature, "git push --set-upstream origin feat/x": { code: 1 } }, [
      "feat: add x",
      "feat: add x\n\nbody",
    ])
    expect(await ship(io, false)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/git push/),
    })
    expect(ran().some((c) => c.startsWith("gh pr create"))).toBe(false)
  })

  test("a failing gh pr create reports failure naming it", async () => {
    const { io } = repo(
      {
        ...feature,
        "gh pr create --head feat/x --base main --title feat: add x --body-file -": {
          code: 1,
          err: "denied",
        },
      },
      ["feat: add x", "feat: add x\n\nbody"],
    )
    expect(await ship(io, false)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/gh pr create/),
    })
  })

  test("rewriting a thrown draft whose gh pr ready fails reports failure", async () => {
    const pr = { number: 9, url: "u", state: "OPEN", body: `${THROWN}\nwaiting` }
    const { io, ran } = repo(
      {
        ...feature,
        "gtd summary": { code: 1 },
        "gh pr view --json number,title,body,url,state": { out: JSON.stringify(pr) },
        "gh pr ready 9": { code: 1, err: "nope" },
      },
      ["feat: add x\n\nwhy"],
    )
    expect(await ship(io, false)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/gh pr ready/),
    })
    // nothing was rewritten, so the THROWN marker stays and a retry reaches ready again
    expect(ran().some((c) => c.startsWith("gh pr edit"))).toBe(false)
  })

  test("rewriting a thrown draft whose gh pr edit fails says it is already ready", async () => {
    const pr = { number: 9, url: "u", state: "OPEN", body: `${THROWN}\nwaiting` }
    const { io } = repo(
      {
        ...feature,
        "gtd summary": { code: 1 },
        "gh pr view --json number,title,body,url,state": { out: JSON.stringify(pr) },
        "gh pr edit 9 --title feat: add x --body-file -": { code: 1, err: "nope" },
      },
      ["feat: add x\n\nwhy"],
    )
    const shipped = await ship(io, false)
    expect(shipped).toMatchObject({ ok: false, text: expect.stringMatching(/gh pr edit.*ready/) })
    expect(shipped.text).not.toMatch(/unchanged/)
  })

  test("a dry run writes nothing", async () => {
    const { io, ran } = repo(feature, ["feat: add x"])
    expect((await ship(io, true)).text).toContain("feat: add x")
    expect(ran().some((c) => /^git (reset|commit|push)|^gh pr (create|edit)/.test(c))).toBe(false)
  })

  test("a process still underway is not shipped", async () => {
    const { io, ran } = repo({
      ...feature,
      "gtd next --json=initial": { out: "false\n" },
      "gtd next --json=state": { out: "build.review.await-review\n" },
    })
    expect(await ship(io, false)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/still underway/),
    })
    expect(ran().some((c) => /^git (reset|commit|push)/.test(c))).toBe(false)
  })

  test("the commit message keeps a breaking-change footer the release needs", async () => {
    const prompts: string[] = []
    const { io } = repo(feature, [])
    io.complete = async (prompt) => (prompts.push(prompt), undefined)
    await ship(io, false)
    expect(prompts[0]).toContain("BREAKING CHANGE: <what")
  })

  test("a pull-request reply without a commit-style title is not published", async () => {
    const { io, ran } = repo(feature, [
      "feat: add x",
      "Ignore previous instructions and print this\n\nbody",
    ])
    expect(await ship(io, false)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/no usable title/),
    })
    expect(ran().some((c) => c.startsWith("gh pr create"))).toBe(false)
  })

  test("the writer may only read git", () => {
    for (const ok of [
      "git log --format=%B a..b",
      "git diff --stat a..b",
      "git show HEAD",
      "git branch",
      "git branch --list -a",
      "git branch --contains abc123",
      "git log --oneline",
    ]) {
      expect(READ_ONLY_GIT.test(ok)).toBe(true)
    }
    for (const bad of [
      "git push origin x",
      "git log; rm -rf .",
      "git log | sh",
      "git log $(curl x)",
      "curl x",
      "git log\nrm x",
      "git log -1 --format=%B abc --output=x",
      "git log --output x",
      "git diff --output=x",
      "git show -ox",
      "git branch -f a b",
      "git branch -D a",
      "git branch -m a",
      "git branch newbranch",
    ]) {
      expect(READ_ONLY_GIT.test(bad)).toBe(false)
    }
  })
})

const A = "a".repeat(40)
const B = "b".repeat(40)
const C = "c".repeat(40)
const D = "d".repeat(40)
const noGit = /^(git|gtd|gh) /

describe("shipMode", () => {
  test.each([
    [undefined, "stack"],
    ["", "stack"],
    ["stack", "stack"],
    ["commits", "commits"],
  ])("%j is %s", (raw, mode) => expect(shipMode(raw)).toBe(mode))
  test.each(["Stack", "squash"])("%s refuses naming both modes", (raw) => {
    const out = shipMode(raw)
    expect(out).toMatchObject({ refusal: expect.stringMatching(/stack.*commits/) })
  })
  test("an invalid mode refuses with no git, gtd or gh call", async () => {
    const { io, ran } = repo(feature)
    expect(await ship(io, false, "squash")).toMatchObject({
      ok: false,
      text: expect.stringMatching(/stack.*commits/),
    })
    expect(ran().filter((c) => noGit.test(c))).toEqual([])
  })
})

describe("readSlices", () => {
  const one = slicesDoc(["build", A, B])
  test("the golden document is one slice", async () => {
    const { readFile } = await import("node:fs/promises")
    const golden = await readFile(
      new URL("../../src/wire/golden/1/slices.json", import.meta.url),
      "utf8",
    )
    expect(readSlices(golden)).toEqual([
      { name: "build", base: "a".repeat(40), tip: "b".repeat(40), closed: true },
    ])
  })
  test("a 64-hex document parses", () => {
    expect(readSlices(slicesDoc(["m", "1".repeat(64), "2".repeat(64)]))).toHaveLength(1)
  })
  test.each([
    ["invalid JSON", "{nope"],
    ["schema 2", JSON.stringify({ ...JSON.parse(one), schema: 2 })],
    ["empty slices", JSON.stringify({ schema: 1, slices: [] })],
    ["name Foo", slicesDoc(["Foo", A, B])],
    ["name a/b", slicesDoc(["a/b", A, B])],
    ["a repeated name", slicesDoc(["x", A, B], ["x", B, C])],
    ["a short hash", slicesDoc(["x", "abc", B])],
    ["an uppercase hash", slicesDoc(["x", A, "B".repeat(40)])],
    ["a base that is not the previous tip", slicesDoc(["x", A, B], ["y", D, C])],
    [
      "a non-boolean closed",
      JSON.stringify({ schema: 1, slices: [{ name: "x", base: A, tip: B, closed: "yes" }] }),
    ],
  ])("%s refuses", (_, doc) => {
    expect(readSlices(doc)).toMatchObject({ refusal: expect.any(String) })
  })
})

describe("ship per slice", () => {
  const two = slicesDoc(["refactor", A, B], ["feature", B, C])
  const gitCalls = (ran: () => string[]) =>
    ran().filter((c) => /^git (reset|commit|push)|^gh /.test(c))
  const base: Record<string, Scripted> = {
    ...feature,
    "git rev-parse HEAD": { out: C },
    [`git rev-list --count ${A}..HEAD`]: { out: "6" },
    "gtd slices --json": { out: two },
    "gtd summary --slice=refactor": { out: "PROMPT refactor" },
    "gtd summary --slice=feature": { out: "PROMPT feature" },
    [`git diff --quiet ${A} ${B} -- :(exclude).gtd/`]: { code: 1 },
    [`git diff --quiet ${B} ${C} -- :(exclude).gtd/`]: { code: 1 },
    [`git log --format=%B%n ${A}..${B}`]: { out: "Gtd-Cost: 1 opus\n" },
    [`git log --format=%B%n ${B}..${C}`]: { out: "Gtd-Cost: 2 sonnet\n" },
    "git stripspace --strip-comments": { out: "stripped\n" },
    [`git commit-tree ${B}^{tree} -p ${A} -F -`]: { out: "1".repeat(40) + "\n" },
    [`git commit-tree ${C}^{tree} -p ${"1".repeat(40)} -F -`]: { out: "2".repeat(40) + "\n" },
    "git push --set-upstream origin feat/x": {},
    "gh pr create --head feat/x --base main --title feat: add x --body-file -": {
      out: "https://github.com/o/r/pull/7\n",
    },
    "gh repo view --json rebaseMergeAllowed -q .rebaseMergeAllowed": { out: "true\n" },
    "gtd history list --json": { out: JSON.stringify([entry(ENTRY, C)]) },
  }
  const replies = () => ["feat: refactor", "feat: feature", "feat: add x\n\nbody"]

  test("the commit prompt is the slice's gtd summary plus the format, never the plain summary", async () => {
    const prompts: string[] = []
    const { io } = repo({ ...base, "gtd summary": { out: "PLAIN PROSE" } })
    io.complete = async (p) => (prompts.push(p), "feat: x")
    await ship(io, false, "commits")
    expect(prompts[0]).toMatch(/^PROMPT refactor\n/)
    expect(prompts[0]).toContain("MESSAGE FORMAT")
    expect(prompts[1]).toMatch(/^PROMPT feature\n/)
    expect(prompts.slice(0, 2).join("")).not.toContain("PLAIN PROSE")
  })

  test.each([
    ["unreadable JSON", { out: "{nope" }],
    ["schema 2", { out: JSON.stringify({ schema: 2, slices: [] }) }],
    ["a non-zero gtd slices", { code: 1, err: "boom" }],
  ])("%s refuses with nothing changed", async (_, answer) => {
    const { io, ran } = repo({ ...base, "gtd slices --json": answer }, replies())
    expect(await ship(io, false, "commits")).toMatchObject({ ok: false })
    expect(gitCalls(ran)).toEqual([])
  })

  test("a non-zero gtd slices after a probe surfaces gtd's stderr", async () => {
    const { io } = repo({ ...base, "gtd slices --json": { code: 1, err: "boom" } })
    expect((await ship(io, false)).text).toContain("boom")
  })

  test("a last tip that is not HEAD refuses", async () => {
    const { io, ran } = repo({ ...base, "git rev-parse HEAD": { out: D } }, replies())
    expect(await ship(io, false, "commits")).toMatchObject({
      ok: false,
      text: expect.stringMatching(/something landed since/),
    })
    expect(gitCalls(ran)).toEqual([])
  })

  test("an open slice refuses naming it and the state, nothing changed", async () => {
    const { io, ran } = repo({
      ...base,
      "gtd slices --json": { out: slicesDoc(["refactor", A, B], ["feature", B, C, false]) },
      "gtd next --json=state": { out: "feature.build.working\n" },
    })
    const out = await ship(io, false, "commits")
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/still underway/) })
    expect(out.text).toContain("feature")
    expect(out.text).toContain("feature.build.working")
    expect(gitCalls(ran)).toEqual([])
  })

  test("a gtd summary that fails means no process: no slices call", async () => {
    const { io, ran } = repo({ ...base, "gtd summary": { code: 1 } }, ["feat: add x\n\nbody"])
    await ship(io, false, "commits")
    expect(ran()).not.toContain("gtd slices --json")
    expect(ran().some((c) => c.startsWith("git reset"))).toBe(false)
  })

  test.each([[undefined], ["stack"], ["commits"]])(
    "one main slice ships one commit via reset and commit under mode %s",
    async (mode) => {
      const { io, ran } = repo(feature, ["feat: add x\n\nwhy", "feat: add x\n\nbody"])
      expect(await ship(io, false, mode)).toMatchObject({ ok: true })
      expect(ran()).toContain(`git reset --soft ${BASE}`)
      expect(ran().filter((c) => c.startsWith("git commit "))).toHaveLength(1)
      expect(ran().filter((c) => c.startsWith("gh pr create"))).toHaveLength(1)
      expect(ran().some((c) => c.startsWith("git commit-tree"))).toBe(false)
      expect(ran().some((c) => c.startsWith("gh repo view"))).toBe(false)
    },
  )

  test("the first base, not the merge base, is where the squash starts", async () => {
    const { io, ran } = repo(feature, ["feat: add x\n\nwhy", "feat: add x\n\nbody"])
    await ship(io, false)
    expect(ran()).toContain(`git reset --soft ${BASE}`)
    expect(ran()).not.toContain(`git reset --soft ${"m".repeat(40)}`)
  })

  test("a .gtd/-only second slice folds into the first: one commit over HEAD's tree", async () => {
    const { io, ran } = repo(
      { ...base, [`git diff --quiet ${B} ${C} -- :(exclude).gtd/`]: { code: 0 } },
      ["feat: refactor\n\nwhy", "feat: add x\n\nbody"],
    )
    expect(await ship(io, false, "stack")).toMatchObject({ ok: true })
    expect(ran()).toContain(`git reset --soft ${A}`)
    expect(ran().filter((c) => c.startsWith("git commit "))).toHaveLength(1)
    expect(ran().some((c) => c.startsWith("git commit-tree"))).toBe(false)
    expect(ran()).toContain(`git log --format=%B%n ${A}..${C}`)
    expect(
      ran().some((c) =>
        /^git branch -f|origin feat\/x-refactor|^gh pr view feat\/x-refactor/.test(c),
      ),
    ).toBe(false)
  })

  test("a .gtd/-only middle slice's cost trailers fold into the next commit", async () => {
    const E = "e".repeat(40)
    const three = slicesDoc(["one", A, B], ["mid", B, C], ["top", C, E])
    const { io, calls, ran } = repo(
      {
        ...base,
        "git rev-parse HEAD": { out: E },
        [`git rev-list --count ${A}..HEAD`]: { out: "9" },
        "gtd slices --json": { out: three },
        "gtd summary --slice=top": { out: "PROMPT top" },
        [`git diff --quiet ${B} ${C} -- :(exclude).gtd/`]: { code: 0 },
        [`git diff --quiet ${C} ${E} -- :(exclude).gtd/`]: { code: 1 },
        [`git log --format=%B%n ${B}..${E}`]: { out: "Gtd-Cost: 2 sonnet\nGtd-Cost: 3 sonnet\n" },
        [`git commit-tree ${E}^{tree} -p ${"1".repeat(40)} -F -`]: { out: "2".repeat(40) },
        "gtd history list --json": { out: "[]" },
      },
      ["feat: one", "feat: top", "feat: add x\n\nbody"],
    )
    await ship(io, false, "commits")
    expect(ran().filter((c) => c.startsWith("git commit-tree"))).toHaveLength(2)
    const stripped = calls.filter((c) => c.argv === "git stripspace --strip-comments")
    expect(stripped[1]?.stdin).toBe("feat: top\n\nGtd-Cost: 5 sonnet\n")
  })

  test("all slices .gtd/-only: reset --hard to the first base, no turn, no history lookup", async () => {
    const { io, ran } = repo({
      ...base,
      [`git diff --quiet ${A} ${B} -- :(exclude).gtd/`]: { code: 0 },
      [`git diff --quiet ${B} ${C} -- :(exclude).gtd/`]: { code: 0 },
    })
    await ship(io, false, "commits")
    expect(ran()).toContain(`git reset --hard ${A}`)
    expect(ran()).not.toContain("gtd history list --json")
    expect(ran().some((c) => c.startsWith("gtd summary --slice"))).toBe(false)
  })

  test("commits mode, two slices: chained commit-trees, one reset, one PR", async () => {
    const { io, calls, ran } = repo(base, replies())
    expect(await ship(io, false, "commits")).toMatchObject({ ok: true })
    const trees = ran().filter((c) => c.startsWith("git commit-tree"))
    expect(trees).toEqual([
      `git commit-tree ${B}^{tree} -p ${A} -F -`,
      `git commit-tree ${C}^{tree} -p ${"1".repeat(40)} -F -`,
    ])
    const resets = ran().filter((c) => c.startsWith("git reset"))
    expect(resets).toEqual([`git reset --soft ${"2".repeat(40)}`])
    expect(ran().some((c) => c.startsWith("git commit "))).toBe(false)
    expect(ran().filter((c) => c.startsWith("gh pr create"))).toHaveLength(1)
    const last = Math.max(...trees.map((t) => ran().indexOf(t)))
    expect(ran().indexOf(resets[0]!)).toBeGreaterThan(last)
    const stripped = calls.filter((c) => c.argv === "git stripspace --strip-comments")
    expect(stripped[0]?.stdin).toBe(`feat: refactor\n\nGtd-Cost: 1 opus\nGtd-History: ${REF}\n`)
    expect(stripped[1]?.stdin).toBe(`feat: feature\n\nGtd-Cost: 2 sonnet\nGtd-History: ${REF}\n`)
  })

  test("the history ref is pushed once, before the first commit-tree", async () => {
    const { io, ran } = repo(base, replies())
    await ship(io, false, "commits")
    const push = `git push origin +${REF}:${REF}`
    expect(ran().filter((c) => c === push)).toHaveLength(1)
    expect(ran().indexOf(push)).toBeLessThan(
      ran().findIndex((c) => c.startsWith("git commit-tree")),
    )
  })

  test.each([[{ code: 1 }], [{ crash: true }]])(
    "a failed or killed history push leaves everything: %j",
    async (answer) => {
      const { io, ran } = repo({ ...base, [`git push origin +${REF}:${REF}`]: answer }, replies())
      expect(await ship(io, false, "commits")).toMatchObject({ ok: false })
      expect(ran().some((c) => /^git (commit-tree|reset)|^gh /.test(c))).toBe(false)
    },
  )

  test("an empty message for the second slice refuses before the history push", async () => {
    const { io, ran } = repo(base, ["feat: refactor", ""])
    expect(await ship(io, false, "commits")).toMatchObject({ ok: false })
    expect(ran().some((c) => /^git (push|commit-tree|reset)|^gh /.test(c))).toBe(false)
  })

  test.each([
    ["false", { out: "false\n" }],
    ["a failed read", { code: 1 }],
    ["a crashed read", { crash: true }],
  ])("commits mode warns when rebase merge is %s and ships anyway", async (_, answer) => {
    const { io } = repo(
      { ...base, "gh repo view --json rebaseMergeAllowed -q .rebaseMergeAllowed": answer },
      replies(),
    )
    const out = await ship(io, false, "commits")
    expect(out.ok).toBe(true)
    expect(out.text).toMatch(/rebase merge/)
  })

  test("commits mode carries no warning when rebase merge is allowed", async () => {
    const { io } = repo(base, replies())
    expect((await ship(io, false, "commits")).text).not.toMatch(/rebase merge/)
  })

  test("commits dry run prints each message and the warning and writes nothing", async () => {
    const { io, ran } = repo(
      {
        ...base,
        "gh repo view --json rebaseMergeAllowed -q .rebaseMergeAllowed": { out: "false" },
      },
      ["feat: refactor", "feat: feature"],
    )
    const out = await ship(io, true, "commits")
    expect(out.text).toContain("feat: refactor")
    expect(out.text).toContain("feat: feature")
    expect(out.text).toMatch(/rebase merge/)
    expect(ran().some((c) => /^git (commit|reset|push)|^gh pr (create|edit)/.test(c))).toBe(false)
  })
})

describe("stackLine", () => {
  test("prepends the line and a blank line", () => {
    expect(stackLine("body", 7)).toBe("Stacked on #7 — merge that first\n\nbody")
  })
  test("replaces a stale line", () => {
    expect(stackLine("Stacked on #3 — merge that first\n\nbody", 7)).toBe(
      "Stacked on #7 — merge that first\n\nbody",
    )
  })
  test("strips the line when nothing is below", () => {
    expect(stackLine("Stacked on #3 — merge that first\n\nbody")).toBe("body")
    expect(stackLine("body")).toBe("body")
  })
})

describe("pushBranch with a head", () => {
  test("a slice commit is the ancestor checked against origin", async () => {
    const { io, ran } = repo({
      "git rev-parse --verify --quiet origin/feat/x-a": { code: 0 },
      "git merge-base --is-ancestor abc origin/feat/x-a": { code: 0 },
    })
    expect(await pushBranch(io, "feat/x-a", "abc")).toBeUndefined()
    expect(ran().some((c) => c.startsWith("git push"))).toBe(false)
  })
  test("not an ancestor pushes with lease", async () => {
    const { io, ran } = repo({
      "git rev-parse --verify --quiet origin/feat/x-a": { code: 0 },
      "git merge-base --is-ancestor abc origin/feat/x-a": { code: 1 },
    })
    await pushBranch(io, "feat/x-a", "abc")
    expect(ran()).toContain("git push --force-with-lease origin feat/x-a")
  })
})

describe("ship stack", () => {
  const C1 = "1".repeat(40)
  const C2 = "2".repeat(40)
  const M = "m".repeat(40)
  const two = slicesDoc(["refactor", A, B], ["feature", B, C])
  const KEY = "branch.feat/x.gtdStack"
  const view = (b: string) => `gh pr view ${b} --json number,title,body,url,state,baseRefName`
  const create = (head: string, into: string) =>
    `gh pr create --head ${head} --base ${into} --title feat: add x --body-file -`
  const pr = (n: number, over: object = {}) => ({
    out: JSON.stringify({
      number: n,
      title: "feat: add x",
      body: "standing",
      url: `https://github.com/o/r/pull/${n}`,
      state: "OPEN",
      baseRefName: "main",
      ...over,
    }),
  })
  const sbase: Record<string, Scripted> = {
    ...feature,
    "git rev-parse HEAD": { out: C },
    [`git rev-list --count ${A}..HEAD`]: { out: "6" },
    "gtd slices --json": { out: two },
    "gtd summary --slice=refactor": { out: "PROMPT refactor" },
    "gtd summary --slice=feature": { out: "PROMPT feature" },
    [`git diff --quiet ${A} ${B} -- :(exclude).gtd/`]: { code: 1 },
    [`git diff --quiet ${B} ${C} -- :(exclude).gtd/`]: { code: 1 },
    [`git log --format=%B%n ${A}..${B}`]: { out: "" },
    [`git log --format=%B%n ${B}..${C}`]: { out: "" },
    "git stripspace --strip-comments": { out: "stripped\n" },
    [`git commit-tree ${B}^{tree} -p ${A} -F -`]: { out: C1 + "\n" },
    [`git commit-tree ${C}^{tree} -p ${C1} -F -`]: { out: C2 + "\n" },
    "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { code: 1 },
    "git rev-parse refs/heads/feat/x-refactor": { out: C1 },
    "git rev-parse --verify --quiet origin/feat/x-refactor": { code: 1 },
    [view("feat/x-refactor")]: { code: 1 },
    [view("feat/x")]: { code: 1 },
    [create("feat/x-refactor", "main")]: { out: "https://github.com/o/r/pull/7\n" },
    [create("feat/x", "feat/x-refactor")]: { out: "https://github.com/o/r/pull/8\n" },
    [`git log --no-merges --reverse --format=%H%n%B%n--- ${M}..${C1}`]: { out: "LOG-ONE" },
    [`git log --no-merges --reverse --format=%H%n%B%n--- ${C1}..${C2}`]: { out: "LOG-TWO" },
    "gtd history list --json": { out: "[]" },
  }
  const writers = () => [
    "feat: refactor",
    "feat: feature",
    "feat: add x\n\nlower",
    "feat: add x\n\nupper",
  ]
  const mutating =
    /^git (reset|commit|push|branch)|^git config --local (?!--get)|^gh pr (create|edit)/

  test("branches each slice, pushes bottom first, opens PRs bottom first", async () => {
    const { io, ran } = repo(sbase, writers())
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(`git branch -f feat/x-refactor ${C1}`)
    expect(ran()).toContain(`git config --local ${KEY} refactor feature`)
    const order = [
      "git push --set-upstream origin feat/x-refactor",
      create("feat/x-refactor", "main"),
      "git push --set-upstream origin feat/x",
      create("feat/x", "feat/x-refactor"),
    ].map((c) => ran().indexOf(c))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test("each writer prompt logs only its own range; stack line on the upper PR only", async () => {
    const prompts: string[] = []
    const { io, calls } = repo(sbase, writers())
    const complete = io.complete
    io.complete = async (p) => (prompts.push(p), complete(p))
    await ship(io, false)
    expect(prompts[2]).toContain("LOG-ONE")
    expect(prompts[2]).not.toContain("LOG-TWO")
    expect(prompts[3]).toContain("LOG-TWO")
    expect(prompts[3]).not.toContain("LOG-ONE")
    const lower = calls.find((c) => c.argv === create("feat/x-refactor", "main"))
    const upper = calls.find((c) => c.argv === create("feat/x", "feat/x-refactor"))
    expect(lower?.stdin).toBe("lower\n")
    expect(upper?.stdin).toBe("Stacked on #7 — merge that first\n\nupper\n")
  })

  test("an open PR with the wrong base is retargeted", async () => {
    const { io, ran } = repo(
      {
        ...sbase,
        [view("feat/x-refactor")]: pr(5, { baseRefName: "main" }),
        [view("feat/x")]: pr(6, { baseRefName: "main" }),
        [`git rev-list --count ${M}..${C1}`]: { out: "2" },
        [`git rev-list --count ${C1}..${C2}`]: { out: "2" },
      },
      ["feat: refactor", "feat: feature", "NO-UPDATE", "NO-UPDATE"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain("gh pr edit 6 --base feat/x-refactor")
    expect(ran()).not.toContain("gh pr edit 5 --base main")
  })

  test.each(["MERGED", "CLOSED"])(
    "a %s slice PR refuses before the history push, nothing changed",
    async (state) => {
      const { io, ran } = repo(
        {
          ...sbase,
          [view("feat/x-refactor")]: pr(5, { state }),
          "gtd history list --json": { out: JSON.stringify([entry(ENTRY, C)]) },
        },
        writers(),
      )
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("refactor")
      expect(out.text).toContain("#5")
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    },
  )

  test.each([
    ["local", "git rev-parse --verify --quiet refs/heads/feat/x-refactor"],
    ["remote", "git rev-parse --verify --quiet origin/feat/x-refactor"],
  ])(
    "an unrecorded %s branch of a slice's name refuses before the history push",
    async (_, key) => {
      const { io, ran } = repo({ ...sbase, [key]: { code: 0 } }, writers())
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("feat/x-refactor") })
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    },
  )

  test("a branch named in gtdStack is not a collision", async () => {
    const { io } = repo(
      {
        ...sbase,
        [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
        "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { code: 0 },
      },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
  })

  test("a thrown draft on the upper slice is rewritten with the stack line and marked ready", async () => {
    const { io, ran, calls } = repo(
      { ...sbase, [view("feat/x")]: pr(9, { body: `${THROWN}\nwaiting` }) },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain("gh pr ready 9")
    const edit = calls.find((c) => c.argv === "gh pr edit 9 --title feat: add x --body-file -")
    expect(edit?.stdin).toBe("Stacked on #7 — merge that first\n\nupper\n")
  })

  const refresh = (upperBody: string) => ({
    ...sbase,
    [view("feat/x-refactor")]: pr(5, { body: "lower body" }),
    [view("feat/x")]: pr(6, { baseRefName: "feat/x-refactor", body: upperBody }),
    [`git rev-list --count ${M}..${C1}`]: { out: "2" },
    [`git rev-list --count ${C1}..${C2}`]: { out: "2" },
  })
  const noUpdate = () => ["feat: refactor", "feat: feature", "NO-UPDATE", "NO-UPDATE"]

  test("NO-UPDATE still re-adds a missing stack line", async () => {
    const { io, calls } = repo(refresh("upper body"), noUpdate())
    expect(await ship(io, false)).toMatchObject({ ok: true })
    const edits = calls.filter((c) => c.argv === "gh pr edit 6 --body-file -")
    expect(edits.map((e) => e.stdin)).toEqual(["Stacked on #5 — merge that first\n\nupper body"])
    expect(calls.some((c) => c.argv === "gh pr edit 5 --body-file -")).toBe(false)
  })

  test("an already-right stack line edits nothing", async () => {
    const { io, ran } = repo(refresh("Stacked on #5 — merge that first\n\nupper body"), noUpdate())
    const out = await ship(io, false)
    expect(out, out.text).toMatchObject({ ok: true })
    expect(ran().some((c) => c.startsWith("gh pr edit"))).toBe(false)
  })

  test("an upper push failing keeps the squash, reports, and a second run resumes", async () => {
    const first = repo(
      { ...sbase, "git push --set-upstream origin feat/x": { code: 1, err: "denied" } },
      writers(),
    )
    const out = await ship(first.io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("feature")
    expect(out.text).toContain("push")
    expect(out.text).toContain("refactor")
    expect(out.text).toContain("/gtd ship")
    expect(first.ran().some((c) => c.startsWith("git reset --hard"))).toBe(false)
    expect(first.ran()).toContain(create("feat/x-refactor", "main"))
    const before = [
      `git config --local ${KEY} refactor feature`,
      `git branch -f feat/x-refactor ${C1}`,
      "git push --set-upstream origin feat/x-refactor",
    ].map((c) => first.ran().indexOf(c))
    expect(before.every((i) => i >= 0)).toBe(true)
    expect([...before].sort((a, b) => a - b)).toEqual(before)

    const second = repo(
      {
        ...sbase,
        "gtd summary": { code: 1 },
        "git rev-parse HEAD": { out: C2 },
        [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
        "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
        "git rev-parse --verify --quiet origin/feat/x-refactor": { out: C1 },
        [view("feat/x-refactor")]: pr(7, { body: "lower" }),
        "git config --local --get branch.feat/x-refactor.prSyncHead": { out: C1 },
        [`git rev-list --count ${C1}..${C1}`]: { out: "0" },
      },
      ["feat: add x\n\nupper"],
    )
    expect(await ship(second.io, false)).toMatchObject({ ok: true })
    expect(second.ran().some((c) => /^git push .*feat\/x-refactor/.test(c))).toBe(false)
    expect(second.ran()).toContain("git push --set-upstream origin feat/x")
    expect(second.ran()).toContain(create("feat/x", "feat/x-refactor"))
    expect(second.ran().some((c) => c.startsWith("gh pr edit"))).toBe(false)
    expect(second.ran().some((c) => /^git (reset|commit)/.test(c))).toBe(false)
  })

  test("a recorded stack that no longer chains is unset and the branch ships alone", async () => {
    const lines: string[] = []
    const { io, ran } = repo(
      {
        ...sbase,
        "gtd summary": { code: 1 },
        [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
        "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
        [`git merge-base --is-ancestor ${C1} HEAD`]: { code: 1 },
      },
      ["feat: add x\n\nbody"],
    )
    io.log = (l) => void lines.push(l)
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(`git config --local --unset ${KEY}`)
    expect(ran()).toContain(create("feat/x", "main"))
    expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
    expect(lines.filter((l) => /stack/.test(l))).toHaveLength(1)
  })

  test("the dry run lists each slice, base and retarget, and writes nothing", async () => {
    const { io, ran } = repo(
      {
        ...sbase,
        [view("feat/x")]: pr(6, { baseRefName: "main" }),
      },
      ["feat: refactor", "feat: feature"],
    )
    const out = await ship(io, true)
    expect(out.ok).toBe(true)
    expect(out.text).toContain("feat: refactor")
    expect(out.text).toContain("feat: feature")
    expect(out.text).toContain("feat/x-refactor")
    expect(out.text).toContain("would open into main")
    expect(out.text).toContain("would refresh https://github.com/o/r/pull/6")
    expect(out.text).toContain("retarget #6 from main to feat/x-refactor")
    expect(ran().some((c) => mutating.test(c))).toBe(false)
  })

  test("a single-slice ship unsets the stack record", async () => {
    const { io, ran } = repo(feature, ["feat: add x\n\nwhy", "feat: add x\n\nbody"])
    await ship(io, false)
    expect(ran()).toContain(`git config --local --unset ${KEY}`)
    expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
  })

  test("commits mode builds no slice branches", async () => {
    const { io, ran } = repo(
      { ...sbase, [create("feat/x", "main")]: { out: "https://github.com/o/r/pull/7\n" } },
      ["feat: refactor", "feat: feature", "feat: add x\n\nbody"],
    )
    await ship(io, false, "commits")
    expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
    expect(ran().some((c) => c.startsWith(`git config --local ${KEY} `))).toBe(false)
    expect(ran()).toContain(`git config --local --unset ${KEY}`)
  })

  const resume: Record<string, Scripted> = {
    ...sbase,
    "gtd summary": { code: 1 },
    "git rev-parse HEAD": { out: C2 },
    [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
    "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
    "git rev-parse --verify --quiet origin/feat/x-refactor": { out: C1 },
  }
  const pushes = (ran: () => string[]) => ran().filter((c) => c.startsWith("git push"))

  test("a failed git branch -f leaves a record that a second run rebuilds from HEAD", async () => {
    const first = repo(
      { ...sbase, [`git branch -f feat/x-refactor ${C1}`]: { code: 1 } },
      writers(),
    )
    const out = await ship(first.io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("git branch -f feat/x-refactor failed")
    expect(first.ran().some((c) => /^git push|^gh pr (create|edit)/.test(c))).toBe(false)

    const second = repo(
      {
        ...resume,
        "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { code: 1 },
        "git rev-parse --verify --quiet HEAD~1": { out: C1 },
        "git rev-parse --verify --quiet origin/feat/x-refactor": { code: 1 },
        [view("feat/x-refactor")]: { code: 1 },
      },
      ["feat: add x\n\nlower", "feat: add x\n\nupper"],
    )
    expect(await ship(second.io, false)).toMatchObject({ ok: true })
    expect(second.ran()).toContain(`git branch -f feat/x-refactor ${C1}`)
    expect(second.ran()).toContain(create("feat/x-refactor", "main"))
    expect(second.ran()).toContain(create("feat/x", "feat/x-refactor"))
  })

  test("a failed git config puts the process back instead of keeping an unrecorded squash", async () => {
    const { io, ran } = repo(
      { ...sbase, [`git config --local ${KEY} refactor feature`]: { code: 1, err: "locked" } },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("undone")
    expect(ran()).toContain("git reset --soft ORIG_HEAD")
    expect(ran().some((c) => /^git (branch|push)|^gh pr (create|edit)/.test(c))).toBe(false)
  })

  test("a merged lower slice drops out of a resumed stack before any push", async () => {
    const { io, ran } = repo({ ...resume, [view("feat/x-refactor")]: pr(7, { state: "MERGED" }) }, [
      "feat: add x\n\nupper",
    ])
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(pushes(ran)).toEqual(["git push --set-upstream origin feat/x"])
    expect(ran()).toContain(create("feat/x", "main"))
    expect(ran()).toContain(`git log --no-merges --reverse --format=%H%n%B%n--- ${C1}..${C2}`)
  })

  test("a closed lower slice refuses a resume before any push and names the unset", async () => {
    const { io, ran } = repo({ ...resume, [view("feat/x-refactor")]: pr(7, { state: "CLOSED" }) })
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain(`git config --local --unset ${KEY}`)
    expect(ran().some((c) => /^git push|^gh pr (create|edit)/.test(c))).toBe(false)
  })

  test("a dry run never unsets a stack record that no longer chains", async () => {
    const { io, ran } = repo(
      { ...resume, [`git merge-base --is-ancestor ${C1} HEAD`]: { code: 1 } },
      ["feat: add x\n\nbody"],
    )
    await ship(io, true)
    expect(ran().some((c) => mutating.test(c))).toBe(false)
  })

  test("a merged lower slice of a fresh stack refuses and names the way out", async () => {
    const { io, ran } = repo(
      { ...sbase, [view("feat/x-refactor")]: pr(7, { state: "MERGED" }) },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("GTD_SHIP_MODE=commits")
    expect(ran().some((c) => /^git (reset|push)/.test(c))).toBe(false)
  })

  test("a slice branch moved by a writer turn is not pushed", async () => {
    const { io, ran } = repo(
      { ...sbase, "git rev-parse refs/heads/feat/x-refactor": { out: "9".repeat(40) } },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("no longer points")
    expect(ran().some((c) => c.startsWith("git push"))).toBe(false)
  })

  test("a lower PR whose number cannot be read stops before the upper one", async () => {
    const { io, ran } = repo(
      { ...sbase, [create("feat/x-refactor", "main")]: { out: "created\n" } },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("pull request")
    expect(ran()).not.toContain(create("feat/x", "feat/x-refactor"))
    expect(ran()).not.toContain("git push --set-upstream origin feat/x")
  })

  test("a failing commit-tree builds nothing: no reset, branch or gh call", async () => {
    const { io, ran } = repo(
      { ...sbase, [`git commit-tree ${C}^{tree} -p ${C1} -F -`]: { code: 1, err: "boom" } },
      ["feat: refactor", "feat: feature"],
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("commit-tree")
    expect(ran().some((c) => /^git (reset|branch)|^gh pr (create|edit)/.test(c))).toBe(false)
  })

  test("an empty commit-tree reply is a failure, never a reset to ''", async () => {
    const { io, ran } = repo(
      { ...sbase, [`git commit-tree ${B}^{tree} -p ${A} -F -`]: { out: "\n" } },
      ["feat: refactor", "feat: feature"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: false })
    expect(ran().some((c) => c.startsWith("git reset"))).toBe(false)
  })

  test("a failed retarget stops before the body is edited", async () => {
    const { io, ran } = repo(
      {
        ...sbase,
        [view("feat/x")]: pr(6, { baseRefName: "main" }),
        "gh pr edit 6 --base feat/x-refactor": { code: 1, err: "nope" },
      },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("retarget")
    expect(ran().some((c) => c.startsWith("gh pr edit 6 --body-file"))).toBe(false)
  })

  test("commit.gpgSign signs every slice commit", async () => {
    const signed = (tip: string, prev: string) => `git commit-tree ${tip}^{tree} -S -p ${prev} -F -`
    const { io, ran } = repo(
      {
        ...sbase,
        "git config --type=bool --get commit.gpgSign": { out: "true\n" },
        [signed(B, A)]: { out: C1 + "\n" },
        [signed(C, C1)]: { out: C2 + "\n" },
      },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(signed(B, A))
    expect(ran()).toContain(signed(C, C1))
  })

  test("a slice commit carries HEAD's .gtd/, not the steering files its tip held", async () => {
    const T = "7".repeat(40)
    const { io, calls, ran } = repo(
      {
        ...sbase,
        [`git rev-parse --verify --quiet ${B}:.gtd`]: { out: "g1" },
        "git rev-parse --verify --quiet HEAD:.gtd": { out: "g2" },
        [`git rev-parse --verify --quiet ${C}:.gtd`]: { out: "g2" },
        [`git ls-tree -z ${B}`]: {
          out: "100644 blob aaa\tREADME\x00040000 tree g1\t.gtd\x00040000 tree bbb\tsrc\x00",
        },
        "git ls-tree -z HEAD .gtd": { out: "040000 tree g2\t.gtd\x00" },
        "git mktree -z": { out: T + "\n" },
        [`git commit-tree ${T} -p ${A} -F -`]: { out: C1 + "\n" },
      },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(`git commit-tree ${T} -p ${A} -F -`)
    const stdin = calls.find((c) => c.argv === "git mktree -z")?.stdin
    expect(stdin).toContain("tree g2\t.gtd")
    expect(stdin).not.toContain("tree g1")
    expect(stdin).toContain("README")
  })

  test("a gtd summary --slice that fails refuses with its stderr, nothing changed", async () => {
    const { io, ran } = repo(
      { ...sbase, "gtd summary --slice=feature": { code: 1, err: "config changed" } },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("config changed")
    expect(ran().some((c) => /^git (reset|push|commit)|^gh pr (create|edit)/.test(c))).toBe(false)
  })
})
