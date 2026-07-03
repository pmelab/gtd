# Add Events unit tests for SQUASH_MSG.md gather and squashCommit perform

File: `src/Events.test.ts`

## Part A — gatherEvents: squashMsgPresent / squashMsgContent

Add a new `describe` block inside the existing
`describe("gatherEvents — squash payload ...", ...)` block (after the last
`it(...)` case at ~line 830, before the closing `},`).

```typescript
it("SQUASH_MSG.md present → squashMsgPresent true, squashMsgContent matches file", async () => {
  initRepo(true)
  commitFile("gtd: grilling", "TODO.md", "# Plan\n")
  git("rm", "-q", "TODO.md")
  git("commit", "-q", "-m", "gtd: planning")
  commitFile("feat: work", "work.ts", "export const work = 1\n")
  git("commit", "--allow-empty", "-q", "-m", "gtd: done")
  const msg = "feat: add work\n\nDecision: keep it simple.\n"
  writeFileSync(join(repoDir, "SQUASH_MSG.md"), msg)

  const p = resolveOf(await runGather({ squash: true }))
  expect(p.squashMsgPresent).toBe(true)
  expect(p.squashMsgContent).toBe(msg)
})

it("SQUASH_MSG.md absent → squashMsgPresent false, squashMsgContent empty", async () => {
  initRepo(true)
  commitFile("gtd: grilling", "TODO.md", "# Plan\n")
  git("rm", "-q", "TODO.md")
  git("commit", "-q", "-m", "gtd: planning")
  commitFile("feat: work", "work.ts", "export const work = 1\n")
  git("commit", "--allow-empty", "-q", "-m", "gtd: done")

  const p = resolveOf(await runGather({ squash: true }))
  expect(p.squashMsgPresent).toBe(false)
  expect(p.squashMsgContent).toBe("")
})

it("SQUASH_MSG.md excluded from codeDirty (not treated as a code change)", async () => {
  initRepo(true)
  commitFile("gtd: grilling", "TODO.md", "# Plan\n")
  git("rm", "-q", "TODO.md")
  git("commit", "-q", "-m", "gtd: planning")
  commitFile("feat: work", "work.ts", "export const work = 1\n")
  git("commit", "--allow-empty", "-q", "-m", "gtd: done")
  writeFileSync(join(repoDir, "SQUASH_MSG.md"), "feat: add work\n")

  const p = resolveOf(await runGather({ squash: true }))
  // SQUASH_MSG.md is in STEERING_FILES so it must not set codeDirty
  expect(p.codeDirty).toBe(false)
})
```

## Part B — perform: squashCommit

Add a new `it(...)` inside the existing
`describe("perform — EdgeAction execution", ...)` block, after the last test.

```typescript
it("squashCommit: removes SQUASH_MSG.md, soft-resets to squashBase, re-commits with message", async () => {
  // Build a minimal feature cycle
  commitFile("gtd: grilling", "TODO.md", "# Plan\n")
  git("rm", "-q", "TODO.md")
  git("commit", "-q", "-m", "gtd: planning")
  commitFile("feat: work", "work.ts", "export const work = 1\n")
  const doneHash = git(
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "gtd: done",
  ).trim()
  // Resolve squashBase = parent of gtd: grilling
  const grillingHash = git(
    "log",
    "--format=%H",
    "--reverse",
    "--grep=gtd: grilling",
  )
    .split("\n")[0]!
    .trim()
  const squashBase = git("rev-parse", `${grillingHash}~1`).trim()

  // Write the squash message file
  writeFileSync(join(repoDir, "SQUASH_MSG.md"), "feat: add work\n\nbody\n")

  await runPerform({
    kind: "squashCommit",
    squashBase,
    commitMessage: "feat: add work\n\nbody",
  })

  // SQUASH_MSG.md must be gone
  expect(existsSync(join(repoDir, "SQUASH_MSG.md"))).toBe(false)
  // HEAD subject must match the authored message
  expect(git("log", "-1", "--format=%s")).toBe("feat: add work")
  // HEAD body must include "body"
  expect(git("log", "-1", "--format=%b").trim()).toBe("body")
  // squashBase must be the parent of the new HEAD (all intermediate commits squashed)
  expect(git("rev-parse", "HEAD~1")).toBe(squashBase)
  // work.ts must be present in the commit (squash preserved the change)
  expect(git("diff", "--name-only", `${squashBase}..HEAD`)).toContain("work.ts")
  // SQUASH_MSG.md must NOT appear in the squash commit's diff
  expect(git("diff", "--name-only", `${squashBase}..HEAD`)).not.toContain(
    "SQUASH_MSG.md",
  )
})
```

## Notes

- `initRepo(false)` is already called in `beforeEach` for the perform describe
  block, so do not call it again inside the test.
- `commitFile` creates the commit in one step; `git("rev-parse", ...)` resolves
  the hash for squashBase calculation.
- The `runPerform` helper is already defined in the test file; no new imports
  needed.
- `existsSync` and `join` are already imported at the top of the file.
