import { describe, expect, test, vi } from "vitest"

import { jobs } from "./jobs"
import {
  cleanReply,
  costTrailers,
  pushBranch,
  NO_PR_FOUND,
  READ_ONLY_GIT,
  readSlices,
  ship,
  shipMode,
  stackLine,
  THROWN,
  withCloses,
} from "./ship"
import type { Ran, ShipIo, Shipped } from "./ship"

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
  "git merge-base --is-ancestor main origin/main": { code: 1 },
  "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
  "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": noPr("feat/x"),
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

describe("pushBranch with a lease", () => {
  const tracked = { "git rev-parse --verify --quiet origin/feat/x": { code: 0 } }
  test("pushes with the lease sha and no ancestor shortcut", async () => {
    const { io, ran } = repo({
      ...tracked,
      "git merge-base --is-ancestor abc origin/feat/x": { code: 0 },
    })
    expect(await pushBranch(io, "feat/x", "abc", "f".repeat(40))).toBeUndefined()
    expect(ran()).toContain(`git push --force-with-lease=feat/x:${"f".repeat(40)} origin feat/x`)
  })
  test("a rejected push says origin moved, pull or reconcile", async () => {
    const { io } = repo({
      ...tracked,
      [`git push --force-with-lease=feat/x:${"f".repeat(40)} origin feat/x`]: {
        code: 1,
        err: "stale info",
      },
    })
    expect(await pushBranch(io, "feat/x", "abc", "f".repeat(40))).toBe(
      "git push failed: origin/feat/x moved. Pull or reconcile feat/x, then ship.\nstale info",
    )
  })
  test("a lease without a tracking ref still force-pushes with the lease", async () => {
    const { io, ran } = repo({ "git rev-parse --verify --quiet origin/feat/x": { code: 1 } })
    await pushBranch(io, "feat/x", "abc", "f".repeat(40))
    expect(ran()).toContain(`git push --force-with-lease=feat/x:${"f".repeat(40)} origin feat/x`)
    expect(ran().some((c) => c.includes("--set-upstream"))).toBe(false)
  })
  test("no lease and no origin copy takes today's first push", async () => {
    const { io, ran } = repo({ "git rev-parse --verify --quiet origin/feat/x": { code: 1 } })
    await pushBranch(io, "feat/x", "abc")
    expect(ran()).toContain("git push --set-upstream origin feat/x")
    expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
  })
})

describe("pushBranch with a persisted lease", () => {
  const KEY = "git config --local --get branch.feat/x.gtdLease"
  const UNSET = "git config --local --unset branch.feat/x.gtdLease"
  const L = "f".repeat(40)
  const tracked = {
    "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
    "git merge-base --is-ancestor HEAD origin/feat/x": { code: 0 },
  }
  const push = `git push --force-with-lease=feat/x:${L} origin feat/x`
  const LS = "git ls-remote origin refs/heads/feat/x"
  const atL = { [LS]: { out: `${L}\trefs/heads/feat/x\n` } }
  const unreconciled = { ...atL, [`git merge-base --is-ancestor ${L} HEAD`]: { code: 1 } }
  test("pushes with the key's sha even when HEAD is an ancestor of origin, then unsets it", async () => {
    const { io, ran } = repo({ ...tracked, ...unreconciled, [KEY]: { out: `${L}\n` } })
    expect(await pushBranch(io, "feat/x")).toBeUndefined()
    expect(ran()).toContain(push)
    expect(ran()).toContain(UNSET)
  })
  test("a rejected push keeps the key and names the unset line", async () => {
    const { io, ran } = repo({
      ...tracked,
      ...unreconciled,
      [KEY]: { out: L },
      [push]: { code: 1, err: "stale info" },
    })
    expect(await pushBranch(io, "feat/x")).toBe(
      "git push failed: origin/feat/x moved. Pull or reconcile feat/x, then ship.\nstale info\nTo overwrite origin's copy on purpose, run git config --local --unset branch.feat/x.gtdLease first.",
    )
    expect(ran()).not.toContain(UNSET)
  })
  test("an unrelated push failure keeps the key and does not name the unset line", async () => {
    const { io, ran } = repo({
      ...tracked,
      ...unreconciled,
      [KEY]: { out: L },
      [push]: { code: 1, err: "Permission denied" },
    })
    const out = await pushBranch(io, "feat/x")
    expect(out).toContain("Permission denied")
    expect(out).not.toContain("--unset")
    expect(ran()).not.toContain(UNSET)
  })
  test("origin's sha already in the pushed commit leases on it, then unsets the key", async () => {
    const R = "e".repeat(40)
    const reconciled = `git push --force-with-lease=feat/x:${R} origin feat/x`
    const { io, ran } = repo({
      ...tracked,
      [KEY]: { out: L },
      [LS]: { out: `${R}\trefs/heads/feat/x\n` },
    })
    expect(await pushBranch(io, "feat/x")).toBeUndefined()
    expect(ran()).toContain(reconciled)
    expect(ran()).not.toContain(push)
    expect(ran()).toContain(UNSET)
  })
  test("a key whose branch origin lost is unset and the branch pushed fresh", async () => {
    const { io, ran } = repo({
      [KEY]: { out: L },
      [LS]: { out: "" },
      "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
    })
    expect(await pushBranch(io, "feat/x")).toBeUndefined()
    expect(ran()).toContain(UNSET)
    expect(ran()).toContain("git push --set-upstream origin feat/x")
    expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
  })
  test("a key whose branch origin lost pushes fresh though a stale tracking ref resolves", async () => {
    const { io, ran } = repo({
      [KEY]: { out: L },
      [LS]: { out: "" },
      "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
      "git merge-base --is-ancestor HEAD origin/feat/x": { code: 1 },
    })
    expect(await pushBranch(io, "feat/x")).toBeUndefined()
    expect(ran()).toContain(UNSET)
    expect(ran()).toContain("git push --set-upstream origin feat/x")
    expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
  })
  test("a killed push keeps the key", async () => {
    const { io, ran } = repo({
      ...tracked,
      ...unreconciled,
      [KEY]: { out: L },
      [push]: { crash: true },
    })
    expect(await pushBranch(io, "feat/x")).toContain("did not finish")
    expect(ran()).not.toContain(UNSET)
  })
  test("no key: today's ancestor shortcut and no unset", async () => {
    const { io, ran } = repo(tracked)
    expect(await pushBranch(io, "feat/x")).toBeUndefined()
    expect(ran().some((c) => c.startsWith("git push") || c === UNSET)).toBe(false)
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
      "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": {
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
        "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": {
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
      "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": {
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
        "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": {
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
        "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": {
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
        "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": {
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

  test("every commit and the PR title are typed by the change, never by a slice's name", async () => {
    const prompts: string[] = []
    const { io } = repo(base)
    io.complete = async (p) => (prompts.push(p), "feat: x")
    await ship(io, false, "commits")
    const flat = prompts.map((p) => p.replace(/\s+/g, " "))
    expect(flat.length).toBeGreaterThan(1)
    for (const p of flat) expect(p).toContain("never from a slice's or branch's name")
    const title = flat.filter((p) => p.startsWith("Write the title and description"))
    expect(title).toHaveLength(1)
    expect(title[0]).toContain("its '!' when any commit carries a BREAKING CHANGE footer")
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

  test("only a group that absorbed the trailing slice is told it is the last commit", async () => {
    const prompts: string[] = []
    const { io } = repo(
      { ...base, [`git diff --quiet ${B} ${C} -- :(exclude).gtd/`]: { code: 0 } },
      ["feat: refactor\n\nwhy", "feat: add x\n\nbody"],
    )
    const complete = io.complete
    io.complete = async (p) => (prompts.push(p), complete(p))
    await ship(io, false, "stack")
    expect(prompts[0]).toContain("THIS IS THE PROCESS'S LAST COMMIT")
    const plain = repo(base, ["feat: a", "feat: b", "feat: add x\n\nl", "feat: add x\n\nu"])
    const seen: string[] = []
    const inner = plain.io.complete
    plain.io.complete = async (p) => (seen.push(p), inner(p))
    await ship(plain.io, false, "commits")
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.slice(0, 2).some((p) => p.includes("LAST COMMIT"))).toBe(false)
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
  const TOP = "branch.feat/x.gtdStackTop"
  const RETIRED = "branch.feat/x.gtdStackRetired"
  const view = (b: string) =>
    `gh pr view ${b} --json number,title,body,url,state,baseRefName,mergedAt`
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
  const onOrigin = (b: string) => ({
    [`git ls-remote origin refs/heads/${b}`]: { out: `${C1}\trefs/heads/${b}\n` },
  })
  // a closed PR whose branch origin still has: not abandoned
  const kept = (b: string, n: number) => ({
    ...onOrigin(b),
    [view(b)]: pr(n, { state: "CLOSED" }),
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
    [view("feat/x-refactor")]: noPr("feat/x-refactor"),
    [view("feat/x")]: noPr("feat/x"),
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

  test("only the top pull request carries the issues the stack's commits close", async () => {
    const { io, calls } = repo(
      {
        ...sbase,
        [`git log --no-merges --format=%B%n--- ${M}..${C2}`]: {
          out: "refactor: x\n\nCloses #9\n---\nfeat: y\n\nCloses #384\n---\n",
        },
        [`git log --no-merges --reverse --format=%H%n%B%n--- ${M}..${C1}`]: {
          out: "refactor: x\n\nCloses #9\n---\n",
        },
        [`git log --no-merges --reverse --format=%H%n%B%n--- ${C1}..${C2}`]: {
          out: "feat: y\n\nCloses #384\n---\n",
        },
      },
      writers(),
    )
    await ship(io, false)
    const lower = calls.find((c) => c.argv === create("feat/x-refactor", "main"))
    const upper = calls.find((c) => c.argv === create("feat/x", "feat/x-refactor"))
    expect(lower?.stdin).toBe("lower\n")
    expect(upper?.stdin).toBe(
      "Stacked on #7 — merge that first\n\nupper\n\nCloses #9\nCloses #384\n",
    )
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
          ...onOrigin("feat/x-refactor"),
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

  test("a closed slice PR whose branch origin no longer has is ignored: a new PR opens", async () => {
    const { io, ran } = repo(
      {
        ...sbase,
        [view("feat/x-refactor")]: pr(5, { state: "CLOSED" }),
        [view("feat/x")]: pr(6, { state: "CLOSED", baseRefName: "feat/x-refactor" }),
        "git ls-remote origin refs/heads/feat/x-refactor": { out: "" },
        "git ls-remote origin refs/heads/feat/x": { out: "" },
        "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
      },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain("git push --set-upstream origin feat/x")
    expect(ran()).toContain("git config --local branch.feat/x-refactor.gtdAbandonedPr 5")
    expect(ran()).toContain(create("feat/x-refactor", "main"))
    expect(ran()).toContain(create("feat/x", "feat/x-refactor"))
    expect(ran().some((c) => /^gh pr edit [56] /.test(c))).toBe(false)
  })

  test("a closed slice PR refuses when ls-remote cannot tell whether its branch is gone", async () => {
    const { io, ran } = repo(
      {
        ...sbase,
        [view("feat/x-refactor")]: pr(5, { state: "CLOSED" }),
        "git ls-remote origin refs/heads/feat/x-refactor": { code: 128, err: "offline" },
      },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false, text: expect.stringContaining("#5") })
    expect(ran().some((c) => mutating.test(c))).toBe(false)
  })

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

  describe("the base ref after a restack left the local default branch stale", () => {
    const MO = "5".repeat(40)
    // local main diverged from origin/main; the branch sits on origin/main
    const stale: Record<string, Scripted> = {
      ...sbase,
      "git merge-base origin/main HEAD": { out: MO },
      [`git merge-base --is-ancestor ${MO} main`]: { code: 1 },
      [`git log --no-merges --reverse --format=%H%n%B%n--- ${MO}..${C1}`]: { out: "LOG-ONE-O" },
    }
    const ranges = (ran: () => string[]) =>
      ran().filter((c) => /^git (log --no-merges|diff --stat) /.test(c))

    test("a stack's first writer prompt describes the commits above the origin/main merge base", async () => {
      const prompts: string[] = []
      const { io, ran } = repo(stale, writers())
      const complete = io.complete
      io.complete = async (p) => (prompts.push(p), complete(p))
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(prompts[2]).toContain("LOG-ONE-O")
      expect(ranges(ran)).toContain(`git diff --stat ${MO}..${C1}`)
      expect(ran()).not.toContain(`git log --no-merges --reverse --format=%H%n%B%n--- ${M}..${C1}`)
    })
  })

  describe("a fresh multi-slice ship over a live recorded stack", () => {
    const live = {
      ...sbase,
      [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
      "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
    }
    const withEntry = {
      ...live,
      "gtd history list --json": { out: JSON.stringify([entry(ENTRY, C)]) },
    }
    const expectRefused = (out: Shipped, ran: () => string[]) => {
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("GTD_SHIP_MODE=commits")
      expect(out.text).toContain("git config --local --unset branch.feat/x.gtdStack")
      expect(out.text).toContain("branch.feat/x.gtdStackTop")
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    }

    test("refuses before any write, naming the way out", async () => {
      const { io, ran } = repo(withEntry, writers())
      expectRefused(await ship(io, false), ran)
    })

    test("refuses the same way as a dry run", async () => {
      const { io, ran } = repo(withEntry, writers())
      expectRefused(await ship(io, true), ran)
    })

    test("a record that no longer chains to HEAD is dead: a fresh stack ships over it", async () => {
      const { io } = repo(
        {
          ...live,
          [`git merge-base --is-ancestor ${C1} HEAD`]: { code: 1 },
          "git rev-parse --verify --quiet origin/feat/x-refactor": { out: C1 },
        },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
    })

    test("a dead record with a closed slice PR is dropped, not refused", async () => {
      const { io } = repo(
        {
          ...sbase,
          [`git config --local --get ${KEY}`]: { out: "old feature\n" },
          "git rev-parse --verify --quiet refs/heads/feat/x-old": { out: C1 },
          [`git merge-base --is-ancestor ${C1} HEAD`]: { code: 1 },
          [view("feat/x-old")]: pr(4, { state: "CLOSED" }),
        },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
    })

    test("a dead record with a missing slice branch and a rebased-away top is dropped", async () => {
      const { io } = repo(
        {
          ...sbase,
          [`git config --local --get ${KEY}`]: { out: "old feature\n" },
          "git rev-parse --verify --quiet refs/heads/feat/x-old": { code: 1 },
          [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
          [`git merge-base --is-ancestor ${C2} HEAD`]: { code: 1 },
        },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
    })

    test("a live record with a closed slice PR still refuses", async () => {
      const { io, ran } = repo({ ...withEntry, ...kept("feat/x-refactor", 5) }, writers())
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("#5") })
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    })

    test("following the remedy, the old slice branch is a collision to rename", async () => {
      const { io, ran } = repo(
        { ...sbase, "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 } },
        writers(),
      )
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("feat/x-refactor")
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    })

    test("a retired record alone never refuses", async () => {
      const { io } = repo(
        { ...sbase, [`git config --local --get ${RETIRED}`]: { out: "refactor feature\n" } },
        writers(),
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
    })

    test("commits mode still ships one PR", async () => {
      const { io, ran } = repo(
        { ...live, [create("feat/x", "main")]: { out: "https://github.com/o/r/pull/7\n" } },
        ["feat: refactor", "feat: feature", "feat: add x\n\nbody"],
      )
      expect(await ship(io, false, "commits")).toMatchObject({ ok: true })
      expect(ran()).toContain(create("feat/x", "main"))
    })
  })

  describe("a failing gh pr view is a refusal, not an absent PR", () => {
    const denied = { code: 1, err: "HTTP 401: Bad credentials\n" }
    const noWrites = (ran: () => string[]) =>
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    const withEntry = {
      ...sbase,
      "gtd history list --json": { out: JSON.stringify([entry(ENTRY, C)]) },
      [view("feat/x-refactor")]: denied,
    }

    test("single branch, no process: refuses naming branch and stderr, writes nothing", async () => {
      const { io, ran } = repo({ ...feature, "gtd summary": { code: 1 }, [view("feat/x")]: denied })
      const out = await ship(io, false, "commits")
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("feat/x")
      expect(out.text).toContain("HTTP 401: Bad credentials")
      noWrites(ran)
    })

    test("fresh two-slice stack refuses before any write", async () => {
      const { io, ran } = repo(withEntry, writers())
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("feat/x-refactor")
      expect(out.text).toContain("HTTP 401: Bad credentials")
      noWrites(ran)
    })

    test("the same stack as a dry run refuses the same way", async () => {
      const { io, ran } = repo(withEntry, writers())
      const out = await ship(io, true)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("HTTP 401: Bad credentials")
      noWrites(ran)
    })

    test("a resumed recorded stack refuses before any write", async () => {
      const { io, ran } = repo({ ...resume, [view("feat/x-refactor")]: denied })
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("HTTP 401: Bad credentials")
      noWrites(ran)
      expect(ran().some((c) => c.includes("--unset"))).toBe(false)
    })

    test("a single-slice process: the squash stays, nothing is pushed or opened", async () => {
      const { io, ran } = repo({ ...feature, [view("feat/x")]: denied }, ["feat: add x\n\nwhy"])
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("feat/x")
      expect(out.text).toContain("HTTP 401: Bad credentials")
      expect(ran()).toContain(`git reset --soft ${BASE}`)
      expect(ran().some((c) => /^git push|^gh pr (create|edit)/.test(c))).toBe(false)
    })

    test("an upper slice failing after the lower landed never pushes the upper", async () => {
      const { io, ran } = repo(
        { ...sbase, [view("feat/x-refactor")]: noPr("feat/x-refactor") },
        writers(),
      )
      let upperViews = 0
      const run = io.run
      io.run = async (argv, stdin) =>
        argv.join(" ") === view("feat/x") && ++upperViews > 1
          ? { code: 1, out: "", err: "boom" }
          : run(argv, stdin)
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("pull request")
      expect(out.text).toContain("Landed: refactor")
      expect(ran()).not.toContain("git push --set-upstream origin feat/x")
    })

    test("each slice's gh pr view precedes that slice's push", async () => {
      const { io, ran } = repo(sbase, writers())
      expect(await ship(io, false)).toMatchObject({ ok: true })
      const last = (c: string) => ran().lastIndexOf(c)
      expect(last(view("feat/x-refactor"))).toBeLessThan(
        ran().indexOf("git push --set-upstream origin feat/x-refactor"),
      )
      expect(last(view("feat/x"))).toBeLessThan(
        ran().indexOf("git push --set-upstream origin feat/x"),
      )
    })

    test("a dry run whose preview read fails never prints would open", async () => {
      const { io } = repo(sbase, writers())
      let upperViews = 0
      const run = io.run
      io.run = async (argv, stdin) =>
        argv.join(" ") === view("feat/x") && ++upperViews > 1
          ? { code: 1, out: "", err: "boom" }
          : run(argv, stdin)
      const out = await ship(io, true)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("boom")
      expect(out.text).not.toContain("would open")
    })
  })

  describe("the since-head range floors at the merge base", () => {
    const S = "7".repeat(40)
    const single = (extra: Record<string, Scripted>): Record<string, Scripted> => ({
      ...feature,
      "gtd summary": { code: 1 },
      [view("feat/x")]: pr(8, { body: "standing" }),
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
      await ship(io, false, "commits")
      expect(counts(ran)).toEqual([`git rev-list --count ${S}..HEAD ^${M}`])
    })

    test("a synced head between the merge base and HEAD is the range start", async () => {
      const { io, ran } = repo(single({}), ["NO-UPDATE"])
      await ship(io, false, "commits")
      expect(counts(ran)).toEqual([`git rev-list --count ${S}..HEAD ^${M}`])
    })

    test.each([
      ["missing", { [`git rev-parse --verify --quiet ${S}^{commit}`]: { code: 1 } }],
      ["not an ancestor of HEAD", { [`git merge-base --is-ancestor ${S} HEAD`]: { code: 1 } }],
    ])("a synced head that is %s falls back to the merge base", async (_, extra) => {
      const { io, ran } = repo(single(extra), ["NO-UPDATE"])
      await ship(io, false, "commits")
      expect(counts(ran)).toEqual([`git rev-list --count ${M}..HEAD ^${M}`])
    })

    test("a stacked upper slice whose synced head is below the lower commit is floored at it", async () => {
      const { io, ran } = repo(
        {
          ...sbase,
          "gtd summary": { code: 1 },
          "git rev-parse HEAD": { out: C2 },
          [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
          "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
          "git rev-parse --verify --quiet origin/feat/x-refactor": { out: C1 },
          [view("feat/x-refactor")]: pr(7, { body: "lower" }),
          [view("feat/x")]: pr(8, { baseRefName: "feat/x-refactor" }),
          "git config --local --get branch.feat/x-refactor.prSyncHead": { out: C1 },
          "git config --local --get branch.feat/x.prSyncHead": { out: S + "\n" },
          [`git rev-list --count ${S}..${C2}`]: { out: "1" },
        },
        ["NO-UPDATE"],
      )
      await ship(io, false)
      expect(counts(ran)).toContain(`git rev-list --count ${S}..${C2} ^${C1}`)
    })
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

  test("a failed git branch -f leaves a record that a second run rebuilds from the recorded top", async () => {
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
        [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
        [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
        "git rev-parse --verify --quiet origin/feat/x-refactor": { code: 1 },
        [view("feat/x-refactor")]: noPr("feat/x-refactor"),
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
    expect(ran()).toContain(`git config --local --unset ${TOP}`)
    expect(ran().some((c) => /^git (branch|push)|^gh pr (create|edit)/.test(c))).toBe(false)
  })

  test("a merged lower slice drops out of a resumed stack before any push", async () => {
    const { io, ran } = repo(
      {
        ...resume,
        [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
        [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
        [view("feat/x-refactor")]: pr(7, { state: "MERGED" }),
      },
      ["feat: add x\n\nupper"],
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(pushes(ran)).toEqual(["git push --set-upstream origin feat/x"])
    expect(ran()).toContain(create("feat/x", "main"))
    expect(ran()).toContain(`git log --no-merges --reverse --format=%H%n%B%n--- ${C1}..${C2}`)
  })

  test("a closed lower slice refuses a resume before any push and names commits mode", async () => {
    const { io, ran } = repo({ ...resume, ...kept("feat/x-refactor", 7) })
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("GTD_SHIP_MODE=commits")
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

  test.each(["MERGED", "CLOSED"])(
    "a %s top PR refuses without pointing at commits mode, which ships to it too",
    async (state) => {
      const { io, ran } = repo(
        { ...sbase, ...onOrigin("feat/x"), [view("feat/x")]: pr(8, { state }) },
        writers(),
      )
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("#8") })
      expect(out.text).toContain("Rename the branch")
      expect(out.text).not.toContain("GTD_SHIP_MODE=commits")
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    },
  )

  const reshipped = (count: string, body: string): Record<string, Scripted> => ({
    ...feature,
    [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
    "gtd summary": { code: 1 },
    "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": pr(8, {
      baseRefName: "feat/x-refactor",
      body,
    }),
    [`git rev-list --count ${M}..HEAD`]: { out: count },
  })

  test("a stacked PR shipped as a single branch is retargeted and loses its stack line", async () => {
    const { io, ran, calls } = repo(
      reshipped("2", "Stacked on #7 — merge that first\n\nstanding"),
      ["NO-UPDATE"],
    )
    expect(await ship(io, false, "commits")).toMatchObject({ ok: true })
    expect(ran()).toContain("gh pr edit 8 --base main")
    expect(calls.find((c) => c.argv === "gh pr edit 8 --body-file -")?.stdin).toBe("standing")
  })

  test("taking a PR off a stack with nothing new still succeeds", async () => {
    const { io, ran } = repo(reshipped("0", "standing"))
    expect(await ship(io, false, "commits")).toMatchObject({ ok: true })
    expect(ran()).toContain("gh pr edit 8 --base main")
    expect(ran().some((c) => c.startsWith("gh pr edit 8 --body-file"))).toBe(false)
  })

  test("a failed retarget of a once-stacked PR fails before its body is edited", async () => {
    const { io, ran } = repo({
      ...reshipped("2", "Stacked on #7 — merge that first\n\nstanding"),
      "gh pr edit 8 --base main": { code: 1, err: "nope" },
    })
    expect(await ship(io, false, "commits")).toMatchObject({ ok: false })
    expect(ran().some((c) => c.startsWith("gh pr edit 8 --body-file"))).toBe(false)
  })

  test.each([
    ["release/1", "refactor feature\n"],
    ["feat/x-refactor", ""],
  ])("a non-slice base %s is left alone: no retarget, no strip", async (base, record) => {
    const { io, ran } = repo(
      {
        ...reshipped("2", "Stacked on #7 — merge that first\n\nstanding"),
        [`git config --local --get ${KEY}`]: { out: record },
        "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": pr(8, {
          baseRefName: base,
          body: "Stacked on #7 — merge that first\n\nstanding",
        }),
      },
      ["NO-UPDATE"],
    )
    expect(await ship(io, false, "commits")).toMatchObject({ ok: true })
    expect(ran().some((c) => c.startsWith("gh pr edit 8 --base"))).toBe(false)
    expect(ran().some((c) => c.startsWith("gh pr edit 8 --body-file"))).toBe(false)
  })

  test("a PR GitHub already moved to the default branch loses its stale stack line", async () => {
    const { io, ran } = repo(
      {
        ...reshipped("0", "Stacked on #7 — merge that first\n\nstanding"),
        "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": pr(8, {
          baseRefName: "main",
          body: "Stacked on #7 — merge that first\n\nstanding",
        }),
      },
      ["NO-UPDATE"],
    )
    expect(await ship(io, false, "commits")).toMatchObject({ ok: true })
    expect(ran().some((c) => c.startsWith("gh pr edit 8 --base"))).toBe(false)
    expect(ran()).toContain("gh pr edit 8 --body-file -")
  })

  test("the record is unset only after the retarget, both keys", async () => {
    const { io, ran } = repo(reshipped("0", "standing"))
    await ship(io, false, "commits")
    const at = (c: string) => ran().indexOf(c)
    expect(at("gh pr edit 8 --base main")).toBeGreaterThan(-1)
    expect(at(`git config --local --unset ${RETIRED}`)).toBeGreaterThan(
      at("gh pr edit 8 --base main"),
    )
  })

  test("a failed retarget keeps the record", async () => {
    const { io, ran } = repo({
      ...reshipped("2", "standing"),
      "gh pr edit 8 --base main": { code: 1, err: "nope" },
    })
    expect(await ship(io, false, "commits")).toMatchObject({ ok: false })
    expect(ran().some((c) => c === `git config --local --unset ${RETIRED}`)).toBe(false)
  })

  test("single-slice commits-mode ship defers the unset until after the retarget", async () => {
    const { io, ran } = repo(
      {
        ...reshipped("2", "standing"),
        "gtd summary": { out: "Describe." },
      },
      ["feat: add x\n\nwhy", "NO-UPDATE"],
    )
    await ship(io, false, "commits")
    const at = (c: string) => ran().indexOf(c)
    expect(at("gh pr edit 8 --base main")).toBeGreaterThan(-1)
    expect(at(`git config --local --unset ${RETIRED}`)).toBeGreaterThan(
      at("gh pr edit 8 --base main"),
    )
  })

  test("no-process commits ship unsets the record, never on a dry run", async () => {
    const real = repo(reshipped("2", "standing"), ["NO-UPDATE"])
    await ship(real.io, false, "commits")
    expect(real.ran()).toContain(`git config --local --unset ${KEY}`)
    const dry = repo(reshipped("2", "standing"), ["NO-UPDATE"])
    await ship(dry.io, true, "commits")
    expect(dry.ran().some((c) => c.startsWith("git config --local --unset"))).toBe(false)
  })

  test("a thrown draft on the wrong base is retargeted before it is marked ready", async () => {
    const { io, ran } = repo(
      { ...sbase, [view("feat/x")]: pr(9, { baseRefName: "main", body: `${THROWN}\nwaiting` }) },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    const at = (c: string) => ran().indexOf(c)
    expect(at("gh pr edit 9 --base feat/x-refactor")).toBeGreaterThan(-1)
    expect(at("gh pr edit 9 --base feat/x-refactor")).toBeLessThan(at("gh pr ready 9"))
  })

  test("a failed retarget of a thrown draft stops at retarget, nothing rewritten", async () => {
    const { io, ran } = repo(
      {
        ...sbase,
        [view("feat/x")]: pr(9, { baseRefName: "main", body: `${THROWN}\nwaiting` }),
        "gh pr edit 9 --base feat/x-refactor": { code: 1, err: "nope" },
      },
      writers(),
    )
    const out = await ship(io, false)
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toContain("retarget")
    expect(ran().some((c) => c === "gh pr ready 9" || c.startsWith("gh pr edit 9 --title"))).toBe(
      false,
    )
  })

  test("a fresh stack records both keys, then branches", async () => {
    const { io, ran } = repo(sbase, writers())
    await ship(io, false)
    expect(ran()).toContain(`git config --local ${TOP} ${C2}`)
    expect(ran()).toContain(`git config --local ${KEY} refactor feature`)
    expect(ran()).toContain(`git branch -f feat/x-refactor ${C1}`)
  })

  test("a failed top write undoes the squash with no branch, push or gh call", async () => {
    const { io, ran } = repo(
      { ...sbase, [`git config --local ${TOP} ${C2}`]: { code: 1, err: "locked" } },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: false })
    expect(ran()).toContain("git reset --soft ORIG_HEAD")
    expect(ran().some((c) => /^git (branch|push)|^gh pr (create|edit)/.test(c))).toBe(false)
  })

  test("a retry after a failed single-squash PR step does not resume the dropped stack", async () => {
    const first = repo(
      {
        ...reshipped("2", "Stacked on #7 — merge that first\n\nstanding"),
        "gtd summary": { out: "Describe." },
        "gh pr edit 8 --body-file -": { code: 1, err: "nope" },
      },
      ["feat: add x\n\nwhy", "NO-UPDATE"],
    )
    expect(await ship(first.io, false, "commits")).toMatchObject({ ok: false })
    expect(first.ran()).toContain(`git config --local ${RETIRED} refactor feature`)
    expect(first.ran().some((c) => c === `git config --local --unset ${RETIRED}`)).toBe(false)
    const second = repo(
      {
        ...resume,
        "gtd summary": { code: 1 },
        [`git config --local --get ${KEY}`]: { out: "" },
        [`git config --local --get ${RETIRED}`]: { out: "refactor feature\n" },
        [`git config --local --get ${TOP}`]: { out: "" },
        [view("feat/x")]: pr(8, { baseRefName: "main", body: "standing" }),
        [`git rev-list --count ${M}..HEAD`]: { out: "2" },
      },
      ["feat: add x\n\nwhy", "NO-UPDATE"],
    )
    await ship(second.io, false)
    expect(second.ran().some((c) => c === "gh pr edit 8 --base feat/x-refactor")).toBe(false)
    expect(second.ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
    expect(second.ran()).toContain(`git config --local --unset ${RETIRED}`)
  })

  test("a fresh stack shipped over a leftover retired record keeps its own record", async () => {
    const { io, ran } = repo(
      { ...sbase, [`git config --local --get ${RETIRED}`]: { out: "old other\n" } },
      writers(),
    )
    expect(await ship(io, false)).toMatchObject({ ok: true })
    expect(ran()).toContain(`git config --local --unset ${RETIRED}`)
    expect(ran()).not.toContain(`git config --local --unset ${KEY}`)
    expect(ran()).not.toContain(`git config --local --unset ${TOP}`)
  })

  describe("a missing slice branch on resume", () => {
    const gone = {
      ...resume,
      "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { code: 1 },
      [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
    }
    const refused = (ran: () => string[]) =>
      ran().some((c) => /^git (branch|push)|^gh pr (create|edit)|--unset/.test(c))

    test.each([
      [
        "HEAD no longer contains the top",
        {
          [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
          [`git merge-base --is-ancestor ${C2} HEAD`]: { code: 1 },
        },
      ],
      ["no top recorded", {}],
    ])("%s: refuses naming the branch and commits mode", async (_n, extra) => {
      const { io, ran } = repo({ ...gone, ...extra })
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("feat/x-refactor")
      expect(out.text).toContain("GTD_SHIP_MODE=commits")
      expect(refused(ran)).toBe(false)
    })

    test("a dry run refuses with the same text", async () => {
      const wet = await ship(repo(gone).io, false)
      const dry = repo(gone)
      expect(await ship(dry.io, true)).toEqual(wet)
    })

    test("a dry run at the recorded top never runs git branch -f", async () => {
      const { io, ran } = repo(
        { ...gone, [`git config --local --get ${TOP}`]: { out: C2 + "\n" } },
        ["feat: add x\n\nbody"],
      )
      await ship(io, true)
      expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
    })

    test("every branch present and HEAD moved: the chain check decides", async () => {
      const { io, ran } = repo(
        {
          ...resume,
          [`git config --local --get ${TOP}`]: { out: "9".repeat(40) + "\n" },
          [`git merge-base --is-ancestor ${C1} HEAD`]: { code: 1 },
        },
        ["feat: add x\n\nbody"],
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran()).toContain(create("feat/x", "main"))
    })
  })

  const X = "5".repeat(40)
  const lowerGone = {
    ...resume,
    "git rev-parse HEAD": { out: X },
    "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { code: 1 },
    [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
    [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
    "git rev-parse --verify --quiet HEAD~1": { out: "9".repeat(40) },
  }

  describe("a recorded stack resumed by a one-slice ship", () => {
    const reship: Record<string, Scripted> = {
      ...feature,
      [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
      [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
      "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
      "git rev-parse refs/heads/feat/x-refactor": { out: C1 },
      [view("feat/x-refactor")]: pr(7, { body: "lower" }),
      [view("feat/x")]: pr(8, { baseRefName: "feat/x-refactor" }),
    }
    const topWrites = (ran: () => string[]) =>
      ran().filter(
        (c) => c.startsWith("git config --local") && !c.includes("--get") && c.includes(TOP),
      )

    test("the squash lands on the top branch and the stack is kept untouched", async () => {
      const { io, ran } = repo(reship, ["feat: add x\n\nwhy"])
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran()).toContain(`git reset --soft ${BASE}`)
      expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
      expect(ran().some((c) => c.startsWith("gh pr edit 8 --base"))).toBe(false)
      expect(ran().some((c) => c.includes("--unset"))).toBe(false)
      expect(topWrites(ran)).toEqual([])
      expect(ran()).toContain("git push --set-upstream origin feat/x")
    })

    test("a lower branch deleted before a one-slice re-ship is revived after the squash at <top>~n", async () => {
      const { io, ran } = repo(
        {
          ...reship,
          "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { code: 1 },
          [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
        },
        ["feat: add x\n\nwhy"],
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      const at = (c: string) => ran().indexOf(c)
      expect(at(`git reset --soft ${BASE}`)).toBeGreaterThan(-1)
      expect(at(`git branch -f feat/x-refactor ${C1}`)).toBeGreaterThan(
        at(`git reset --soft ${BASE}`),
      )
    })

    test("a record that no longer chains retires, ships one PR to the default branch and forgets after it", async () => {
      const { io, ran } = repo(
        {
          ...reship,
          [`git merge-base --is-ancestor ${C1} ${BASE}`]: { code: 1 },
          [`git rev-list --count ${M}..HEAD`]: { out: "2" },
        },
        ["feat: add x\n\nwhy", "NO-UPDATE"],
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      const at = (c: string) => ran().indexOf(c)
      expect(at(`git config --local ${RETIRED} refactor feature`)).toBeGreaterThan(-1)
      expect(at("gh pr edit 8 --base main")).toBeGreaterThan(-1)
      expect(at(`git config --local --unset ${RETIRED}`)).toBeGreaterThan(
        at("gh pr edit 8 --base main"),
      )
      expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
    })

    test("commits mode never resumes: one commit, retarget, record forgotten", async () => {
      const { io, ran } = repo({ ...reship, [`git rev-list --count ${M}..HEAD`]: { out: "2" } }, [
        "feat: add x\n\nwhy",
        "NO-UPDATE",
      ])
      expect(await ship(io, false, "commits")).toMatchObject({ ok: true })
      expect(ran()).toContain("gh pr edit 8 --base main")
      expect(ran()).toContain(`git config --local --unset ${KEY}`)
      expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
    })

    test("a dry run lists every remaining slice, the message only under the top, and writes nothing", async () => {
      const { io, ran } = repo(reship, ["feat: add x\n\nTHE-MESSAGE"])
      const out = await ship(io, true)
      expect(out.ok).toBe(true)
      const [lower, upper] = out.text.split("\n\n---\n\n")
      expect(lower).toContain("[refactor]")
      expect(lower).not.toContain("Commit message")
      expect(upper).toContain("[feature]")
      expect(upper).toContain("THE-MESSAGE")
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    })

    test("a closed lower PR refuses before the history push, naming commits mode", async () => {
      const { io, ran } = repo({
        ...reship,
        ...withHistory,
        ...kept("feat/x-refactor", 7),
        [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
      })
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false })
      expect(out.text).toContain("GTD_SHIP_MODE=commits")
      expect(ran().some((c) => /^git (push|reset|commit)|^gh pr (create|edit)/.test(c))).toBe(false)
    })
  })

  describe("resuming reads pull request states first", () => {
    const merged = {
      ...resume,
      "git rev-parse HEAD": { out: X },
      [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
      [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
      [view("feat/x-refactor")]: pr(7, { state: "MERGED" }),
    }

    test("a merged bottom slice with its branch gone and HEAD past the top needs no revive", async () => {
      const { io, ran } = repo(
        {
          ...merged,
          "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { code: 1 },
        },
        ["feat: add x\n\nupper"],
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
      expect(ran()).toContain(create("feat/x", "main"))
      expect(ran()).toContain(`git log --no-merges --reverse --format=%H%n%B%n--- ${C1}..${X}`)
    })

    test("every lower slice merged retargets the top PR to the default branch without dropping the stack", async () => {
      const { io, ran } = repo(
        {
          ...merged,
          [view("feat/x")]: pr(8, { baseRefName: "feat/x-refactor" }),
          [`git rev-list --count ${C1}..${X}`]: { out: "0" },
        },
        [],
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran()).toContain("gh pr edit 8 --base main")
      expect(ran().some((c) => c.includes("--unset"))).toBe(false)
    })

    test("a merged slice's commit is found off the recorded top, never its local ref", async () => {
      const { io, ran } = repo(
        {
          ...merged,
          "git rev-parse refs/heads/feat/x-refactor": { out: "9".repeat(40) },
          "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: "9".repeat(40) },
        },
        ["feat: add x\n\nupper"],
      )
      await ship(io, false)
      expect(ran()).toContain(`git log --no-merges --reverse --format=%H%n%B%n--- ${C1}..${X}`)
    })

    test("a rebase that dropped the top leaves a merged floor unreadable: the branch ships alone", async () => {
      const { io, ran } = repo(
        { ...merged, [`git merge-base --is-ancestor ${C2} HEAD`]: { code: 1 } },
        ["feat: add x\n\nupper"],
      )
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran().some((c) => c.startsWith("git branch -f"))).toBe(false)
      expect(ran()).toContain(create("feat/x", "main"))
    })

    test("a merged floor that cannot be read refuses with nothing changed", async () => {
      const { io, ran } = repo({
        ...merged,
        [`git rev-parse --verify --quiet ${C2}~1`]: { code: 1 },
      })
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("cannot be found") })
      expect(ran().some((c) => mutating.test(c))).toBe(false)
    })

    test("a top that is an ancestor of a later HEAD rebuilds from the top, not HEAD", async () => {
      const { io, ran } = repo(lowerGone, ["feat: add x\n\nlower", "feat: add x\n\nupper"])
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran()).toContain(`git branch -f feat/x-refactor ${C1}`)
      expect(ran().some((c) => c.includes("HEAD~"))).toBe(false)
    })
  })

  describe("a pull request read that is not JSON", () => {
    const garbled = {
      ...feature,
      "gh pr view feat/x --json number,title,body,url,state,baseRefName,mergedAt": {
        out: "not json",
      },
    }

    test("a real single-branch ship names the branch, pushes nothing and edits nothing", async () => {
      const { io, ran } = repo(garbled, ["feat: add x\n\nwhy"])
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("feat/x") })
      expect(ran().some((c) => /^git push|^gh pr (create|edit)/.test(c))).toBe(false)
    })

    test("a dry run names the branch and pushes nothing", async () => {
      const { io, ran } = repo(garbled, ["feat: add x\n\nwhy"])
      const out = await ship(io, true)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("feat/x") })
      expect(ran().some((c) => c.startsWith("git push"))).toBe(false)
    })
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

  describe("a lower slice merged by squash: re-ship restacks", () => {
    const S1 = "1".repeat(40)
    const S2 = "2".repeat(40)
    const S3 = "3".repeat(40)
    const N1 = "4".repeat(40)
    const O = "9".repeat(40)
    const O2 = "8".repeat(40)
    const REBASE = `git rebase --update-refs --onto origin/main ${C1} feat/x`
    const REBASE3 = `git rebase --update-refs --onto origin/main ${S1} feat/x`
    const FETCH = "git fetch origin +refs/heads/main:refs/remotes/origin/main"
    const GITPATH = "git rev-parse --git-path rebase-merge"
    const lsTop = `git ls-remote origin refs/heads/feat/x`
    const WT = "git worktree list --porcelain"
    const here = { out: "worktree /repo\nHEAD abc\nbranch refs/heads/feat/x\n" }
    const ls3 = `git ls-remote origin refs/heads/feat/x-middle refs/heads/feat/x`
    const writes =
      /^git (push|rebase|reset|commit|branch)|^git config --local (?!--get)|^gh pr (create|edit)/
    const two: Record<string, Scripted> = {
      ...resume,
      [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
      [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
      [view("feat/x-refactor")]: pr(7, { state: "MERGED" }),
      [view("feat/x")]: pr(8, { baseRefName: "feat/x-refactor" }),
      [`git merge-base --is-ancestor ${C1} origin/main`]: { code: 1 },
      [lsTop]: { out: `${O}\trefs/heads/feat/x\n` },
      "git rev-list --count origin/main..HEAD": { out: "1" },
      "git merge-base origin/main refs/heads/feat/x": { out: M },
      "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
      [WT]: here,
    }
    const three: Record<string, Scripted> = {
      ...resume,
      "git rev-parse HEAD": { out: S3 },
      [`git config --local --get ${KEY}`]: { out: "refactor middle feature\n" },
      [`git config --local --get ${TOP}`]: { out: S3 + "\n" },
      "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: S1 },
      "git rev-parse --verify --quiet refs/heads/feat/x-middle": { out: S2 },
      "git rev-parse refs/heads/feat/x-middle": { out: S2 },
      [`git rev-parse --verify --quiet ${S3}~2`]: { out: S1 },
      [view("feat/x-refactor")]: pr(7, { state: "MERGED" }),
      [view("feat/x-middle")]: pr(8, { baseRefName: "feat/x-refactor" }),
      [view("feat/x")]: pr(9, { baseRefName: "feat/x-middle" }),
      [`git merge-base --is-ancestor ${S1} origin/main`]: { code: 1 },
      [ls3]: { out: `${O2}\trefs/heads/feat/x-middle\n${O}\trefs/heads/feat/x\n` },
      [`git rev-list --reverse refs/heads/feat/x-middle..refs/heads/feat/x`]: { out: `${N1}\n` },
      "git rev-list --count refs/heads/feat/x-middle..HEAD": { out: "1" },
      "git merge-base origin/main refs/heads/feat/x-middle": { out: M },
      "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
      "git rev-parse --verify --quiet origin/feat/x-middle": { code: 0 },
      [`git merge-base --is-ancestor ${S1} refs/heads/feat/x-middle`]: { code: 1 },
      "git rev-parse refs/heads/feat/x-middle~1": { out: BASE },
      "git rev-parse origin/main": { out: BASE },
      [WT]: here,
    }
    const at = (ran: () => string[], c: string) => ran().indexOf(c)

    // a tag named like a slice branch wins over the branch for a bare name
    const bareSlice = (ran: () => string[]) =>
      ran().filter(
        (c) =>
          /^git (rev-parse|rev-list|merge-base|log|cat-file) /.test(c) &&
          c
            .split(" ")
            .flatMap((t) => t.split(".."))
            .map((t) => t.replace(/^\^/, "").replace(/~\d+$/, ""))
            .some((t) => ["feat/x", "feat/x-middle", "feat/x-refactor"].includes(t)),
      )

    test("fetches, reads, rebases once, pushes with the lease, retargets, ends the stack", async () => {
      const { io, ran } = repo(two)
      expect(await ship(io, false)).toMatchObject({ ok: true })
      const order = [
        FETCH,
        `git merge-base --is-ancestor ${C1} origin/main`,
        lsTop,
        `git cat-file -e ${O}`,
        REBASE,
        `git push --force-with-lease=feat/x:${O} origin feat/x`,
        "gh pr edit 8 --base main",
      ].map((c) => at(ran, c))
      expect(order.every((i) => i >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(ran().filter((c) => c.startsWith("git rebase"))).toEqual([REBASE])
      expect(ran()).not.toContain("git fetch origin main")
      expect(ran().lastIndexOf(`git config --local --unset ${KEY}`)).toBeGreaterThan(
        at(ran, "gh pr edit 8 --base main"),
      )
    })

    test("never moves, pushes or deletes the merged slice's branch, nor the local default branch", async () => {
      const { io, ran } = repo(two)
      await ship(io, false)
      expect(ran().some((c) => /^git branch|--delete|-D /.test(c))).toBe(false)
      expect(ran().some((c) => c.startsWith("git push") && c.includes("feat/x-refactor"))).toBe(
        false,
      )
      expect(ran().some((c) => /^git (checkout|switch|merge|reset|update-ref) /.test(c))).toBe(
        false,
      )
    })

    test("a stack of three restacks without resolving a slice branch by its bare name", async () => {
      const { io, ran } = repo(three)
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran().filter((c) => c.startsWith("git rebase"))).toEqual([REBASE3])
      expect(bareSlice(ran)).toEqual([])
    })

    test("a stack of three: one rebase moves the middle branch; the record shrinks; only the lowest PR is retargeted", async () => {
      const { io, ran } = repo(three)
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran().filter((c) => c.startsWith("git rebase"))).toEqual([REBASE3])
      expect(ran()).toContain(
        `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`,
      )
      expect(ran()).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
      expect(
        at(ran, `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`),
      ).toBeLessThan(at(ran, `git push --force-with-lease=feat/x:${O} origin feat/x`))
      expect(ran()).toContain(`git config --local ${TOP} ${N1}`)
      expect(ran()).toContain(`git config --local ${KEY} middle feature`)
      expect(at(ran, `git config --local ${KEY} middle feature`)).toBeLessThan(
        at(ran, `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`),
      )
      expect(ran()).toContain("gh pr edit 8 --base main")
      expect(ran().some((c) => c.startsWith("gh pr edit 9 --base"))).toBe(false)
      expect(ran().some((c) => c.includes("--unset"))).toBe(false)
    })

    test("a merge commit keeps the slice's commit: no rebase, no force push, retarget only, record kept", async () => {
      const { io, ran } = repo({
        ...two,
        [`git merge-base --is-ancestor ${C1} origin/main`]: { code: 0 },
      })
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran().some((c) => /^git rebase|force-with-lease|ls-remote/.test(c))).toBe(false)
      expect(ran()).toContain("gh pr edit 8 --base main")
      expect(ran().some((c) => c.startsWith("git config --local") && !c.includes("--get"))).toBe(
        false,
      )
    })

    test("a failed fetch refuses with nothing changed", async () => {
      const { io, ran } = repo({ ...two, [FETCH]: { code: 1, err: "offline" } })
      const out = await ship(io, false)
      expect(out).toEqual({
        ok: false,
        text: "git fetch origin +refs/heads/main:refs/remotes/origin/main failed; nothing changed.\noffline",
      })
      expect(ran().some((c) => writes.test(c))).toBe(false)
    })

    test.each([
      ["unknown locally", `git cat-file -e ${O}`],
      ["not an ancestor of the local tip", `git merge-base --is-ancestor ${O} ${C2}`],
    ])("origin's copy %s refuses before any write", async (_, key) => {
      const { io, ran } = repo({ ...two, [key]: { code: 1 } })
      const out = await ship(io, false)
      expect(out).toEqual({
        ok: false,
        text: "origin/feat/x holds commits feat/x lacks; nothing changed. Pull or reconcile feat/x, then ship.",
      })
      expect(ran().some((c) => writes.test(c))).toBe(false)
    })

    test("a failed ls-remote refuses with nothing changed", async () => {
      const { io, ran } = repo({ ...two, [lsTop]: { code: 1, err: "offline" } })
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("ls-remote") })
      expect(ran().some((c) => writes.test(c))).toBe(false)
    })

    test("a branch origin does not list pushes first, without a lease", async () => {
      const unlisted = {
        ...two,
        [lsTop]: { out: "" },
        "git rev-parse --verify --quiet origin/feat/x": { code: 1 },
      }
      const { io, ran } = repo(unlisted)
      expect(await ship(io, false)).toMatchObject({ ok: true })
      expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
      expect(ran()).toContain("git push --set-upstream origin feat/x")
      const { io: dry } = repo(unlisted)
      expect((await ship(dry, true)).text).toContain(
        "Push: would run git push --set-upstream origin feat/x",
      )
    })

    test("a failed second record write leaves the stack unchanged and pushes nothing", async () => {
      const { io, ran } = repo({
        ...three,
        [`git config --local ${TOP} ${N1}`]: { code: 1, err: "locked" },
      })
      const out = await ship(io, false)
      expect(out).toMatchObject({ ok: false, text: expect.stringContaining("locked") })
      expect(at(ran, `git config --local ${KEY} middle feature`)).toBeLessThan(
        at(ran, `git config --local ${TOP} ${N1}`),
      )
      expect(ran().some((c) => c.startsWith("git push"))).toBe(false)
    })

    describe("with a process at HEAD", () => {
      const proc: Record<string, Scripted> = {
        ...two,
        ...feature,
        [`git config --local --get ${KEY}`]: { out: "refactor feature\n" },
        [`git config --local --get ${TOP}`]: { out: C2 + "\n" },
        "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
        "git rev-parse refs/heads/feat/x-refactor": { out: C1 },
        [`git rev-parse --verify --quiet ${C2}~1`]: { out: C1 },
        [view("feat/x-refactor")]: pr(7, { state: "MERGED" }),
        [view("feat/x")]: pr(8, { baseRefName: "feat/x-refactor" }),
        "gtd history list --json": { out: JSON.stringify([entry(ENTRY, TIP)]) },
        [lsTop]: { out: `${O}\trefs/heads/feat/x\n` },
        "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
        [`git merge-base --is-ancestor ${C1} origin/main`]: { code: 1 },
      }
      const reply = ["feat: add x\n\nwhy", "NO-UPDATE"]

      test("squashes first, then restacks, in one run", async () => {
        const { io, ran } = repo(proc, reply)
        expect(await ship(io, false)).toMatchObject({ ok: true })
        const order = [
          lsTop,
          `git push origin +${REF}:${REF}`,
          `git reset --soft ${BASE}`,
          `git rebase --update-refs --onto origin/main ${C1} feat/x`,
          `git push --force-with-lease=feat/x:${O} origin feat/x`,
        ].map((c) => at(ran, c))
        expect(order.every((i) => i >= 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
      })

      test("a lease refusal comes before the squash and the history push", async () => {
        const { io, ran } = repo({ ...proc, [`git cat-file -e ${O}`]: { code: 1 } }, reply)
        expect(await ship(io, false)).toMatchObject({
          ok: false,
          text: expect.stringContaining("Pull or reconcile feat/x"),
        })
        expect(ran().some((c) => writes.test(c))).toBe(false)
      })

      test("a rebase failing before it starts still names the pre-ship HEAD", async () => {
        const { io } = repo(
          { ...proc, [`git rebase --update-refs --onto origin/main ${C1} feat/x`]: { code: 129 } },
          [...reply],
        )
        const out = await ship(io, false)
        expect(out.text).toContain(`undo it with git reset --soft ${TIP}`)
      })

      test("a conflict keeps the squash, names the pre-ship HEAD and still aborts the rebase", async () => {
        const { io, ran } = repo(
          {
            ...proc,
            [`git rebase --update-refs --onto origin/main ${C1} feat/x`]: { code: 1 },
            [GITPATH]: { out: ".git/rebase-merge" },
            "git rev-parse --verify --quiet REBASE_HEAD": { out: TIP },
          },
          reply,
        )
        const out = await ship(io, false)
        expect(out.ok).toBe(false)
        expect(out.text).toContain(`the squash was kept; undo it with git reset --soft ${TIP}`)
        expect(ran()).toContain(`git reset --soft ${BASE}`)
        expect(ran()).toContain(`git push origin +${REF}:${REF}`)
        expect(ran()).toContain("git rebase --abort")
        expect(ran().some((c) => /^git push --force|^gh pr (create|edit)/.test(c))).toBe(false)
      })
    })

    describe("a conflict", () => {
      const conflict = {
        ...three,
        [REBASE3]: { code: 1, err: "CONFLICT" },
        [GITPATH]: { out: ".git/rebase-merge" },
        "git rev-parse --verify --quiet REBASE_HEAD": { out: S2 },
      }

      test("aborts the rebase, names the slice and the step, prints the hand command, writes nothing", async () => {
        const { io, ran } = repo(conflict)
        const out = await ship(io, false)
        expect(out.ok).toBe(false)
        expect(out.text).toContain(
          "Slice middle failed at restack: git rebase conflicted; tree and refs are as before.",
        )
        expect(out.text).toContain(REBASE3)
        expect(out.text).toContain("then /gtd ship")
        expect(out.text).not.toContain("squash was kept")
        expect(at(ran, "git rebase --abort")).toBeGreaterThan(at(ran, REBASE3))
        expect(
          ran().some((c) => /^git push|^git config --local (?!--get)|^gh pr (create|edit)/.test(c)),
        ).toBe(false)
      })

      test("a conflict on the top slice names the top slice", async () => {
        const { io } = repo({
          ...conflict,
          "git rev-parse --verify --quiet REBASE_HEAD": { out: S3 },
        })
        expect((await ship(io, false)).text).toContain("Slice feature failed at restack")
      })

      test("a rebase failing with none in progress (old git) reports stderr and aborts nothing", async () => {
        const { io, ran } = repo({
          ...three,
          [REBASE3]: { code: 129, err: "unknown option update-refs" },
        })
        const out = await ship(io, false)
        expect(out.ok).toBe(false)
        expect(out.text).toContain("git rebase failed")
        expect(out.text).toContain("unknown option update-refs")
        expect(ran()).not.toContain("git rebase --abort")
        expect(ran().some((c) => /^git push|^gh pr (create|edit)/.test(c))).toBe(false)
      })
    })

    describe("after a hand restack", () => {
      const hand: Record<string, Scripted> = {
        ...three,
        [`git merge-base --is-ancestor ${S3} HEAD`]: { code: 1 },
        [`git merge-base --is-ancestor ${S1} refs/heads/feat/x-middle`]: { code: 1 },
        [`git merge-base --is-ancestor ${S2} origin/feat/x-middle`]: { code: 1 },
        [`git merge-base --is-ancestor ${S3} origin/feat/x`]: { code: 1 },
      }

      test("a hand restack resolves slice branches as refs/heads, never by a bare name a tag could take", async () => {
        const { io, ran } = repo(hand)
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran()).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
        expect(bareSlice(ran)).toEqual([])
      })

      test("pushes each branch with a lease, retargets the lowest PR and keeps the stack", async () => {
        const { io, ran } = repo(hand)
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran().some((c) => /^git (rebase|fetch)/.test(c))).toBe(false)
        expect(ran()).toContain(
          `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`,
        )
        expect(ran()).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
        expect(ran()).toContain("gh pr edit 8 --base main")
        expect(ran()).toContain(`git config --local ${KEY} middle feature`)
        expect(ran()).toContain(`git config --local ${TOP} ${N1}`)
        expect(at(ran, `git config --local ${KEY} middle feature`)).toBeLessThan(
          at(ran, `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`),
        )
        expect(ran().some((c) => c.includes("--unset"))).toBe(false)
      })

      const FMT = "-p --no-color --format=%x1e%an%x00%ae%x00%at%x00%B"
      const theirs = (sha: string, lower = S3) =>
        `git log ${FMT} ${sha} ^${lower} ^origin/main ^${S1}`
      const mine = (b: string) => `git log ${FMT} origin/main..refs/heads/${b}`
      const refused = (b: string) => ({
        ok: false,
        text: `origin/${b} holds commits ${b} lacks; nothing changed. Pull or reconcile ${b}, then ship.`,
      })
      const X = "\x1eCy\x00c@x\x00300\x00fix: collaborator\n"
      const mineX = `\x1eAnn\x00a@x\x00100\x00feat: own\n${X}`

      test("origin holding a commit the local branch dropped by hand refuses before any write, though the reflog knows it", async () => {
        const { io, ran } = repo({
          ...hand,
          [theirs(O2)]: { out: X },
          [mine("feat/x-middle")]: { out: "\x1eAnn\x00a@x\x00100\x00feat: own\n" },
          "git reflog show --format=%H refs/heads/feat/x-middle": { out: `${O2}\n${S2}\n` },
        })
        expect(await ship(io, false)).toEqual(refused("feat/x-middle"))
        expect(ran().some((c) => writes.test(c))).toBe(false)
      })

      test("origin's extra commit kept by identity passes and pushes with the lease", async () => {
        const { io, ran } = repo({
          ...hand,
          [theirs(O2)]: { out: X },
          [mine("feat/x-middle")]: { out: mineX },
        })
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran()).toContain(
          `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`,
        )
      })

      test("the merged slice's commits on origin are not foreign: the range excludes them", async () => {
        // the harness strips one trailing `^<sha>`: only a call that lost `^<from>` sees X
        const unexcluded = (sha: string, lower = S3) =>
          `git log ${FMT} ${sha} ^${lower} ^origin/main`
        const { io } = repo({
          ...hand,
          [theirs(O2)]: { out: "" },
          [theirs(O)]: { out: "" },
          [unexcluded(O2)]: { out: X },
          [unexcluded(O)]: { out: X },
        })
        expect(await ship(io, false)).toMatchObject({ ok: true })
      })

      test("origin's extra commit kept between other local commits, each with its patch, passes", async () => {
        const commit = (id: string, line: string) =>
          `\x1e${id}\n\n\ndiff --git a/f b/f\n@@ -1 +1,2 @@\n+${line}\n`
        const x = commit("Cy\x00c@x\x00300\x00fix: collaborator\n", "x")
        const { io, ran } = repo({
          ...hand,
          [theirs(O2)]: { out: x },
          [mine("feat/x-middle")]: {
            out:
              commit("Ann\x00a@x\x00200\x00feat: newer\n", "b") +
              x +
              commit("Ann\x00a@x\x00100\x00feat: own\n", "a"),
          },
        })
        expect(await ship(io, false)).toMatchObject({ ok: true })
        // the fakes above are git's real order: only this format reads them
        expect(ran()).toContain(theirs(O2))
        expect(ran()).toContain(
          `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`,
        )
      })

      test("origin's amended copy of a local commit (same identity, different diff) refuses before any write", async () => {
        const id = "Ann\x00a@x\x00100\x00feat: own\n"
        const { io, ran } = repo({
          ...hand,
          [theirs(O2)]: { out: `\x1e${id}diff --git a/f b/f\n+theirs\n` },
          [mine("feat/x-middle")]: { out: `\x1e${id}diff --git a/f b/f\n+mine\n` },
        })
        expect(await ship(io, false)).toEqual(refused("feat/x-middle"))
        expect(ran().some((c) => writes.test(c))).toBe(false)
      })

      test("a rebase shifting index and hunk offsets still counts as the same commit", async () => {
        const id = "Ann\x00a@x\x00100\x00feat: own\n"
        const { io } = repo({
          ...hand,
          [theirs(O2)]: { out: `\x1e${id}index 1..2 100644\n@@ -1,2 +1,3 @@ fn\n+a\n` },
          [mine("feat/x-middle")]: { out: `\x1e${id}index 3..4 100644\n@@ -9,2 +9,3 @@ fn\n+a\n` },
        })
        expect(await ship(io, false)).toMatchObject({ ok: true })
      })

      test("origin's slice branch deleted but a stale tracking ref left: pushes fresh, never leases on the stale ref", async () => {
        const { io, ran } = repo({ ...hand, [ls3]: { out: `${O}\trefs/heads/feat/x\n` } })
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran()).toContain("git push --set-upstream origin feat/x-middle")
        expect(ran().some((c) => /--force-with-lease(?!=)/.test(c))).toBe(false)
        expect(ran()).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
      })

      test("a recorded top that is gone starts the range at the merge base", async () => {
        const MB = "7".repeat(40)
        const stale = {
          ...hand,
          [`git cat-file -e ${S3}`]: { code: 1 },
          [`git merge-base ${O2} refs/heads/feat/x-middle`]: { out: MB },
          [`git merge-base ${O} refs/heads/feat/x`]: { out: MB },
          [theirs(O2, MB)]: { out: X },
        }
        const { io, ran } = repo({ ...stale, [mine("feat/x-middle")]: { out: "" } })
        expect(await ship(io, false)).toEqual(refused("feat/x-middle"))
        expect(ran().some((c) => writes.test(c))).toBe(false)
        const { io: kept } = repo({ ...stale, [mine("feat/x-middle")]: { out: mineX } })
        expect(await ship(kept, false)).toMatchObject({ ok: true })
      })

      test("a recorded top that is gone with no common history refuses before any write", async () => {
        const { io, ran } = repo({ ...hand, [`git cat-file -e ${S3}`]: { code: 1 } })
        expect(await ship(io, false)).toEqual(refused("feat/x-middle"))
        expect(ran().some((c) => writes.test(c))).toBe(false)
      })

      test("a lowest branch off origin/<default> is not a hand restack: the record drops", async () => {
        const { io, ran } = repo({
          ...hand,
          "git merge-base --is-ancestor refs/heads/feat/x-middle~1 origin/main": { code: 1 },
        })
        await ship(io, false)
        expect(ran().some((c) => c.includes("force-with-lease"))).toBe(false)
        expect(ran().some((c) => c.startsWith(`git config --local ${KEY} `))).toBe(false)
        expect(ran()).toContain(`git config --local --unset ${KEY}`)
      })

      test("with the lowest branch still on the merged slice it is not a hand restack: the branch ships alone", async () => {
        const { io, ran } = repo({
          ...hand,
          [`git merge-base --is-ancestor ${S1} refs/heads/feat/x-middle`]: { code: 0 },
        })
        await ship(io, false)
        expect(ran().some((c) => c.includes("force-with-lease"))).toBe(false)
        expect(ran().some((c) => c.startsWith(`git config --local ${KEY} `))).toBe(false)
      })

      test("a rebased stack with no merged slice still drops the record and ships alone", async () => {
        const { io, ran } = repo(
          {
            ...resume,
            [`git merge-base --is-ancestor ${C1} HEAD`]: { code: 1 },
            [view("feat/x-refactor")]: pr(7),
            [view("feat/x")]: pr(8, { baseRefName: "feat/x-refactor" }),
          },
          ["NO-UPDATE"],
        )
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran()).toContain(`git config --local --unset ${KEY}`)
        expect(ran().some((c) => /^git rebase|ls-remote/.test(c))).toBe(false)
      })
    })

    describe("restack after a merged lower slice", () => {
      const D = "d".repeat(40)
      const elsewhere = {
        out: "worktree /repo\nHEAD abc\nbranch refs/heads/feat/x\n\nworktree /elsewhere\nHEAD def\nbranch refs/heads/feat/x-middle\n",
      }
      const midHere = "git merge-base --is-ancestor " + S1 + " refs/heads/feat/x-middle"
      const hand: Record<string, Scripted> = {
        ...three,
        [`git merge-base --is-ancestor ${S3} HEAD`]: { code: 1 },
        [`git merge-base --is-ancestor ${S1} refs/heads/feat/x-middle`]: { code: 1 },
        [`git merge-base --is-ancestor ${S2} origin/feat/x-middle`]: { code: 1 },
        [`git merge-base --is-ancestor ${S3} origin/feat/x`]: { code: 1 },
      }
      const nothingWritten = (ran: () => string[]) =>
        ran().some((c) =>
          /^git (push|rebase|fetch|ls-remote)|^git config --local (?!--get)|^gh pr (create|edit)/.test(
            c,
          ),
        )

      test("a rebase-merge dir is aborted even without a REBASE_HEAD, and names the top slice", async () => {
        const { io, ran } = repo({
          ...three,
          [REBASE3]: { code: 1 },
          [GITPATH]: { out: ".git/rebase-merge" },
        })
        const out = await ship(io, false)
        expect(out.ok).toBe(false)
        expect(out.text).toContain("Slice feature failed at restack")
        expect(ran()).toContain("test -d .git/rebase-merge")
        expect(ran()).toContain("git rebase --abort")
        expect(
          ran().some((c) => /^git push|^git config --local (?!--get)|^gh pr edit/.test(c)),
        ).toBe(false)
      })

      test("no rebase-merge dir: no abort, stderr reported, refs unchanged", async () => {
        const { io, ran } = repo({
          ...three,
          [REBASE3]: { code: 129, err: "unknown option update-refs" },
          [GITPATH]: { out: ".git/rebase-merge" },
          "test -d .git/rebase-merge": { code: 1 },
        })
        const out = await ship(io, false)
        expect(out.text).toContain("git rebase failed; refs are unchanged.")
        expect(out.text).toContain("unknown option update-refs")
        expect(ran()).not.toContain("git rebase --abort")
      })

      test.each([
        ["another slice branch", { baseRefName: "feat/x-other" }, "feat/x-other"],
        ["no base at all", { baseRefName: undefined }, "no base"],
      ])("a lowest slice merged into %s refuses before any change", async (_, over, shown) => {
        const script = { ...three, [view("feat/x-refactor")]: pr(7, { state: "MERGED", ...over }) }
        const { io, ran } = repo(script)
        expect(await ship(io, false)).toEqual({
          ok: false,
          text: `The pull request for slice refactor (#7, feat/x-refactor) merged into ${shown}, not main; nothing changed. Ship the branch alone with GTD_SHIP_MODE=commits.`,
        })
        expect(nothingWritten(ran)).toBe(false)
        const dry = repo(script)
        expect((await ship(dry.io, true)).ok).toBe(false)
      })

      describe("a slice merged into a lower slice branch", () => {
        const early = "2026-10-10T09:00:00Z"
        const late = "2026-10-10T10:00:00Z"
        const merged = (o: object) => ({
          ...three,
          [`git rev-parse --verify --quiet ${S3}~1`]: { out: S2 },
          [view("feat/x-refactor")]: pr(7, { state: "MERGED", mergedAt: late, ...o }),
          [view("feat/x-middle")]: pr(8, {
            state: "MERGED",
            baseRefName: "feat/x-refactor",
            mergedAt: early,
          }),
        })
        const refusal = (n: number, b: string) => ({
          ok: false,
          text: `The pull request for slice ${b === "feat/x-middle" ? "middle" : "refactor"} (#${n}, ${b}) merged into feat/x-refactor, not main; nothing changed. Ship the branch alone with GTD_SHIP_MODE=commits.`,
        })
        const changed = (ran: () => string[]) =>
          ran().some((c) => writes.test(c) || c.startsWith("git fetch"))

        test("merged first into the lower branch, which then merged into main: both land and the restack proceeds", async () => {
          const { io, ran } = repo(merged({}))
          const out = await ship(io, false)
          expect(out).toMatchObject({ ok: true })
          // done = 2: only the top slice is retargeted; the merged middle is never touched
          expect(ran()).toContain("gh pr edit 9 --base main")
          expect(ran().filter((c) => writes.test(c) && c.includes("feat/x-middle"))).toEqual([])
        })

        test("the top slice merged into the lower branch which then landed: refuses as merged, not as merged elsewhere", async () => {
          const { io, ran } = repo({
            ...three,
            [`git rev-parse --verify --quiet ${S3}~1`]: { out: S2 },
            [view("feat/x-refactor")]: pr(7, { state: "MERGED", mergedAt: early }),
            [view("feat/x-middle")]: pr(8, {
              state: "MERGED",
              baseRefName: "feat/x-refactor",
              mergedAt: early,
            }),
            [view("feat/x")]: pr(9, {
              state: "MERGED",
              baseRefName: "feat/x-middle",
              mergedAt: early,
            }),
          })
          const out = await ship(io, false)
          expect(out.ok).toBe(false)
          expect(out.text).toContain("is MERGED, not open")
          expect(out.text).toContain("Rename the branch")
          expect(out.text).not.toContain("not main")
          expect(changed(ran)).toBe(false)
        })

        test("the lower slice still open: refuses, nothing changes", async () => {
          const { io, ran } = repo(merged({ state: "OPEN", mergedAt: undefined }))
          expect(await ship(io, false)).toEqual(refusal(8, "feat/x-middle"))
          expect(changed(ran)).toBe(false)
        })

        test("merged into the lower branch after that one reached main: refuses, nothing changes", async () => {
          const { io, ran } = repo({
            ...merged({ mergedAt: early }),
            [view("feat/x-middle")]: pr(8, {
              state: "MERGED",
              baseRefName: "feat/x-refactor",
              mergedAt: late,
            }),
          })
          expect(await ship(io, false)).toEqual(refusal(8, "feat/x-middle"))
          expect(changed(ran)).toBe(false)
        })

        test("no mergedAt on the slice refuses, nothing changes", async () => {
          const { io, ran } = repo({
            ...merged({}),
            [view("feat/x-middle")]: pr(8, { state: "MERGED", baseRefName: "feat/x-refactor" }),
          })
          expect(await ship(io, false)).toEqual(refusal(8, "feat/x-middle"))
          expect(changed(ran)).toBe(false)
        })
      })

      test("a diverged local merged slice branch is never the rebase base: the floor is", async () => {
        const { io, ran } = repo({
          ...two,
          "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: D },
        })
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran().filter((c) => c.startsWith("git rebase"))).toEqual([REBASE])
      })

      test("a stale local merged branch does not stop a hand restack", async () => {
        const { io, ran } = repo({
          ...hand,
          "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: D },
        })
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran()).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
      })

      test("no floor commit refuses and names the merged slice", async () => {
        const { io } = repo({ ...two, [`git rev-parse --verify --quiet ${C2}~1`]: { out: "" } })
        expect(await ship(io, false)).toMatchObject({
          ok: false,
          text: expect.stringContaining("The commit of merged slice refactor cannot be found"),
        })
      })

      test("a hand restack after origin moved on is kept", async () => {
        const { io, ran } = repo({
          ...hand,
          "git merge-base --is-ancestor origin/main refs/heads/feat/x-middle": { code: 1 },
          "git merge-base --is-ancestor refs/heads/feat/x-middle~1 origin/main": { code: 0 },
        })
        expect(await ship(io, false)).toMatchObject({ ok: true })
        expect(ran()).toContain(
          `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`,
        )
        expect(ran()).toContain("gh pr edit 8 --base main")
        expect(ran()).toContain(`git config --local ${KEY} middle feature`)
      })

      test("a slice branch checked out elsewhere refuses before the rebase, and under -n", async () => {
        const refusal = {
          ok: false,
          text: "Slice branch feat/x-middle is checked out in worktree /elsewhere, so git rebase --update-refs would skip it; nothing changed. Free it there (git -C '/elsewhere' switch --detach), then /gtd ship.",
        }
        const real = repo({ ...three, [WT]: elsewhere })
        expect(await ship(real.io, false)).toEqual(refusal)
        expect(
          real
            .ran()
            .some((c) =>
              /^git (push|rebase)|^git config --local (?!--get)|^gh pr (create|edit)/.test(c),
            ),
        ).toBe(false)
        const dry = repo({ ...three, [WT]: elsewhere })
        expect(await ship(dry.io, true)).toEqual(refusal)
      })

      test("a failing worktree list refuses with nothing changed", async () => {
        const { io, ran } = repo({ ...three, [WT]: { code: 1, err: "boom" } })
        const out = await ship(io, false)
        expect(out).toMatchObject({ ok: false, text: expect.stringContaining("boom") })
        expect(ran().some((c) => /^git (push|rebase)|^git config --local (?!--get)/.test(c))).toBe(
          false,
        )
      })

      test.each([
        ["still holds the merged slice's commit", { [midHere]: { code: 0 } }],
        [
          "lacks origin/main",
          { "git merge-base --is-ancestor origin/main refs/heads/feat/x-middle": { code: 1 } },
        ],
      ])("a skipped branch that %s rolls the restack back and refuses", async (_, over) => {
        const { io, ran } = repo({ ...three, ...over })
        expect(await ship(io, false)).toEqual({
          ok: false,
          text: "Slice branch feat/x-middle was not restacked; the slice branches and HEAD are restored and nothing was pushed or recorded.",
        })
        expect(ran()).toContain(`git update-ref refs/heads/feat/x-middle ${S2} ${S2}`)
        expect(at(ran, `git reset --keep ${S3}`)).toBeGreaterThan(at(ran, REBASE3))
        expect(
          ran().some((c) => /^git push|^git config --local (?!--get)|^gh pr edit/.test(c)),
        ).toBe(false)
      })

      test("the backstop after a same-run squash keeps the undo line", async () => {
        const proc3 = {
          ...three,
          "git rev-parse HEAD": { out: TIP },
          "gtd summary": feature["gtd summary"]!,
          "gtd slices --json": feature["gtd slices --json"]!,
          "gtd history list --json": { out: JSON.stringify([entry(ENTRY, TIP)]) },
          [midHere]: { code: 0 },
        }
        const { io, ran } = repo(proc3, ["feat: add x\n\nwhy", "NO-UPDATE"])
        const out = await ship(io, false)
        expect(out.ok).toBe(false)
        expect(out.text).toContain("was not restacked")
        expect(out.text).toContain(`the squash was kept; undo it with git reset --soft ${TIP}`)
        expect(ran().some((c) => /^git push --force|^gh pr edit/.test(c))).toBe(false)
      })

      test("a live record refuses a fresh stack even when origin is unreachable", async () => {
        const { io, ran } = repo({
          ...two,
          "gtd summary": { out: "Describe the process." },
          "git rev-parse HEAD": { out: C },
          [lsTop]: { code: 1, err: "offline" },
        })
        const out = await ship(io, false)
        expect(out.text).not.toContain("ls-remote")
        expect(out.text).toContain("already has a recorded stack")
        expect(ran().some((c) => /^git (ls-remote|fetch)/.test(c))).toBe(false)
      })

      test("a hand-restacked record refuses a fresh stack without asking origin", async () => {
        const { io, ran } = repo({
          ...hand,
          "gtd summary": { out: "Describe the process." },
          "git rev-parse HEAD": { out: C },
          [ls3]: { code: 1, err: "offline" },
        })
        const out = await ship(io, false)
        expect(out.text).toContain("already has a recorded stack")
        expect(ran().some((c) => /^git (ls-remote|fetch|push)/.test(c))).toBe(false)
      })

      test("a hand-restacked record with one slice left does not refuse a fresh stack", async () => {
        const { io } = repo({
          ...two,
          "gtd summary": { out: "Describe the process." },
          "git rev-parse HEAD": { out: C },
          [`git merge-base --is-ancestor ${C2} HEAD`]: { code: 1 },
          [`git merge-base --is-ancestor ${C1} refs/heads/feat/x`]: { code: 1 },
          [lsTop]: { code: 1, err: "offline" },
        })
        const out = await ship(io, false)
        expect(out.text).not.toContain("already has a recorded stack")
      })

      test("a rollback restores the branch the rebase moved, from its pre-rebase sha", async () => {
        const MOVED = "6".repeat(40)
        const mid = "refs/heads/feat/x-mid2"
        const script: Record<string, Scripted> = {
          ...three,
          [`git config --local --get ${KEY}`]: { out: "refactor middle mid2 feature\n" },
          [`git rev-parse --verify --quiet ${S3}~3`]: { out: S1 },
          [`git rev-parse --verify --quiet ${S3}~2`]: { out: S2 },
          "git rev-parse --verify --quiet refs/heads/feat/x-mid2": { out: S3 },
          "git rev-parse refs/heads/feat/x-mid2": { out: S3 },
          "git rev-parse refs/heads/feat/x-middle": { out: S2 },
          [view("feat/x-mid2")]: pr(10, { baseRefName: "feat/x-middle" }),
          [view("feat/x")]: pr(9, { baseRefName: "feat/x-mid2" }),
          "git rev-parse --verify --quiet origin/feat/x-mid2": { code: 0 },
          // the rebase moved middle, skipped mid2
          [`git merge-base --is-ancestor ${S1} ${mid}`]: { code: 0 },
          "git merge-base --is-ancestor origin/main refs/heads/feat/x-middle": { code: 0 },
          "git merge-base --is-ancestor origin/main refs/heads/feat/x-mid2": { code: 1 },
        }
        const { io, ran } = repo(script)
        let rebased = false
        const run = io.run
        io.run = async (argv, stdin) => {
          const key = argv.join(" ")
          if (key.startsWith("git rebase --update-refs")) rebased = true
          if (rebased && key === "git rev-parse refs/heads/feat/x-middle")
            return { code: 0, out: MOVED, err: "" }
          return run(argv, stdin)
        }
        const out = await ship(io, false)
        expect(out.text).toContain("Slice branch feat/x-mid2 was not restacked")
        expect(ran()).toContain(`git update-ref refs/heads/feat/x-middle ${S2} ${MOVED}`)
        expect(ran()).toContain(`git update-ref ${mid} ${S3} ${S3}`)
      })

      test("-n after a merged lower slice prints one Retarget line", async () => {
        const { io } = repo(three)
        const out = await ship(io, true)
        expect(out.text.split("\n").filter((l) => l.startsWith("Retarget:"))).toHaveLength(1)
      })
    })

    describe("restack hardening", () => {
      const MOVED = "6".repeat(40)
      const Z = "7".repeat(40)
      const NO_DIR = {
        [GITPATH]: { out: ".git/rebase-merge" },
        "test -d .git/rebase-merge": { code: 1 },
      }
      const LEASE = (b: string) => `branch.${b}.gtdLease`
      const RETIRED = "branch.feat/x.gtdStackRetired"
      const KEYS = "branch.feat/x.gtdStack"
      const sets = (ran: () => string[]) =>
        ran().filter((c) => c.startsWith("git config --local") && !c.includes("--get"))
      const pushed = (ran: () => string[]) => ran().some((c) => c.startsWith("git push"))
      const rolled = (ran: () => string[]) => ran().some((c) => /^git (update-ref|reset)/.test(c))
      // after the rebase ran, these reads answer with the moved value
      const afterRebase = (io: ShipIo, moved: Record<string, string>) => {
        const run = io.run
        let rebased = false
        io.run = async (argv, stdin) => {
          const key = argv.join(" ")
          if (key.startsWith("git rebase --update-refs")) rebased = true
          if (rebased && key in moved) return { code: 0, out: moved[key]!, err: "" }
          return run(argv, stdin)
        }
      }
      const failing = { ...three, ...NO_DIR, [REBASE3]: { code: 1, err: "update refs failed" } }
      const headMoved = "git rev-parse HEAD"
      const midMoved = "git rev-parse refs/heads/feat/x-middle"
      const restored = (why: string) =>
        `${why}; the slice branches and HEAD are restored and nothing was pushed or recorded.`

      describe("a conflict whose abort fails", () => {
        const conflict = {
          ...three,
          [REBASE3]: { code: 1, err: "CONFLICT" },
          [GITPATH]: { out: ".git/rebase-merge" },
          "git rev-parse --verify --quiet REBASE_HEAD": { out: S2 },
        }
        test("says the repository is mid-rebase and never claims a clean state", async () => {
          const { io, ran } = repo({
            ...conflict,
            "git rebase --abort": { code: 1, err: "no abort" },
          })
          const out = await ship(io, false)
          expect(out.ok).toBe(false)
          expect(out.text).toContain(
            "Slice middle failed at restack: git rebase conflicted, and git rebase --abort failed too: the repository is mid-rebase. Run git rebase --abort by hand, then rebase by hand, which restacks every slice branch:",
          )
          expect(out.text).toContain(REBASE3)
          expect(out.text).toContain("then /gtd ship.")
          expect(out.text).toContain("no abort")
          expect(out.text).not.toContain("tree and refs are as before")
          expect(pushed(ran) || sets(ran).length > 0).toBe(false)
        })
        test("a successful abort keeps today's text", async () => {
          const { io } = repo(conflict)
          expect((await ship(io, false)).text).toContain(
            "Slice middle failed at restack: git rebase conflicted; tree and refs are as before.",
          )
        })
      })

      describe("a non-zero rebase with no rebase dir", () => {
        test("HEAD moved: refs and HEAD are rolled back, never 'refs are unchanged'", async () => {
          const { io, ran } = repo(failing)
          afterRebase(io, { [headMoved]: MOVED })
          const out = await ship(io, false)
          expect(out).toEqual({
            ok: false,
            text: `${restored("git rebase failed after moving refs")}\nupdate refs failed`,
          })
          expect(ran()).toContain(`git update-ref refs/heads/feat/x-middle ${S2} ${S2}`)
          expect(ran()).toContain(`git reset --keep ${S3}`)
          expect(pushed(ran) || sets(ran).length > 0).toBe(false)
        })
        test("only a lower ref moved: rolled back from its pre-rebase sha", async () => {
          const { io, ran } = repo(failing)
          afterRebase(io, { [midMoved]: MOVED })
          const out = await ship(io, false)
          expect(out.text).toContain("git rebase failed after moving refs")
          expect(out.text).not.toContain("refs are unchanged")
          expect(ran()).toContain(`git update-ref refs/heads/feat/x-middle ${S2} ${MOVED}`)
          expect(ran()).toContain(`git reset --keep ${S3}`)
        })
        test("a failing rollback prints the hand lines", async () => {
          const { io } = repo({
            ...failing,
            [`git update-ref refs/heads/feat/x-middle ${S2} ${MOVED}`]: { code: 1 },
          })
          afterRebase(io, { [midMoved]: MOVED })
          const out = await ship(io, false)
          expect(out.text).toContain(
            "git rebase failed after moving refs, and the rollback failed: slice branches stay rebased and nothing was pushed or recorded. Run by hand, then /gtd ship:",
          )
          expect(out.text).toContain(`git update-ref refs/heads/feat/x-middle ${S2} ${MOVED}`)
        })
        test("nothing moved keeps 'refs are unchanged' and runs no rollback", async () => {
          const { io, ran } = repo(failing)
          const out = await ship(io, false)
          expect(out.text).toContain("git rebase failed; refs are unchanged.")
          expect(rolled(ran)).toBe(false)
        })
      })

      describe("a slice left with no commit of its own", () => {
        const midBroken = {
          "git rev-parse refs/heads/feat/x-middle~1": { out: Z },
          "git rev-parse origin/main": { out: BASE },
        }
        test("a lower slice already upstream is rolled back and refused by name", async () => {
          const { io, ran } = repo({ ...three, ...midBroken })
          const out = await ship(io, false)
          expect(out).toEqual({
            ok: false,
            text: `${restored("Slice middle keeps no commit of its own after the restack (its change is already in origin/main)")} Ship the branch alone with GTD_SHIP_MODE=commits.`,
          })
          expect(ran()).toContain(`git update-ref refs/heads/feat/x-middle ${S2} ${S2}`)
          expect(ran()).toContain(`git reset --keep ${S3}`)
          expect(pushed(ran) || sets(ran).length > 0).toBe(false)
        })
        test("a top with no commit above its lower is refused naming the top slice", async () => {
          const { io, ran } = repo({
            ...three,
            "git rev-list --count refs/heads/feat/x-middle..HEAD": { out: "0" },
          })
          const out = await ship(io, false)
          expect(out.text).toContain("Slice feature keeps no commit of its own after the restack")
          expect(ran()).toContain(`git reset --keep ${S3}`)
          expect(pushed(ran) || sets(ran).length > 0).toBe(false)
        })
        test("a failing rollback prints the hand lines", async () => {
          const { io } = repo({
            ...three,
            ...midBroken,
            [`git update-ref refs/heads/feat/x-middle ${S2} ${S2}`]: { code: 1 },
          })
          const out = await ship(io, false)
          expect(out.text).toContain("and the rollback failed: slice branches stay rebased")
          expect(out.text).toContain(`git update-ref refs/heads/feat/x-middle ${S2} ${S2}`)
        })
      })

      describe("an unrelated local branch inside the range", () => {
        const range = `git rev-list ${S1}..refs/heads/feat/x`
        const REFS = "git for-each-ref --format=%(objectname) %(refname) refs/heads/"
        const text =
          "Branch backup points into the commits the restack rebases, so git rebase --update-refs would move it too; nothing changed. Move or delete it, then /gtd ship."
        const stray = {
          ...three,
          [range]: { out: `${S2}\n${S3}\n` },
          [REFS]: {
            out: `${S2} refs/heads/feat/x-middle\n${S3} refs/heads/feat/x\n${S2} refs/heads/backup\n`,
          },
        }
        test("refuses before any rebase, squash or push", async () => {
          const { io, ran } = repo(stray)
          expect(await ship(io, false)).toEqual({ ok: false, text })
          expect(ran().some((c) => /^git (rebase|push|reset|commit|update-ref)/.test(c))).toBe(
            false,
          )
          expect(sets(ran)).toEqual([])
        })
        test("refuses identically under -n", async () => {
          const { io } = repo(stray)
          expect(await ship(io, true)).toEqual({ ok: false, text })
        })
        test("remaining slice branches, the top and the merged slice's branch never refuse", async () => {
          const { io } = repo({
            ...stray,
            [REFS]: {
              out: `${S2} refs/heads/feat/x-middle\n${S3} refs/heads/feat/x\n${S2} refs/heads/feat/x-refactor\n`,
            },
          })
          expect(await ship(io, false)).toMatchObject({ ok: true })
        })
      })

      describe("a persisted lease", () => {
        test("is written per moved branch origin had, before the record shrinks", async () => {
          const { io, ran } = repo(three)
          await ship(io, false)
          const mid = `git config --local ${LEASE("feat/x-middle")} ${O2}`
          const top = `git config --local ${LEASE("feat/x")} ${O}`
          expect(ran()).toContain(mid)
          expect(ran()).toContain(top)
          expect(at(ran, top)).toBeLessThan(at(ran, `git config --local ${KEYS} middle feature`))
          expect(at(ran, mid)).toBeLessThan(at(ran, `git config --local ${KEYS} middle feature`))
        })
        test("a failed write leaves the record untouched and pushes nothing", async () => {
          const { io, ran } = repo({
            ...three,
            [`git config --local ${LEASE("feat/x-middle")} ${O2}`]: { code: 1, err: "locked" },
          })
          const out = await ship(io, false)
          expect(out.text).toContain("git config failed after the restack")
          expect(out.text).toContain("locked")
          expect(ran().some((c) => c.startsWith(`git config --local ${KEYS} `))).toBe(false)
          expect(pushed(ran)).toBe(false)
        })
        test("the one-slice-left restack persists the top's lease too", async () => {
          const { io, ran } = repo(two)
          await ship(io, false)
          expect(ran()).toContain(`git config --local ${LEASE("feat/x")} ${O}`)
        })
        test("a rejected top push, then a ship after a fetch, keeps the old lease and names the unset line", async () => {
          const first = repo({
            ...two,
            [`git push --force-with-lease=feat/x:${O} origin feat/x`]: {
              code: 1,
              err: "stale info",
            },
          })
          expect((await ship(first.io, false)).ok).toBe(false)
          expect(first.ran()).toContain(`git config --local ${LEASE("feat/x")} ${O}`)
          const retry = {
            ...feature,
            "gtd summary": { code: 1 },
            "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
            "git merge-base --is-ancestor HEAD origin/feat/x": { code: 0 },
            [`git config --local --get ${LEASE("feat/x")}`]: { out: `${O}\n` },
            "git ls-remote origin refs/heads/feat/x": { out: `${O}\trefs/heads/feat/x\n` },
            [`git merge-base --is-ancestor ${O} HEAD`]: { code: 1 },
          }
          const rejected = repo({
            ...retry,
            [`git push --force-with-lease=feat/x:${O} origin feat/x`]: {
              code: 1,
              err: "stale info",
            },
          })
          const out = await ship(rejected.io, false)
          expect(out.text).toContain(`git config --local --unset ${LEASE("feat/x")} first.`)
          expect(rejected.ran()).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
          const later = repo(retry, ["feat: add x", "feat: add x\n\nbody"])
          await ship(later.io, false)
          expect(later.ran()).toContain(`git config --local --unset ${LEASE("feat/x")}`)
        })
        test("a ship after the user reconciled leases on origin's sha, not the stale key", async () => {
          const R = "e".repeat(40)
          const { io, ran } = repo({
            ...feature,
            "gtd summary": { code: 1 },
            "git rev-parse --verify --quiet origin/feat/x": { code: 0 },
            "git merge-base --is-ancestor HEAD origin/feat/x": { code: 0 },
            [`git config --local --get ${LEASE("feat/x")}`]: { out: `${O}\n` },
            "git ls-remote origin refs/heads/feat/x": { out: `${R}\trefs/heads/feat/x\n` },
          })
          await ship(io, false)
          expect(ran()).toContain(`git push --force-with-lease=feat/x:${R} origin feat/x`)
          expect(ran()).not.toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
          expect(ran()).toContain(`git config --local --unset ${LEASE("feat/x")}`)
        })
        test("a successful restack push unsets the lease it persisted", async () => {
          const { io, ran } = repo({
            ...two,
            [`git config --local --get ${LEASE("feat/x")}`]: { out: `${O}\n` },
          })
          await ship(io, false)
          const push = `git push --force-with-lease=feat/x:${O} origin feat/x`
          const unset = `git config --local --unset ${LEASE("feat/x")}`
          expect(ran()).toContain(unset)
          expect(at(ran, unset)).toBeGreaterThan(at(ran, push))
        })
        test("a rejected restack push keeps the lease it persisted", async () => {
          const { io, ran } = repo({
            ...two,
            [`git config --local --get ${LEASE("feat/x")}`]: { out: `${O}\n` },
            [`git push --force-with-lease=feat/x:${O} origin feat/x`]: {
              code: 1,
              err: "stale info",
            },
          })
          await ship(io, false)
          expect(ran()).not.toContain(`git config --local --unset ${LEASE("feat/x")}`)
        })
      })

      describe("retired slice names", () => {
        test("a fresh stack may reuse a retired slice's name", async () => {
          const taken = {
            ...sbase,
            "git rev-parse --verify --quiet refs/heads/feat/x-refactor": { out: C1 },
          }
          const refused = repo(taken, writers())
          expect((await ship(refused.io, false)).text).toContain("is not part of a stack gtd built")
          const { io } = repo(
            { ...taken, [`git config --local --get ${RETIRED}`]: { out: "refactor\n" } },
            writers(),
          )
          expect((await ship(io, false)).text).not.toContain("is not part of a stack gtd built")
        })
        test("an ordinary resume with a live record keeps gtdStackRetired", async () => {
          const { io, ran } = repo({
            ...two,
            [`git config --local --get ${RETIRED}`]: { out: "old\n" },
            [`git merge-base --is-ancestor ${C1} origin/main`]: { code: 0 },
          })
          await ship(io, false)
          expect(ran().some((c) => c.includes("--unset") && c.includes(RETIRED))).toBe(false)
        })
      })

      describe("a hand restack of a multi-commit top-only remainder", () => {
        const IDENT = "git log -1 --format=%an%x00%ae%x00%at%x00%B"
        const handTop = {
          ...two,
          [`git merge-base --is-ancestor ${C2} HEAD`]: { code: 1 },
          [`git merge-base --is-ancestor ${C1} refs/heads/feat/x`]: { code: 1 },
          "git merge-base --is-ancestor refs/heads/feat/x~1 origin/main": { code: 1 },
          "git rev-list --reverse origin/main..refs/heads/feat/x": { out: `${N1}\n${S3}\n` },
          [`${IDENT} ${N1}`]: { out: "Ann\x00a@x\x00100\x00feat: top\n" },
          [`${IDENT} ${C2}`]: { out: "Ann\x00a@x\x00100\x00feat: top\n" },
        }
        test("resumes: leased push, retarget, no rebase", async () => {
          const { io, ran } = repo(handTop)
          expect(await ship(io, false)).toMatchObject({ ok: true })
          expect(ran()).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
          expect(ran()).toContain("gh pr edit 8 --base main")
          expect(ran().some((c) => c.startsWith("git rebase"))).toBe(false)
        })
        test("an unrelated rebase of the same shape drops the record and force-pushes nothing", async () => {
          const { io, ran } = repo({
            ...handTop,
            [`${IDENT} ${N1}`]: { out: "Bob\x00b@x\x00200\x00chore: other\n" },
          })
          await ship(io, false)
          expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
          expect(ran()).toContain(`git config --local --unset ${KEYS}`)
        })
        test("a two-slice remainder is never taken as a hand restack", async () => {
          const { io, ran } = repo({
            ...three,
            [`git merge-base --is-ancestor ${S3} HEAD`]: { code: 1 },
            [`git merge-base --is-ancestor ${S1} refs/heads/feat/x-middle`]: { code: 1 },
            "git merge-base --is-ancestor refs/heads/feat/x-middle~1 origin/main": { code: 1 },
            "git rev-list --reverse origin/main..refs/heads/feat/x-middle": {
              out: `${N1}\n${S3}\n`,
            },
            [`${IDENT} ${N1}`]: { out: "Ann\x00a@x\x00100\x00feat: top\n" },
            [`${IDENT} ${S3}`]: { out: "Ann\x00a@x\x00100\x00feat: top\n" },
          })
          await ship(io, false)
          expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
          expect(ran()).toContain(`git config --local --unset ${KEYS}`)
        })
        test("two failed identity reads do not count as a match", async () => {
          const { io, ran } = repo({
            ...handTop,
            [`${IDENT} ${N1}`]: { out: "" },
            [`${IDENT} ${C2}`]: { out: "" },
          })
          await ship(io, false)
          expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
          expect(ran()).toContain(`git config --local --unset ${KEYS}`)
        })
        test("a first commit whose parent is off origin drops the record too", async () => {
          const { io, ran } = repo({
            ...handTop,
            [`git merge-base --is-ancestor ${N1}^ origin/main`]: { code: 1 },
          })
          await ship(io, false)
          expect(ran().some((c) => c.includes("--force-with-lease"))).toBe(false)
        })
      })
    })

    describe("-n", () => {
      test("prints the rebase, each leased push and the retarget; fetches and writes nothing", async () => {
        const { io, ran } = repo(three)
        const out = await ship(io, true)
        expect(out.ok).toBe(true)
        expect(out.text).toContain(REBASE3)
        expect(out.text).toContain(
          `git push --force-with-lease=feat/x-middle:${O2} origin feat/x-middle`,
        )
        expect(out.text).toContain(`git push --force-with-lease=feat/x:${O} origin feat/x`)
        expect(out.text).toContain("Retarget: would retarget #8 from feat/x-refactor to main.")
        expect(out.text.indexOf(REBASE3)).toBeLessThan(out.text.indexOf("[middle]"))
        expect(ran().some((c) => /^git fetch|^git rebase|^git push|^gh pr edit/.test(c))).toBe(
          false,
        )
        expect(ran().some((c) => c.startsWith("git config --local") && !c.includes("--get"))).toBe(
          false,
        )
      })
    })
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
