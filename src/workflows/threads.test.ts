import { afterEach, describe, expect, it } from "vitest"
import {
  hasThreadFor,
  installContext,
  requireReplies,
  requireThreadsClosed,
  type CodeThreadInfo,
  type ThreadInfo,
} from "../flows/index.js"

const withThreads = (
  list: readonly ThreadInfo[],
  run: () => void,
  code: readonly CodeThreadInfo[] = [],
): void => {
  installContext({
    refuse: (message: string): never => {
      throw new Error(message)
    },
    read: () => "doc",
    threads: () => list,
    codeThreads: () => code,
  } as never)
  run()
}

afterEach(() => installContext(undefined))

const open: ThreadInfo = { name: "a", line: 3, waitingOn: "human" }
const asked: ThreadInfo = { name: "b", line: 9, waitingOn: "agent" }

describe("requireThreadsClosed", () => {
  it("refuses while any thread waits on the human, naming each", () => {
    withThreads([open, asked, { name: "c", line: 12, waitingOn: "human" }], () => {
      expect(() => requireThreadsClosed("f.md")).toThrow(/f\.md:3: \[\^a\][\s\S]*f\.md:12: \[\^c\]/)
      expect(() => requireThreadsClosed("f.md")).toThrow(/reply with a conclusion, or delete/)
    })
  })

  it("passes with no open thread", () => {
    withThreads([asked], () => expect(() => requireThreadsClosed("f.md")).not.toThrow())
  })
})

describe("requireReplies", () => {
  it("refuses while any thread waits on the agent, naming each", () => {
    withThreads([open, asked], () => {
      expect(() => requireReplies("f.md")).toThrow(/f\.md:9: \[\^b\]/)
    })
  })

  it("passes when every thread has the agent's reply", () => {
    withThreads([open], () => expect(() => requireReplies("f.md")).not.toThrow())
  })
})

const codeOpen: CodeThreadInfo = {
  path: "src/a.ts",
  line: 7,
  waitingOn: "human",
  first: "why?",
  faults: [],
}
const codeAsked: CodeThreadInfo = { ...codeOpen, line: 20, waitingOn: "agent", first: "how?" }
const codeFaulty: CodeThreadInfo = {
  ...codeOpen,
  line: 30,
  first: "x",
  faults: ['Code thread at src/a.ts:30: two consecutive "H:" entries'],
}

describe("code threads at the gates", () => {
  it("an open code thread refuses landing, naming path:line and first entry", () => {
    withThreads(
      [],
      () => expect(() => requireThreadsClosed("f.md")).toThrow(/src\/a\.ts:7: why\?/),
      [codeOpen, codeAsked],
    )
  })

  it("a code thread waiting on the agent does not refuse landing", () => {
    withThreads([], () => expect(() => requireThreadsClosed("f.md")).not.toThrow(), [codeAsked])
  })

  it("a code thread waiting on the agent refuses an agent turn, naming path:line", () => {
    withThreads(
      [],
      () => {
        expect(() => requireReplies("f.md")).toThrow(/src\/a\.ts:20: how\?/)
        expect(() => requireReplies("f.md")).toThrow(/one "A:" comment line/)
      },
      [codeOpen, codeAsked],
    )
  })

  it("a fault refuses both ways", () => {
    withThreads([], () => expect(() => requireThreadsClosed("f.md")).toThrow(/src\/a\.ts:30/), [
      codeFaulty,
    ])
    withThreads([], () => expect(() => requireReplies("f.md")).toThrow(/two consecutive/), [
      codeFaulty,
    ])
  })

  it("hasThreadFor combines footnote and code threads", () => {
    withThreads([], () => expect(hasThreadFor("agent", "f.md")).toBe(true), [codeAsked])
    withThreads([asked], () => expect(hasThreadFor("agent", "f.md")).toBe(true))
    withThreads([open], () => expect(hasThreadFor("agent", "f.md")).toBe(false), [codeOpen])
    withThreads([open], () => expect(hasThreadFor("human")).toBe(false))
  })
})
