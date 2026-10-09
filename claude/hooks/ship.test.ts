import { describe, expect, test } from "vitest"

import { cleanReply, costTrailers, READ_ONLY_GIT, ship } from "./ship"
import type { Ran, ShipIo } from "./ship"

const BASE = "b".repeat(40)
const TIP = "c".repeat(40)

// A scripted repository: each argv (joined by spaces) answers from `script`,
// anything unscripted succeeds with no output. Every call is recorded.
const repo = (script: Record<string, Partial<Ran>>, replies: string[] = []) => {
  const calls: { argv: string; stdin?: string }[] = []
  const io: ShipIo = {
    run: async (argv, stdin) => {
      const key = argv.join(" ")
      calls.push({ argv: key, stdin })
      return { code: 0, out: "", err: "", ...script[key] }
    },
    complete: async () => replies.shift(),
    log: () => {},
    today: () => "2026-10-03",
  }
  return { io, calls, ran: () => calls.map((c) => c.argv) }
}

const feature: Record<string, Partial<Ran>> = {
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
