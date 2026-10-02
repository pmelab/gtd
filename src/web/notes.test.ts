import { describe, expect, it } from "vitest"
import type { SteeringAnchor, SteeringViewNode } from "../steering/index.js"
import { existingNoteFor, withReply } from "./notes.js"

const paragraph = (line: number, note?: string): SteeringViewNode => ({
  title: `line ${line}`,
  anchor: { kind: "paragraph", line },
  ...(note !== undefined ? { note } : {}),
})

const at = (line: number): SteeringAnchor => ({ kind: "paragraph", line })

describe("existingNoteFor", () => {
  it("prefers a locally-saved override over the file's own note", () => {
    expect(existingNoteFor([paragraph(4, "from the file")], at(4), { 4: "just typed" })).toBe(
      "just typed",
    )
  })

  it("finds a note on a block riding in another node's body, not just the top level", () => {
    const question: SteeringViewNode = {
      title: "Which option?",
      anchor: { kind: "question", index: 0 },
      body: [paragraph(9, "body block note")],
    }
    expect(existingNoteFor([question], at(9), {})).toBe("body block note")
  })

  it("has nothing to pre-fill for a non-paragraph anchor", () => {
    expect(
      existingNoteFor([paragraph(1, "x")], { kind: "chunk", index: 0 }, { 1: "y" }),
    ).toBeUndefined()
  })
})

const open: SteeringViewNode["thread"] = {
  name: "t",
  entries: [
    { author: "me", text: "ask" },
    { author: "agent", text: "which?" },
  ],
  waitingOn: "human",
}
const waiting: SteeringViewNode["thread"] = {
  name: "t",
  entries: [{ author: "me", text: "ask" }],
  waitingOn: "agent",
}
const withThread = (
  anchor: SteeringAnchor,
  thread: SteeringViewNode["thread"],
): SteeringViewNode => ({
  title: "n",
  anchor,
  thread: thread!,
})

describe("existingNoteFor — threads", () => {
  it("opens empty for a reply to an open thread", () => {
    expect(existingNoteFor([withThread(at(3), open)], at(3), {})).toBe("")
  })

  it("prefills the last `- H:` text of a thread waiting on the agent", () => {
    expect(existingNoteFor([withThread(at(3), waiting)], at(3), {})).toBe("ask")
  })

  it("finds a thread on a chunk, a hunk and a question anchor", () => {
    const hunk: SteeringAnchor = { kind: "hunk", chunkIndex: 0, index: 0 }
    const chunk: SteeringAnchor = { kind: "chunk", index: 0 }
    const nodes: SteeringViewNode[] = [
      { ...withThread(chunk, waiting), children: [withThread(hunk, open)] },
      withThread({ kind: "question", index: 1 }, waiting),
    ]
    expect(existingNoteFor(nodes, chunk, {})).toBe("ask")
    expect(existingNoteFor(nodes, hunk, {})).toBe("")
    expect(existingNoteFor(nodes, { kind: "question", index: 1 }, {})).toBe("ask")
  })
})

describe("withReply", () => {
  it("appends an H entry to an open thread", () => {
    expect(withReply(open!, "answer").entries.map((e) => e.text)).toEqual([
      "ask",
      "which?",
      "answer",
    ])
    expect(withReply(open!, "answer").waitingOn).toBe("agent")
  })

  it("replaces the last H entry of a thread waiting on the agent", () => {
    expect(withReply(waiting!, "better").entries).toEqual([{ author: "me", text: "better" }])
  })
})
