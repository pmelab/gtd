# Plan: Harden the await-review prompt (issue #28)

## Problem

The `await-review` prompt puts the STOP instruction at the end. An agent can
read the "re-run gtd" instructions in steps 2 and 3, re-run gtd without making
any changes, and auto-approve the review — bypassing human sign-off in ~4 s.

## Work packages

### 1. Update `src/prompts/await-review.md`

Rewrite the file so:

- The ⛔ STOP constraint is the **first thing** the agent reads — before the
  task heading, before any user-facing instructions
- The constraint spells out the exact consequence: running gtd now with a clean
  tree auto-approves the review and commits `gtd: done` without human input
- The user instructions (steps 1–3) follow unchanged

New content:

```markdown
⛔ **STOP — do not re-run `gtd`.** Running `gtd` now with no edits will
auto-approve the review and commit `gtd: done` without human input. Only the
user may resume this step.

## Task: Await the user's review

`REVIEW.md` has been committed (`gtd: awaiting review`). This is a human gate —
there is nothing for the agent to do.

Tell the user to:

1. Read `REVIEW.md` and walk through each chunk, inspecting the referenced
   files.
2. **To approve** — re-run gtd with **no** changes **or after only checking off
   REVIEW.md checkboxes**. gtd treats checkbox-only edits as approval and
   finishes the review (`gtd: done`).
3. **To request changes** — edit the code, leave inline comments, or make
   non-checkbox textual edits to `REVIEW.md`, then re-run gtd. gtd captures
   those changes as the seed of a new plan and re-enters grilling.
```

### 2. Add/update tests in `src/Prompt.test.ts`

The existing test at line 84 checks for `"Await the user's review"` — that
heading is preserved, so no change needed there.

Add a new test (alongside the existing
`await-review renders the await-review section` test) that asserts the hardened
constraint appears and precedes the task heading:

```typescript
it("await-review leads with the STOP constraint", () => {
  const out = buildPrompt(result("await-review"))
  expect(out).toContain("STOP — do not re-run `gtd`")
  expect(out).toContain("auto-approve the review")
  // constraint must appear before the task heading
  expect(out.indexOf("STOP — do not re-run")).toBeLessThan(
    out.indexOf("Await the user's review"),
  )
})
```

No other test changes are needed: the existing assertions at lines 345-346
(`not.toContain("Re-run gtd immediately")`) already cover the STOP-state
invariant, and the `{{MODEL}}` / STOP-state tests at line 178–185 are
unaffected.

no open questions — run gtd to plan
