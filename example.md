# gtd — worked example

"U" marks user actions, "A" marks agent actions.

A complete cycle walking a feature through the 16-state machine, from raw input
to an approved review. Each step shows the `gtd: <phase>` commit subject it
lands, the state resolved, and which actor acts next.

---

## New Feature

U makes code changes (or creates a rough TODO.md) on a clean baseline, then
runs `gtd`:

- A resolves: boundary HEAD + pending changes → **New Feature** (edge-only)
- A commits raw input: `gtd: new task`
- A reverts the commit back into the working tree (uncommitted), seeds `TODO.md`
  from the diff
- A auto-advances → Grilling (TODO.md present + pending changes)

---

## Grilling — first round

- A resolves: TODO.md present, no marker yet, pending changes →
  **Grilling (iterate)** (edge-only commit + prompt)
- A commits reverted code + seeded TODO.md: `gtd: grilling`
- A grilling agent develops the plan, adds `<!-- user answers here -->` markers
  for unresolved questions, re-runs `gtd`

- A resolves: TODO.md present, marker found → **Grilling (STOP)**
- A commits agent's TODO.md edits: `gtd: grilling`
- A emits: STOP — answer the open questions inline in `TODO.md`

---

## Grilling — user answers

U opens TODO.md, fills in the answers, removes the `<!-- user answers here -->`
sentinel, runs `gtd`:

- A resolves: TODO.md present, no marker, pending edits →
  **Grilling (iterate)**
- A commits user's answers: `gtd: grilling`
- A grilling agent incorporates the answers, finds nothing unresolved, makes
  no further edits, re-runs `gtd`

- A resolves: TODO.md present, no marker, clean tree → **Grilled** (auto-advance)
- A commits converged plan: `gtd: grilled`
- A emits: decompose prompt to planning-model subagent

---

## Planning

The decompose subagent creates the `.gtd/` package tree:

```
.gtd/
  01-auth-service/
    01-types.md
    02-login-handler.md
  02-api-routes/
    01-endpoints.md
```

- A resolves: .gtd/ modified → **Planning** (auto-advance)
- A commits package files: `gtd: planning`
- A emits: continue-or-advance prompt; .gtd/ complete, re-runs `gtd`

- A resolves: .gtd/ clean + HEAD `gtd: planning` → **Building**

---

## Building — package 01

- A resolves: .gtd/ clean + HEAD `gtd: planning` → **Building** (auto-advance)
- A inlines `01-auth-service/` task files into the prompt
- A spawns one subagent for `01-types.md` and one for `02-login-handler.md`
  in parallel; subagents write code

---

## Testing (red) → Fixing loop

- A resolves: code changes → **Testing** (edge-only)
- A commits code: `gtd: building`
- A runs `npm run test` → **FAIL** (testFixCount = 1, below cap of 3)
- A writes `FEEDBACK.md` with test output, commits: `gtd: errors`
- A auto-advances → Fixing

### Fix round 1

- A resolves: FEEDBACK.md non-empty, committed → **Fixing** (auto-advance)
- A commits FEEDBACK.md removal: `gtd: fixing`  _(committed = from Testing)_
- A fixer agent reads inlined failure output, patches the code, re-runs `gtd`

- A resolves: code changes → **Testing** (edge-only)
- A commits: `gtd: building`
- A runs tests → **PASS**
- A auto-advances → Agentic Review

---

## Agentic Review — package 01

- A resolves: .gtd/ clean + HEAD `gtd: building` → **Agentic Review** (auto-advance)
- A reviewFixCount = 0 (below threshold 3) + agenticReview: true → run review
- A planning-model subagent diffs the package (since `gtd: planning`), finds
  issues, writes non-empty `FEEDBACK.md`, re-runs `gtd`

- A resolves: FEEDBACK.md non-empty, uncommitted → **Fixing** (auto-advance)
- A commits FEEDBACK.md removal: `gtd: feedback`  _(uncommitted = from Agentic Review)_
- A fixer agent addresses the review findings, re-runs `gtd`

- A resolves: code changes → **Testing** (edge-only)
- A commits: `gtd: building`
- A runs tests → **PASS**
- A auto-advances → Agentic Review (reviewFixCount = 1)

- A agentic-review subagent reviews the updated code, finds it clean, writes
  **empty** `FEEDBACK.md`, re-runs `gtd`

- A resolves: FEEDBACK.md present + empty → **Close package** (edge-only)
- A removes FEEDBACK.md, removes `.gtd/01-auth-service/`
- A commits: `gtd: package done`
- A auto-advances → Building (`.gtd/02-api-routes/` remains)

---

## Building — package 02

- A resolves: .gtd/ clean + HEAD `gtd: package done` → **Building** (auto-advance)
- A inlines `02-api-routes/` tasks, spawns subagent for `01-endpoints.md`

- A resolves: code changes → **Testing** (edge-only)
- A commits: `gtd: building`
- A runs tests → **PASS** on first try
- A auto-advances → Agentic Review (reviewFixCount = 0, fresh budget)

- A review subagent finds the package clean, writes empty `FEEDBACK.md`
- A resolves: FEEDBACK.md empty → **Close package** (edge-only)
- A removes FEEDBACK.md + `.gtd/02-api-routes/` + now-empty `.gtd/`
- A commits: `gtd: package done`
- A auto-advances → Clean (no steering files, reviewable diff since merge-base)

---

## Clean

- A resolves: no steering files, clean tree, HEAD `gtd: package done`,
  reviewable diff → **Clean**
- A planning-model subagent generates `REVIEW.md` covering the full feature
  diff since the merge-base with the default branch
- A auto-advances → Await Review

---

## Await Review

- A resolves: REVIEW.md uncommitted → **Await Review**
- A commits: `gtd: awaiting review`
- A emits: STOP — "Review the changes in REVIEW.md; run gtd when done"

---

### Path A — Human approves (no edits)

U reads REVIEW.md, makes no changes, runs `gtd`:

- A resolves: REVIEW.md committed, clean tree → **Done** (edge-only)
- A removes REVIEW.md, commits: `gtd: done`
- A auto-advances → **Idle**

- A resolves: no steering files, clean tree, HEAD `gtd: done` → **Idle**
- A emits: nothing to do — ready for a new feature

---

### Path B — Human requests changes

U annotates REVIEW.md with comments and/or edits source files, runs `gtd`:

- A resolves: REVIEW.md committed, dirty tree → **Accept Review** (edge-only)
- A seeds `TODO.md` from the pending changeset (REVIEW.md notes + code edits)
- A discards code edits back to the reviewed baseline, removes REVIEW.md
- A auto-advances → Grilling (TODO.md present + pending changes)
- _Loop restarts from Grilling with the review feedback as the new plan seed_
