import { describe, expect, it } from "vitest"
import { notes, type NotesDeps } from "./Notes.js"

describe("notes", () => {
  it("keeps humanRest when an error note turns a gate into an error", () => {
    const deps = {
      store: {
        notes: () => ({ "/w": { message: "ship failed", error: true } }),
      },
      projects: () => [],
      audit: { write: () => undefined },
      now: () => 0,
    } as unknown as NotesDeps
    const status = notes(deps).withNote("/w", {
      status: "needsYou",
      label: "Review",
      humanRest: true,
    })
    expect(status).toMatchObject({
      status: "error",
      errorKind: "note",
      humanRest: true,
    })
  })
})
