import { describe, expect, test } from "vitest"

import {
  answers,
  prAction,
  currentPr,
  decided,
  missingReasons,
  reply,
  replyText,
  threadNote,
  unresolvedThreads,
  withThreads,
} from "./pr"
import type { Thread } from "./pr"
import type { Ran, ShipIo } from "./ship"

const repo = (script: Record<string, Partial<Ran>>) => {
  const calls: string[][] = []
  const io: ShipIo = {
    run: async (argv) => {
      calls.push(argv)
      const key = Object.keys(script).find((k) => argv.join(" ").startsWith(k))
      return { code: 0, out: "", err: "", ...(key === undefined ? {} : script[key]) }
    },
    complete: async () => undefined,
    log: () => {},
    today: () => "2026-10-20",
  }
  return { calls, io }
}

const pr = {
  host: "ghe.example.com",
  owner: "o",
  name: "r",
  number: 7,
  url: "https://ghe.example.com/o/r/pull/7",
  branch: "feat",
}

const thread: Thread = {
  id: "PRRT_1",
  path: "src/calc.ts",
  line: 3,
  comments: [{ author: "alice", body: "Annotate the return type.", url: "https://c/1" }],
}

const REVIEW = "# Review: abc1234\n\n<!-- base: abc1234 -->\n\n## Nothing to note\n\nReview it.\n"

const decide = (review: string, from: string, to: string) => review.replace(from, to)

describe("currentPr", () => {
  test("reads the branch's pull request from gh", async () => {
    const { io } = repo({
      "git rev-parse --abbrev-ref HEAD": { out: "feat\n" },
      "gh pr view": { out: JSON.stringify({ number: 7, url: pr.url }) },
    })
    expect(await currentPr(io)).toEqual(pr)
  })

  test("a branch without one is refused with gh's words", async () => {
    const { io } = repo({ "gh pr view": { code: 1, err: "no pull requests found\n" } })
    expect(await currentPr(io)).toBe("gh pr view failed: no pull requests found")
  })
})

describe("import", () => {
  test("only unresolved threads are read, with every comment", async () => {
    const nodes = [
      {
        id: "PRRT_1",
        isResolved: false,
        path: "src/calc.ts",
        line: null,
        originalLine: 3,
        comments: { nodes: [{ author: { login: "alice" }, body: "Annotate.", url: "u1" }] },
      },
      {
        id: "PRRT_2",
        isResolved: true,
        path: "a",
        line: 1,
        originalLine: 1,
        comments: { nodes: [] },
      },
    ]
    const out = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes } } } },
    })
    const { calls, io } = repo({ "gh api graphql": { out } })
    expect(await unresolvedThreads(io, pr)).toEqual([
      {
        id: "PRRT_1",
        path: "src/calc.ts",
        line: 3,
        comments: [{ author: "alice", body: "Annotate.", url: "u1" }],
      },
    ])
    expect(calls[0]).toEqual(
      expect.arrayContaining(["--hostname", "ghe.example.com", "owner=o", "name=r", "number=7"]),
    )
  })

  test("a thread becomes a note tagged with its id, pre-ticked fix as suggested", () => {
    expect(threadNote(thread)).toBe(
      [
        "## src/calc.ts:3 (thread PRRT_1)",
        "",
        "**@alice** ([comment](https://c/1)):",
        "",
        "> Annotate the return type.",
        "",
        "From the pull request. To decline it, tick won't fix and write your reason after it on that line.",
        "",
        "Tick exactly one:",
        "",
        "- [x] fix as suggested",
        "- [ ] won't fix",
        "- [ ] _your answer_",
      ].join("\n"),
    )
  })

  test("a comment's own boxes, footnotes and headings stay inside its quote", () => {
    const tricky = {
      ...thread,
      comments: [{ author: "a", body: "## Big\n- [ ] todo\nsee [^1] <!-- base: x -->", url: "u" }],
    }
    expect(threadNote(tricky)).toContain(
      "> ## Big\n> - \\[ \\] todo\n> see &#91;^1] &lt;!-- base: x -->",
    )
    expect(answers(withThreads(REVIEW, [tricky]))).toMatchObject([{ choice: "fix" }])
  })

  test("a code span stays verbatim", () => {
    const note = threadNote({
      ...thread,
      comments: [{ author: "a", body: "use `/[^a-z]/` over [^1]", url: "u" }],
    })
    expect(note).toContain("> use `/[^a-z]/` over &#91;^1]")
  })

  test("a suggestion's code stays verbatim; a quoted checklist is escaped too", () => {
    const note = threadNote({
      ...thread,
      comments: [
        {
          author: "a",
          body: "```suggestion\nconst re = /[^a-z]/\n- [ ] item\n```\n> - [ ] quoted",
          url: "u",
        },
      ],
    })
    expect(note).toContain("> ```suggestion\n> const re = /[^a-z]/\n> - [ ] item\n> ```")
    expect(note).toContain("> > - \\[ \\] quoted")
    const info = threadNote({
      ...thread,
      comments: [{ author: "a", body: "````md\n```js\n[^x]\n```\n````\n- [ ] after", url: "u" }],
    })
    expect(info).toContain("> [^x]")
    expect(info).toContain("> - \\[ \\] after")
  })

  test("is appended to the review once: a thread it holds is not added again", () => {
    const once = withThreads(REVIEW, [thread])
    expect(once.startsWith(REVIEW.trimEnd())).toBe(true)
    expect(withThreads(once, [thread])).toBe(once)
    expect(answers(once)).toEqual([
      { thread: "PRRT_1", title: "src/calc.ts:3 (thread PRRT_1)", choice: "fix", text: "" },
    ])
  })
})

describe("won't fix", () => {
  const imported = withThreads(REVIEW, [thread])
  const declined = (label: string) =>
    decide(
      decide(imported, "- [x] fix as suggested", "- [ ] fix as suggested"),
      "- [ ] won't fix",
      `- [x] ${label}`,
    )

  test("needs a reason", () => {
    expect(missingReasons(declined("won't fix"))).toEqual([
      `.gtd/REVIEW.md: "src/calc.ts:3 (thread PRRT_1)": write the reason after "won't fix" on that line.`,
    ])
    expect(missingReasons(imported)).toEqual([])
  })

  test("its reason is the text after it, a wrapped line included", () => {
    expect(answers(declined("won't fix: out of scope"))[0]).toMatchObject({
      choice: "wontfix",
      text: "out of scope",
    })
    expect(answers(declined("won't fix — out of\n  scope for this PR"))[0]!.text).toBe(
      "out of scope for this PR",
    )
    expect(answers(declined("won't fix\nout of scope"))[0]!.text).toBe("out of scope")
    expect(missingReasons(declined("won't fix: out of scope"))).toEqual([])
  })

  test("replies with the reason", () => {
    const [a] = answers(declined("won't fix: out of scope"))
    expect(replyText(a!, "abc")).toBe("Won't fix: out of scope")
    // a gate landed outside the mod skipped its reason check
    expect(replyText({ ...a!, text: "" }, undefined)).toBe("Won't fix.")
  })
})

describe("reply", () => {
  test("names the fixing commit; an own answer is its text", () => {
    const fix = { thread: "t", title: "x", choice: "fix" as const, text: "" }
    expect(replyText(fix, "c1")).toBe("Fixed in c1.")
    expect(replyText(fix, undefined)).toBe("Fixed as suggested; the fix changed no code.")
    const own = { ...fix, choice: "answer" as const, text: "renamed instead" }
    expect(replyText(own, "c1")).toBe("renamed instead")
  })

  test("a history moved since the import finds no gate", async () => {
    const { io } = repo({ "git merge-base --is-ancestor base HEAD": { code: 1 } })
    expect(await decided(io, "base", ["PRRT_1"])).toBe("gone")
  })

  test("the gate that answered the threads is found after the import", async () => {
    const answered = withThreads(REVIEW, [thread])
    const { io } = repo({
      "git log --reverse --first-parent --format=%H base..HEAD": { out: "c1\nc2\nc3\n" },
      "git show c1:": { out: REVIEW },
      "git show c2:": { out: answered },
    })
    expect(await decided(io, "base", ["PRRT_1"])).toEqual({
      gate: "c2",
      answers: answers(answered),
    })
    expect(await decided(io, "base", ["PRRT_9"])).toBeUndefined()
  })

  test("pushes, replies naming the code commits after the gate, and resolves", async () => {
    const { calls, io } = repo({
      "git rev-parse --abbrev-ref HEAD": { out: "feat\n" },
      "git rev-parse --verify --quiet origin/feat": { code: 0 },
      "git log --reverse --first-parent --format=%H gate..HEAD": { out: "f1\nf2\n" },
    })
    const [a] = answers(withThreads(REVIEW, [thread]))
    expect(await reply(io, "github.com", "gate", [a!])).toEqual({
      ok: true,
      text: "Replied to and resolved 1 review thread(s).",
      isPushed: true,
    })
    const gh = calls
      .filter((c) => c[0] === "gh")
      .map((c) => c.filter((x) => !x.startsWith("query=")))
    expect(gh).toEqual([
      [
        "gh",
        "api",
        "graphql",
        "--hostname",
        "github.com",
        "-f",
        "-f",
        "thread=PRRT_1",
        "-f",
        "body=Fixed in f1.",
      ],
      ["gh", "api", "graphql", "--hostname", "github.com", "-f", "-f", "thread=PRRT_1"],
    ])
    expect(calls.findIndex((c) => c[1] === "push")).toBeLessThan(
      calls.findIndex((c) => c[0] === "gh"),
    )
  })

  test("a failed push replies to nothing", async () => {
    const { calls, io } = repo({
      "git rev-parse --abbrev-ref HEAD": { out: "feat\n" },
      "git rev-parse --verify --quiet origin/feat": { code: 1 },
      "git push": { code: 1, err: "denied" },
    })
    const [a] = answers(withThreads(REVIEW, [thread]))
    expect(await reply(io, "github.com", "gate", [a!])).toMatchObject({
      ok: false,
      isPushed: false,
    })
    expect(calls.some((c) => c[0] === "gh")).toBe(false)
  })

  test("a thread that fails is named and left open", async () => {
    const { io } = repo({
      "git rev-parse --abbrev-ref HEAD": { out: "feat\n" },
      "gh api graphql": { code: 1, err: "nope" },
    })
    const [a] = answers(withThreads(REVIEW, [thread]))
    expect(await reply(io, "github.com", "gate", [a!])).toEqual({
      ok: false,
      text: "Replied to and resolved 0 review thread(s).\nThese failed and stay open:\n- src/calc.ts:3 (thread PRRT_1)",
      isPushed: true,
    })
  })
})

describe("prAction", () => {
  const pending = { threads: [thread], host: "github.com", branch: "feat" }
  const imported = { ...pending, importedAt: "c0" }
  const at = (over: Partial<{ isReviewGate: boolean; isDone: boolean; branch: string }>) => ({
    isReviewGate: false,
    isDone: false,
    branch: "feat",
    ...over,
  })

  test("imports at the first review gate, and drops threads no review gate reached", () => {
    expect(prAction(pending, at({}))).toBe("none")
    expect(prAction(pending, at({ isReviewGate: true }))).toBe("import")
    expect(prAction(pending, at({ isDone: true }))).toBe("forget")
  })

  test("replies at the next review gate or the end", () => {
    expect(prAction(imported, at({}))).toBe("none")
    expect(prAction(imported, at({ isReviewGate: true }))).toBe("reply")
    expect(prAction(imported, at({ isDone: true }))).toBe("reply")
  })

  test("another branch's threads are dropped, never imported or answered", () => {
    expect(prAction(pending, at({ isReviewGate: true, branch: "other" }))).toBe("forget")
    expect(prAction(imported, at({ isDone: true, branch: "other" }))).toBe("forget")
    expect(prAction(undefined, at({ isReviewGate: true }))).toBe("none")
  })
})
