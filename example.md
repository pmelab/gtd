# gtd — aspirational workflow spec

"U" marks actions by the user, "A" marks actions by the agent.

gtd is a resumable state machine driven by the repo itself. Each invocation:
**commit human changes verbatim first, infer the current state, take exactly one
step, then auto-invoke again** — until it hits a state that needs a human
(a gate) or the cycle concludes.

## State encoding

State lives **in the control files** (in-file markers are the source of truth,
robust to rebase/amend). File presence selects the phase; markers select the
sub-state. At most one phase is active at a time.

| Signal | State |
| --- | --- |
| `TODO.md`, no `status:` frontmatter | verbatim, not yet grilled |
| `TODO.md`, `status: grilling`, `## Open Questions` non-empty | awaiting user answers **(gate)** |
| `TODO.md`, `status: complete` | ready to decompose |
| `TODO.md`, `status: simple` | ready for single-agent implement (≤5 files) |
| `NN-*.md` work packages present | execution in progress |
| `ERRORS.md` present | fix loop escalated **(gate)** |
| `REVIEW.md` present, boxes unchecked | awaiting review **(gate)** |
| none of the above | idle — ready for a new `TODO.md` |

## Rules

1. **Verbatim first.** Every invocation begins with `git add -A` of whatever the
   human changed, committed verbatim, *before* any gate is evaluated.
2. **Auto-invoke until a gate.** The agent re-invokes itself to advance; it stops
   only at a human gate (open questions, escalation, unchecked review) or at
   conclusion.
3. **Grilling** ensures an `## Open Questions` section exists, moves answered Q&A
   to a `## Resolved` graveyard at the bottom, and adds new questions at the top.
   When no questions remain it sets `status: simple` if the change is confined to
   **≤5 files**, otherwise `status: complete`.
4. **Decomposition** emits ordinal-prefixed packages (`01-*.md`, `02-*.md`, …) in
   **dependency order**. The set is **frozen** — no re-decomposition after this
   point. Each package must be able to leave the tree **green on its own**. A task
   = a file-disjoint unit owned by one subagent; tasks that would share files are
   merged into one task.
5. **Execution** runs packages sequentially by ordinal. Per package: launch a
   subagent per task (file-disjointness is **best-effort**, not enforced — no
   worktrees), wait, commit, then run the test loop. On success remove the package
   and continue; packages are never run in parallel.
6. **Test loop** runs whenever there are committed-but-untested code changes
   (after a package, or after human code edits). It retains the error + attempt
   log across attempts (scratchpad in `ERRORS.md`, **uncommitted**), and **does not
   commit per attempt** — only on success (commit fixes, discard `ERRORS.md`) or
   escalation. Escalate after **3 attempts** *or* immediately if an error signature
   recurs (no progress); escalation commits `ERRORS.md` as a human gate. So
   `ERRORS.md` only ever appears in history as an escalation artifact.
7. **Resume** is from committed state, with a **hard reset** of the working tree.
   The test loop is the one non-checkpointed span: interrupted mid-loop resumes
   from the package-execution commit and restarts the loop cold (attempt memory is
   lost — accepted trade for a clean history).
8. **Review** generates `REVIEW.md` covering the diff since the last `REVIEW.md`
   was removed (the baseline). It is a gate until every box is checked.
9. **Conclude vs. loop.** Once all boxes are checked, scan for leftover work since
   the baseline: leftover `REVIEW.md` notes, `!!` comments (`// !! …`, `# !! …`,
   etc.), or human code changes. None ⇒ remove `REVIEW.md` and conclude. Any ⇒
   consolidate leftover notes + harvested `!!` comments into a new `TODO.md`
   (intent is not parsed — the user deletes what they didn't mean), strip the `!!`
   comments and `REVIEW.md`, and loop.

## Walkthrough

### Plan
- U: creates `TODO.md`; invokes gtd
- A: commits `TODO.md` verbatim
- A: grilling agent fleshes it out, adds `## Open Questions`, sets `status: grilling`; commits **(gate)**
- U: answers questions inline; invokes gtd
- A: commits verbatim
- A: grilling agent moves answered Q to `## Resolved`, adds new questions; commits **(gate)**
- U: answers the rest; invokes gtd
- A: commits verbatim
- A: grilling agent empties Open Questions, judges >5 files → `status: complete`; commits
- A: auto-invokes

### Decompose
- A: sees `status: complete` → decomposition agent emits `01-*.md`, `02-*.md` (frozen, dependency order)
- A: commits packages, removes `TODO.md`
- A: auto-invokes

### Execute 01
- A: picks lowest ordinal (01); launches a subagent per task; waits; commits (package-execution commit)
- A: test loop → fail → fix subagent (sees error+attempt log) → fail again, same signature → **escalate**? no — different error → fix → pass
- A: commits fixes, removes `01`, discards `ERRORS.md`
- A: auto-invokes

### Execute 02
- A: picks 02; subagents; commits
- A: test loop → passes first try
- A: removes `02`; commits
- A: auto-invokes

### Review
- A: idle of packages → generates `REVIEW.md` (baseline = branch start); commits **(gate)**
- U: works the list but leaves 1 box unchecked, adds a note, makes a code fix in source, leaves a `// !! …` comment; invokes gtd
- A: commits everything verbatim (`git add -A`) **first**
- A: review gate: unchecked box remains → halts, tells user to check all boxes **(gate)**
- U: checks the last box; invokes gtd
- A: commits verbatim
- A: gate satisfied; human code changed → test loop → fail → fix → pass; commits fixes
- A: auto-invokes
- A: leftover work exists (note + `!!` comment) → consolidates them into a new `TODO.md`; strips the `!!` comment and `REVIEW.md`; commits
- A: auto-invokes

### Loop (simple)
- A: grilling agent inspects new `TODO.md`: no open questions, ≤5 files → `status: simple`; commits
- A: auto-invokes
- A: `status: simple` → single implementation agent (no decompose); commits; removes `TODO.md`
- A: auto-invokes
- A: untested changes → test loop → pass
- A: generates `REVIEW.md` (baseline = since last `REVIEW.md` removed); commits **(gate)**
- U: reviews, checks all boxes; invokes gtd
- A: commits verbatim
- A: gate satisfied; no leftover notes / `!!` comments / untested changes → removes `REVIEW.md`, commits removal
- A: informs the user the cycle concluded; ready for a new `TODO.md`

## Principles

1. The process is resumable from any commit (the test loop excepted — it resets to
   its starting commit).
2. The agent auto-invokes to resume itself as far as it can, stopping only at
   human gates.
3. All human input is captured in git history verbatim, before anything else.
4. There are no escape hatches: no cancel/abort, and gtd does not run concurrently
   with an in-flight auto-invoke chain.
