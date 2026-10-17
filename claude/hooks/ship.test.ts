import { describe, expect, test, vi } from "vitest"

import { jobs } from "./jobs"
import { cleanReply, costTrailers, READ_ONLY_GIT, ship, THROWN } from "./ship"
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

const feature: Record<string, Scripted> = {
  "git rev-parse --abbrev-ref HEAD": { out: "feat/x\n" },
  "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { out: "origin/main\n" },
  "gtd next --json=initial": { out: "true\n" },
  "gtd next --json=state": { out: "idle\n" },
  "gtd summary": {
    out: `Describe the process.\nInspect the range: \`git log ${BASE.slice(0, 7)}..${TIP.slice(0, 7)}\``,
  },
  [`git rev-parse --verify ${BASE.slice(0, 7)}^{commit}`]: { out: BASE },
  [`git rev-parse --verify ${TIP.slice(0, 7)}^{commit}`]: { out: TIP },
  "git rev-parse HEAD": { out: TIP },
  [`git rev-list --count ${BASE}..HEAD`]: { out: "5" },
  [`git diff --quiet ${BASE} HEAD -- :(exclude).gtd/`]: { code: 1 },
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
      expect(outcomes[0]).toMatchObject({ ok: false, text: expect.stringMatching(/git push/) })
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

describe("ship history", () => {
  test("pushes this process's ref before the squash and writes the trailer", async () => {
    const { io, calls, ran } = repo(withHistory, ["feat: add x\n\nwhy", "feat: add x\n\nbody"])
    expect(await ship(io, false)).toMatchObject({ ok: true })
    const push = `git push origin ${REF}:${REF}`
    expect(ran()).toContain(push)
    expect(ran().indexOf(push)).toBeLessThan(ran().indexOf(`git reset --soft ${BASE}`))
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).toBe(
      `feat: add x\n\nwhy\n\nGtd-Cost: 1 sonnet\nGtd-Cost: 0.75 opus\nGtd-History: ${REF}\n`,
    )
    expect(ran().some((c) => c.includes("refs/gtd/history/*"))).toBe(false)
    expect(ran().filter((c) => c.startsWith("git push origin refs/gtd/history"))).toEqual([push])
  })

  test("a failed history push fails the ship with nothing squashed or pushed", async () => {
    const { io, ran } = repo({ ...withHistory, [`git push origin ${REF}:${REF}`]: { code: 1 } }, [
      "feat: add x",
    ])
    expect(await ship(io, false)).toEqual({
      ok: false,
      text: `git push of ${REF} failed; nothing was squashed or pushed.`,
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
    expect(ran().some((c) => c.startsWith("git push origin refs/gtd"))).toBe(false)
  })

  test("the no-change drop looks up and pushes nothing", async () => {
    const { io, ran } = repo({
      ...withHistory,
      [`git diff --quiet ${BASE} HEAD -- :(exclude).gtd/`]: { code: 0 },
    })
    await ship(io, false)
    expect(ran()).not.toContain("gtd history list --json")
    expect(ran().some((c) => c.startsWith("git push origin refs/gtd"))).toBe(false)
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
    expect(ran().some((c) => c.startsWith("git push origin refs/gtd"))).toBe(false)
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
    expect(ran().some((c) => c.startsWith("git push origin refs/gtd"))).toBe(false)
    expect(calls.find((c) => c.argv.startsWith("git commit"))?.stdin).not.toContain("Gtd-History")
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
      [`git diff --quiet ${BASE} HEAD -- :(exclude).gtd/`]: { code: 0 },
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
    for (const ok of ["git log --format=%B a..b", "git diff --stat a..b", "git show HEAD"]) {
      expect(READ_ONLY_GIT.test(ok)).toBe(true)
    }
    for (const bad of [
      "git push origin x",
      "git log; rm -rf .",
      "git log | sh",
      "git log $(curl x)",
      "curl x",
      "git log\nrm x",
    ]) {
      expect(READ_ONLY_GIT.test(bad)).toBe(false)
    }
  })
})
