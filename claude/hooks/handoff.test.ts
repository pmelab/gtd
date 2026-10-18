import { describe, expect, test } from "vitest"

import { catchFrom, throwTo } from "./handoff"
import { ship, THROWN } from "./ship"
import type { Ran, ShipIo } from "./ship"

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
  return { calls, io, ran: () => calls.map((c) => c.argv) }
}

const rest = {
  state: "design.await-answers",
  label: "Answer the questions",
  content: "Q1?",
  isIdle: false,
}
const NOW = "2026-10-03T09:41:00.000Z"
const onMain = {
  "git rev-parse --abbrev-ref HEAD": { out: "main\n" },
  "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { out: "origin/main\n" },
  "git rev-parse --verify --quiet origin/gtd/20261003-0941": { code: 1 },
}

describe("throw", () => {
  test("moves a process off the default branch into an assigned draft pull request", async () => {
    const { calls, io, ran } = repo({
      ...onMain,
      "gh pr view gtd/20261003-0941 --json number,url,state,body,assignees": { code: 1 },
      [`gh pr create --draft --head gtd/20261003-0941 --base main --title wip: gtd/20261003-0941 — Answer the questions --body-file -`]:
        { out: "https://github.com/o/r/pull/9\n" },
    })
    expect(await throwTo(io, rest, "@dev", NOW)).toEqual({
      ok: true,
      text: "Thrown to @dev: https://github.com/o/r/pull/9",
    })
    expect(ran()).toContain("git switch -c gtd/20261003-0941")
    expect(ran()).toContain("git push --set-upstream origin gtd/20261003-0941")
    expect(ran()).toContain("gh pr edit 9 --add-assignee dev")
    const body = calls.find((c) => c.argv.startsWith("gh pr create"))?.stdin ?? ""
    expect(body.startsWith(THROWN)).toBe(true)
    expect(body).toContain("/gtd catch gtd/20261003-0941")
  })

  test("re-throwing reassigns the open draft instead of opening another", async () => {
    const pr = {
      number: 9,
      url: "u",
      state: "OPEN",
      body: `${THROWN}\nold`,
      assignees: [{ login: "pm" }],
    }
    const { ran } = await (async () => {
      const r = repo({
        "git rev-parse --abbrev-ref HEAD": { out: "gtd/x\n" },
        "gh pr view gtd/x --json number,url,state,body,assignees": { out: JSON.stringify(pr) },
      })
      await throwTo(r.io, rest, "dev", NOW)
      return r
    })()
    expect(ran()).toContain("gh pr edit 9 --body-file -")
    expect(ran()).toContain("gh pr edit 9 --add-assignee dev --remove-assignee pm")
    expect(ran().some((c) => c.startsWith("gh pr create"))).toBe(false)
  })

  test("a pull request opened for review keeps its description and stays ready", async () => {
    const pr = { number: 9, url: "u", state: "OPEN", body: "the motivation", assignees: [] }
    const { io, ran } = repo({
      "git rev-parse --abbrev-ref HEAD": { out: "gtd/x\n" },
      "gh pr view gtd/x --json number,url,state,body,assignees": { out: JSON.stringify(pr) },
    })
    expect(await throwTo(io, rest, undefined, NOW)).toMatchObject({ ok: true })
    expect(ran()).not.toContain("gh pr edit 9 --body-file -")
    expect(ran()).not.toContain("gh pr ready 9 --undo")
  })

  test("refuses when origin holds commits HEAD lacks", async () => {
    const { io, ran } = repo({
      "git rev-parse --abbrev-ref HEAD": { out: "gtd/x\n" },
      "git merge-base --is-ancestor origin/gtd/x HEAD": { code: 1 },
    })
    expect(await throwTo(io, rest, undefined, NOW)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/has commits HEAD lacks/),
    })
    expect(ran()).toContain("git fetch --prune origin")
    expect(ran().some((c) => c.startsWith("git push") || c.startsWith("gh pr"))).toBe(false)
  })

  test("only landed state travels", async () => {
    const { io, ran } = repo({ "git status --porcelain": { out: " M .gtd/QA.md\n" } })
    expect(await throwTo(io, rest, undefined, NOW)).toMatchObject({ ok: false })
    expect(ran().some((c) => c.startsWith("git push"))).toBe(false)
  })

  test("an idle repository has nothing to throw", async () => {
    const { io } = repo({})
    expect(await throwTo(io, { isIdle: true }, undefined, NOW)).toMatchObject({ ok: false })
  })
})

describe("throw failures name their step", () => {
  const view = "gh pr view gtd/x --json number,url,state,body,assignees"
  const thrown = {
    number: 9,
    url: "u",
    state: "OPEN",
    body: `${THROWN}\nold`,
    assignees: [],
  }
  const onBranch = { "git rev-parse --abbrev-ref HEAD": { out: "gtd/x\n" } }

  test("a failing git push fails the throw", async () => {
    const { io } = repo({
      ...onBranch,
      "git push --set-upstream origin gtd/x": { code: 1 },
      "git rev-parse --verify --quiet origin/gtd/x": { code: 1 },
    })
    expect(await throwTo(io, rest, undefined, NOW)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/git push/),
    })
  })

  test("a failing gh pr create fails the throw", async () => {
    const { io } = repo({ ...onBranch, [view]: { code: 1 }, "gh pr create": { code: 0 } })
    const failing: ShipIo = {
      ...io,
      run: async (argv, stdin) =>
        argv.slice(0, 3).join(" ") === "gh pr create"
          ? { code: 1, out: "", err: "denied" }
          : io.run(argv, stdin),
    }
    expect(await throwTo(failing, rest, undefined, NOW)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/gh pr create/),
    })
  })

  test("a failing gh pr edit refreshing a thrown draft fails the throw", async () => {
    const { io } = repo({
      ...onBranch,
      [view]: { out: JSON.stringify(thrown) },
      "gh pr edit 9 --body-file -": { code: 1, err: "denied" },
    })
    expect(await throwTo(io, rest, undefined, NOW)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/gh pr edit/),
    })
  })

  test("a failing gh pr ready --undo on a thrown draft fails the throw", async () => {
    const { io } = repo({
      ...onBranch,
      [view]: { out: JSON.stringify(thrown) },
      "gh pr ready 9 --undo": { code: 1, err: "denied" },
    })
    expect(await throwTo(io, rest, undefined, NOW)).toMatchObject({
      ok: false,
      text: expect.stringMatching(/gh pr ready/),
    })
  })

  test("a failing gh pr comment still completes the throw, with a warning", async () => {
    const { io } = repo({
      ...onBranch,
      [view]: { out: JSON.stringify({ ...thrown, body: "mine" }) },
      "gh pr comment 9 --body-file -": { code: 1, err: "denied" },
    })
    expect(await throwTo(io, rest, undefined, NOW)).toMatchObject({
      ok: true,
      text: expect.stringMatching(/Thrown to anyone: u[\s\S]*gh pr comment failed/),
    })
  })
})

describe("catch", () => {
  test("checks the thrown branch out and takes it over", async () => {
    const { io, ran } = repo({
      "gh pr view 9 --json number,url": { out: JSON.stringify({ number: 9, url: "u" }) },
    })
    expect(await catchFrom(io, "9")).toEqual({ ok: true, text: "Caught u" })
    expect(ran()).toEqual([
      "git status --porcelain",
      "gh pr checkout 9",
      "gh pr view 9 --json number,url",
      "gh pr edit 9 --add-assignee @me",
      "gh pr comment 9 --body Caught.",
    ])
  })

  test("refuses over local edits", async () => {
    const { io, ran } = repo({ "git status --porcelain": { out: "?? x\n" } })
    expect(await catchFrom(io, "9")).toMatchObject({ ok: false })
    expect(ran()).not.toContain("gh pr checkout 9")
  })
})

test("ship describes a thrown draft properly and marks it ready", async () => {
  const pr = { number: 9, url: "u", state: "OPEN", body: `${THROWN}\nwaiting`, title: "wip" }
  const { calls, io, ran } = repo(
    {
      "git rev-parse --abbrev-ref HEAD": { out: "gtd/x\n" },
      "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { out: "origin/main\n" },
      "gtd summary": { code: 1 },
      "git merge-base main HEAD": { out: "m" },
      "git rev-parse HEAD": { out: "h" },
      "gh pr view --json number,title,body,url,state,baseRefName": { out: JSON.stringify(pr) },
    },
    ["feat: add x\n\nwhy"],
  )
  expect(await ship(io, false)).toMatchObject({ ok: true })
  expect(
    calls.find((c) => c.argv === "gh pr edit 9 --title feat: add x --body-file -")?.stdin,
  ).toBe("why\n")
  expect(ran()).toContain("gh pr ready 9")
})
