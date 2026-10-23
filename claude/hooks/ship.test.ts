import { describe, expect, test, vi } from "vitest"

import { jobs } from "./jobs"
import {
  cleanReply,
  costTrailers,
  pushBranch,
  NO_PR_FOUND,
  READ_ONLY_GIT,
  ship,
  THROWN,
  withCloses,
} from "./ship"
import type { Ran, ShipIo } from "./ship"

const noPr = (b: string) => ({ code: 1, err: `${NO_PR_FOUND} for branch "${b}"` })

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
      // a range's `^<merge base>` floor is asserted separately, not scripted
      const hit = script[key] ?? script[key.replace(/^(git (?:rev-list|log) .*) \^\w+$/, "$1")]
      if (hit?.crash) throw new Error("timed out after 10 minutes")
      return { code: 0, out: "", err: "", ...hit }
    },
    complete: async () => replies.shift(),
    log: () => {},
    today: () => "2026-10-03",
  }
  return { io, calls, ran: () => calls.map((c) => c.argv) }
}

const feature: Record<string, Scripted> = {
  "git rev-parse --abbrev-ref HEAD": { out: "feat/x\n" },
  "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { out: "origin/main\n" },
  "gtd next --json=initial": { out: "true\n" },
  "gtd next --json=state": { out: "idle\n" },
  "gtd summary": { out: `Describe the process.\nInspect the range: git log ${BASE}..${TIP}\n` },
  [`git rev-parse --verify ${BASE}^{commit}`]: { out: BASE },
  [`git rev-parse --verify ${TIP}^{commit}`]: { out: TIP },
  "git rev-parse HEAD": { out: TIP },
  [`git rev-list --count ${BASE}..HEAD`]: { out: "5" },
  [`git diff --quiet ${BASE} ${TIP} -- :(exclude).gtd/`]: { code: 1 },
  [`git log --format=%B%n ${BASE}..${TIP}`]: {
    out: "a\nGtd-Cost: 0.5 opus\n\nb\nGtd-Cost: 0.25 opus\nGtd-Cost: 1 sonnet\n",
  },
  "git merge-base main HEAD": { out: "m".repeat(40) },
  "git merge-base --is-ancestor main origin/main": { code: 1 },
  "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
  "gh pr view feat/x --json number,title,body,url,state": noPr("feat/x"),
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

  test("a summary range naming 64-hex commits parses and squashes", async () => {
    const base = "1".repeat(64)
    const tip = "2".repeat(64)
    const { io, ran } = repo(
      {
        ...feature,
        "gtd summary": { out: `Inspect the range: git log ${base}..${tip}\n` },
        [`git rev-parse --verify ${base}^{commit}`]: { out: base },
        [`git rev-parse --verify ${tip}^{commit}`]: { out: tip },
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

  test("carries the issue a commit closes into the pull-request body", async () => {
    const { io, calls } = repo(
      {
        ...feature,
        [`git log --no-merges --reverse --format=%H%n%B%n--- ${"m".repeat(40)}..HEAD`]: {
          out: `${TIP}\nfeat: add x\n\nwhy\n\nCloses #384\n---\n`,
        },
      },
      ["feat: add x\n\nwhy\n\nCloses #384", "feat: add x\n\n## Motivation\n\ntext"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(calls.find((c) => c.argv.startsWith("gh pr create"))?.stdin).toBe(
      "## Motivation\n\ntext\n\nCloses #384\n",
    )
  })

  describe("a closed pull request of an earlier ship", () => {
    const LS = "git ls-remote origin refs/heads/feat/x"
    const KEY = "branch.feat/x.gtdAbandonedPr"
    const closed = (ls: string): Record<string, Scripted> => ({
      ...feature,
      "gh pr view feat/x --json number,title,body,url,state": {
        out: JSON.stringify({
          number: 4,
          body: "old",
          url: "https://github.com/o/r/pull/4",
          state: "CLOSED",
        }),
      },
      [LS]: { out: ls },
    })
    const held = `${TIP}\trefs/heads/feat/x\n`
    const writers = () => ["feat: add x", "feat: add x\n\nbody"]
    const opened = (ran: () => string[]) => ran().some((c) => c.startsWith("gh pr create"))

    test("is ignored when origin lost the branch: recorded, then pushed past a stale tracking ref", async () => {
      const { io, ran } = repo(
        { ...closed(""), "git rev-parse --verify --quiet origin/feat/x": { code: 0 } },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      const at = (c: string) => ran().indexOf(c)
      expect(at(`git config --local ${KEY} 4`)).toBeGreaterThan(-1)
      expect(at("git push --set-upstream origin feat/x")).toBeGreaterThan(
        at(`git config --local ${KEY} 4`),
      )
      expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
      expect(opened(ran)).toBe(true)
    })

    test("stays ignored on a retry once ship pushed the branch again", async () => {
      const { io, ran } = repo(
        { ...closed(held), [`git config --local --get ${KEY}`]: { out: "4\n" } },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(opened(ran)).toBe(true)
      expect(ran().some((c) => c.startsWith("gh pr edit"))).toBe(false)
    })

    test("a retry after a failed push still pushes past the stale tracking ref", async () => {
      const { io, ran } = repo(
        {
          ...closed(""),
          [`git config --local --get ${KEY}`]: { out: "4\n" },
          "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
        },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran()).toContain("git push --set-upstream origin feat/x")
      expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
    })

    test("the record is dropped once the new pull request opens", async () => {
      const { io, ran } = repo(closed(""), writers())
      expect(await ship(io, false)).toMatchObject({ ok: true })
      const create = ran().findIndex((c) => c.startsWith("gh pr create"))
      expect(ran().indexOf(`git config --local --unset ${KEY}`)).toBeGreaterThan(create)
    })

    test("refuses while origin still has the branch", async () => {
      const { io, ran } = repo(closed(held), writers())
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("CLOSED, not open") })
      expect(opened(ran)).toBe(false)
    })

    test("refuses when ls-remote fails", async () => {
      const { io, ran } = repo({ ...closed(""), [LS]: { code: 128, err: "offline" } }, writers())
      expect(await ship(io, false)).toMatchObject({ ok: false })
      expect(opened(ran)).toBe(false)
    })

    test("refuses, unpushed, when the record cannot be written", async () => {
      const { io, ran } = repo(
        { ...closed(""), [`git config --local ${KEY} 4`]: { code: 1, err: "locked" } },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({
        ok: false,
        text: expect.stringContaining("locked"),
      })
      expect(ran().some((c) => c.startsWith("git push --set-upstream origin feat/x"))).toBe(false)
    })
  })

  test("an open pull request gains the issue new commits close, even with NO-UPDATE", async () => {
    const pr = { number: 7, body: "standing", url: "https://github.com/o/r/pull/7", state: "OPEN" }
    const M = "m".repeat(40)
    const { io, calls } = repo(
      {
        ...feature,
        "gtd summary": { code: 1 },
        "gh pr view feat/x --json number,title,body,url,state": {
          out: JSON.stringify(pr),
        },
        [`git rev-list --count ${M}..HEAD`]: { out: "2" },
        [`git log --no-merges --format=%B%n--- ${M}..HEAD`]: {
          out: "fix: x\n\nCloses #384\n---\n",
        },
      },
      ["NO-UPDATE"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(calls.find((c) => c.argv.startsWith("gh pr edit 7"))?.stdin).toBe(
      "standing\n\nCloses #384",
    )
  })

  test("an open pull request with nothing new still gains the issue its branch closes", async () => {
    const pr = { number: 7, body: "standing", url: "https://github.com/o/r/pull/7", state: "OPEN" }
    const M = "m".repeat(40)
    const { io, calls } = repo({
      ...feature,
      "gtd summary": { code: 1 },
      "gh pr view feat/x --json number,title,body,url,state": {
        out: JSON.stringify(pr),
      },
      [`git rev-list --count ${M}..HEAD`]: { out: "0" },
      [`git log --no-merges --format=%B%n--- ${M}..HEAD`]: { out: "fix: x\n\nCloses #384\n---\n" },
    })
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(calls.find((c) => c.argv.startsWith("gh pr edit 7"))?.stdin).toBe(
      "standing\n\nCloses #384",
    )
  })

  test("reads bullets, a trailing period, 'and' and issue URLs, never across lines", () => {
    const log =
      "- Fixes #1.\nResolves #2 and fixes https://github.com/o/r/issues/3\nFixes\n#4 is unrelated\nCloses #5 later\n"
    expect(withCloses("b", log)).toBe("b\n\nCloses #1\nCloses #2\nCloses o/r#3")
  })

  test("reads comma-separated closing lists, deduped regardless of case", () => {
    const log = "Closes #1, #2\nFixes o/R#3, fixes #4\n---\nCloses o/r#3\n"
    expect(withCloses("body", log)).toBe("body\n\nCloses #1\nCloses #2\nCloses o/R#3\nCloses #4")
    expect(withCloses("body\n\nCloses #1, #2", "Closes #2")).toBe("body\n\nCloses #1, #2")
  })

  test("adds each closed issue once, and none the body already closes", () => {
    const log = "a\n\nFixes #1\nresolves o/r#2\n---\nb\n\nCloses #1\nCloses #3\nsee #4\n---\n"
    expect(withCloses("text\n\ncloses #3\n", log)).toBe(
      "text\n\ncloses #3\n\nCloses #1\nCloses o/r#2",
    )
    expect(withCloses("text", "a\n\nmentions #9 in prose\n")).toBe("text")
    expect(withCloses("", "Closes #5")).toBe("Closes #5")
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
        "gh pr view feat/x --json number,title,body,url,state": {
          out: JSON.stringify(pr),
        },
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
        "gh pr view feat/x --json number,title,body,url,state": {
          out: JSON.stringify(pr),
        },
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
        "gh pr view feat/x --json number,title,body,url,state": {
          out: JSON.stringify(pr),
        },
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
      "git diff HEAD~1 -- src/x.ts",
      "git diff a...b -- docs/",
      "git show HEAD",
      "git branch",
      "git branch --list -a",
      "git branch --contains abc123",
      "git log --oneline",
      "git log --format='%h %s'",
      'git log --format="%H%n%B" a..b',
      "git log --no-merges a..b",
      "git diff --text a b",
      "git log --exclude=x --all",
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
      'git log "--output=x"',
      "git log '--output' x",
      "git log \\--output=x",
      'git show "-ox"',
      'git log -"-"output=x',
      "git diff ''--output=x",
      "git diff '.'./x README.md",
      "git diff .\\./x README.md",
      'git diff ."."/x y',
      "git diff x/.\\./.\\./y z",
      "git log -1 {--output=OUT,--oneline}",
      "git log -1 {,--output=OUT}",
      "git log -*utput=x",
      "git log --out?ut=x",
      "git diff --no-index /etc/hosts /dev/null",
      "git diff --no-index a b",
      "git diff /etc/hosts /dev/null",
      "git diff -- /etc/passwd /dev/null",
      "git diff --stat '/etc/hosts' /dev/null",
      "git diff ~/x y",
      "git diff ../x y",
      "git diff a/../../x y",
      'git diff ".."/x y',
      "git diff --ext-diff",
      "git show --textconv x",
    ]) {
      expect(READ_ONLY_GIT.test(bad)).toBe(false)
    }
  })
})

describe("ship reads", () => {
  const M = "m".repeat(40)
  const view = "gh pr view feat/x --json number,title,body,url,state"
  const pr = (over: object = {}) => ({
    out: JSON.stringify({
      number: 8,
      title: "feat: add x",
      body: "standing",
      url: "https://github.com/o/r/pull/8",
      state: "OPEN",
      baseRefName: "main",
      ...over,
    }),
  })
  const writes = /^git (reset|commit|push)|^gh pr (create|edit)/

  test("a failing gh pr view with no process refuses naming branch and stderr, writes nothing", async () => {
    const { io, ran } = repo({
      ...feature,
      "gtd summary": { code: 1 },
      [view]: { code: 1, err: "HTTP 401: Bad credentials\n" },
    })
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("feat/x")
    expect(out.text).toContain("HTTP 401: Bad credentials")
    expect(ran().some((c) => writes.test(c))).toBe(false)
  })

  test("a failing gh pr view after the squash keeps it, and pushes and opens nothing", async () => {
    const { io, ran } = repo({ ...feature, [view]: { code: 1, err: "HTTP 401" } }, [
      "feat: add x\n\nwhy",
    ])
    expect(await ship(io, false)).toMatchObject({ ok: false })
    expect(ran()).toContain(`git reset --soft ${BASE}`)
    expect(ran().some((c) => /^git push|^gh pr (create|edit)/.test(c))).toBe(false)
  })

  test.each([false, true])(
    "a pull request read that is not JSON refuses (dry run %s)",
    async (dry) => {
      const { io, ran } = repo({ ...feature, [view]: { out: "not json" } }, ["feat: add x\n\nwhy"])
      const out = await ship(io, dry)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("feat/x") })
      expect(ran().some((c) => /^git push|^gh pr (create|edit)/.test(c))).toBe(false)
    },
  )

  describe("the since-head range floors at the merge base", () => {
    const S = "7".repeat(40)
    const single = (extra: Record<string, Scripted>): Record<string, Scripted> => ({
      ...feature,
      "gtd summary": { code: 1 },
      [view]: pr(),
      "git config --local --get branch.feat/x.prSyncHead": { out: S + "\n" },
      [`git rev-list --count ${M}..HEAD`]: { out: "2" },
      [`git rev-list --count ${S}..HEAD`]: { out: "3" },
      ...extra,
    })
    const counts = (ran: () => string[]) =>
      ran().filter((c) => c.startsWith("git rev-list --count"))

    test("a synced head below the merge base (a main merge) still is floored at it", async () => {
      const { io, ran } = repo(
        single({ [`git merge-base --is-ancestor ${M} ${S}`]: { code: 1 } }),
        ["NO-UPDATE"],
      )
      await ship(io, false)
      expect(counts(ran)).toEqual([`git rev-list --count ${S}..HEAD ^${M}`])
    })

    test.each([
      ["missing", { [`git rev-parse --verify --quiet ${S}^{commit}`]: { code: 1 } }],
      ["not an ancestor of HEAD", { [`git merge-base --is-ancestor ${S} HEAD`]: { code: 1 } }],
    ])("a synced head that is %s falls back to the merge base", async (_, extra) => {
      const { io, ran } = repo(single(extra), ["NO-UPDATE"])
      await ship(io, false)
      expect(counts(ran)).toEqual([`git rev-list --count ${M}..HEAD ^${M}`])
    })
  })

  test("a process tip that is not HEAD refuses before anything changes", async () => {
    const { io, ran } = repo({ ...feature, "git rev-parse HEAD": { out: "d".repeat(40) } })
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false, text: expect.stringContaining("is not HEAD") })
    expect(ran().some((c) => writes.test(c))).toBe(false)
  })

  test("a summary naming no range refuses to guess a base", async () => {
    const { io, ran } = repo({ ...feature, "gtd summary": { out: "Describe it.\n" } })
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false, text: expect.stringContaining("names no commit range") })
    expect(ran().some((c) => writes.test(c))).toBe(false)
  })
})

describe("the base ref a ship describes against", () => {
  const MO = "5".repeat(40)
  const MERGE_BASE = (ref: string) => `git merge-base ${ref} HEAD`
  const run = async (script: Record<string, Scripted>) => {
    const { io, ran } = repo({ ...feature, ...script }, ["feat: add x", "feat: add x\n\nbody"])
    await ship(io, false)
    return ran()
  }

  test("single-PR path with a stale diverged main: only the branch's commits are described", async () => {
    const calls = await run({
      "git merge-base origin/main HEAD": { out: MO },
      [`git merge-base --is-ancestor ${MO} main`]: { code: 1 },
      [`git log --no-merges --reverse --format=%H%n%B%n--- ${MO}..HEAD`]: { out: "LOG-OWN" },
    })
    expect(calls).toContain(MERGE_BASE("origin/main"))
    expect(calls).toContain(`git diff --stat ${MO}..HEAD`)
    expect(calls.some((c) => c.includes("m".repeat(40)))).toBe(false)
  })

  test("local main behind origin/main: origin/main is the base", async () => {
    const calls = await run({ "git merge-base --is-ancestor main origin/main": { code: 0 } })
    expect(calls).toContain(MERGE_BASE("origin/main"))
    expect(calls).not.toContain(MERGE_BASE("main"))
  })

  test("local main ahead of origin/main with the branch cut from it: main stays the base", async () => {
    const calls = await run({
      "git merge-base origin/main HEAD": { out: MO },
      [`git merge-base --is-ancestor ${MO} main`]: { code: 0 },
    })
    expect(calls).toContain(MERGE_BASE("main"))
  })

  test("only origin/main resolves: origin/main is the base", async () => {
    const calls = await run({ "git rev-parse --verify --quiet main": { code: 1 } })
    expect(calls).toContain(MERGE_BASE("origin/main"))
  })
})
