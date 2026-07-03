# Add machine unit tests for squashMsgPresent behaviour

File: `src/Machine.test.ts`

## Where to add

Append to the existing `describe("rule 7 — Squashing", ...)` block (after the
last test at ~line 663, before the closing `})`).

## Tests to add

```typescript
it("squashing + squashMsgPresent: true → squashCommit edgeAction with squashBase + commitMessage", () => {
  const res = r({
    lastCommitSubject: "gtd: done",
    squashEnabled: true,
    squashBase: "abc123",
    squashMsgPresent: true,
    squashMsgContent:
      "feat: add calculator\n\nDecided during grilling to use simple addition.",
  })
  expect(res.state).toBe("squashing")
  expect(res.autoAdvance).toBe(true)
  expect(res.edgeAction).toEqual({
    kind: "squashCommit",
    squashBase: "abc123",
    commitMessage:
      "feat: add calculator\n\nDecided during grilling to use simple addition.",
  })
})

it("squashing + squashMsgPresent: false → no edgeAction, autoAdvance false (prompt agent)", () => {
  const res = r({
    lastCommitSubject: "gtd: done",
    squashEnabled: true,
    squashBase: "abc123",
    squashMsgPresent: false,
  })
  expect(res.state).toBe("squashing")
  expect(res.autoAdvance).toBe(false)
  expect(res.edgeAction).toBeUndefined()
})
```

## Note on `r` helper

The existing tests use a local `r` helper alias for `resolve` with a
`basePayload` wrapper. Check the top of the
`describe("rule 7 — Squashing", ...)` block for the exact helper name used. Both
`squashMsgPresent` and `squashMsgContent` are new fields on `ResolvePayload`;
because tests spread-override `DEFAULT_PAYLOAD` (via `basePayload`), and
`DEFAULT_PAYLOAD` will have `squashMsgPresent: false` and
`squashMsgContent: ""`, the existing tests remain unaffected.
