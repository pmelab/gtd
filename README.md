# gi[t]hings.**done**

> [!WARNING] This project is an experiment in unapologetic vibe coding. Code
> might be terrible, I don't even know 🤷‍♂️ But otherwise I wouldn't have built it
> in the first place. Now I have something that actually helps me.

A git-aware agent skill that emits the next prompt for an autonomous coding
agent based on the current repository state — plan, refine the plan, decompose
into work packages, execute with parallel subagents, commit, or verify the
working tree is healthy.

Internally, gtd is an [xstate](https://stately.ai/docs/xstate) event-sourced
state machine used as a **pure fold** over git history. The Effect "edge"
(`src/Events.ts`) reads the first-parent commit subjects since the merge-base
with the default branch (whole-history fallback when there is no default branch
or merge-base) plus the working tree, turns them into a `COMMIT[]` + single
`RESOLVE` event stream, and folds them through the IO-free machine
(`src/Machine.ts`). The fold lands on exactly **one** active leaf state, which
selects the prompt. There is no multi-section/branches-array snapshot — a single
run resolves to a single state.

`gtd` ships as an [Agent Skills Spec](https://agentskills.io/specification)
compliant skill installable via [skills.sh](https://www.skills.sh/). The agent
runs the bundled script, reads the emitted prompt, and follows it verbatim.

## Installation

```bash
npx skills add pmelab/gtd -g -y
```

That's it. No npm install, no config file, no setup subcommand. The skill
bundles its own prebuilt script.

## Usage

Inside the agent (Claude Code, Codex, etc.), either:

- Type `/gtd` to invoke the skill directly, **or**
- Say something like "take the next step", "what's next", or "gtd" — the skill's
  description matcher picks it up.

The agent runs `node scripts/gtd.js` in your current working directory and acts
on the emitted prompt.

## What it does

`gtd` folds git history + the working tree into a single active leaf state and
emits the one prompt for that state. The guards are evaluated in a fixed
priority order, so exactly one state wins per run:

| Leaf state       | When it wins (first matching guard, top to bottom)                                                  | Prompt                                        |
| ---------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `close-review`   | `REVIEW.md` dirty with ONLY forward checkbox ticks (`- [ ]`→`- [x]`), nothing else                 | Discard ticks, delete `REVIEW.md`, commit the close |
| `review-process` | `REVIEW.md` exists and is dirty (user-edited)                                                       | Commit raw feedback verbatim as `docs(review): record raw feedback for <base>`, then reset and synthesize `TODO.md` |
| `code-changes`   | Any uncommitted change outside `TODO.md`                                | Commit the uncommitted changes                |
| `execute`        | `.gtd/` contains numbered work packages                                 | Execute the next package (parallel subagents) |
| `cleanup`        | `.gtd/` exists but holds no packages                                    | Remove empty `.gtd/`, then verify             |
| `execute-simple` | `TODO.md` finalized and marked `<!-- simple -->`                        | Implement the simple plan directly            |
| `decompose`      | `TODO.md` finalized (no unanswered questions)                           | Record `TODO.md` as `docs(plan): record TODO.md` (when not already in `HEAD`), then decompose into work packages (planning model) |
| `escalate`       | Trailing run of `fix(gtd):` commits at HEAD reached 5                   | Stop; ask the human to fix the root cause     |
| `new-todo`       | `TODO.md` is new (untracked / added)                                    | Develop the plan (planning model)             |
| `modified-todo`  | `TODO.md` is modified                                                   | Incorporate edits, keep developing (planning) |
| `human-review`   | Clean tree, a review base exists, and `base..HEAD` has a non-empty diff | Verify, then generate `REVIEW.md`             |
| `verified`       | Nothing else matched — tree clean, nothing left to review               | Report the working tree healthy and reviewed  |

> **Review base**: the closest-to-HEAD of {parent-branch merge-base, last
> `<!-- base: … -->` review commit, last `chore(gtd): close approved review`
> commit}, restricted to ancestors of HEAD. When no base exists or
> `base..HEAD` is empty, there is nothing to review. Because the close commit
> itself becomes the new base, the run immediately after a close resolves to
> `verified`.

> **Test-fix iterations**: each test-gate fix is committed as
> `fix(gtd): <desc>`. The machine counts the trailing run of such commits at
> HEAD; when it reaches **5** (the hardcoded `MAX_VERIFY_ITERATIONS` in
> `src/Machine.ts` — **not** configurable via AGENTS.md) it resolves to
> `escalate` and stops. Any non-`fix(gtd):` commit at HEAD resets the counter
> to 0.

> **`TODO:` markers in code** are ordinary code in the normal loop — they are
> only swept into `TODO.md` during review processing (`review-process`), never
> as a standalone step.

gtd coordinates phases — it doesn't dictate strategy. How to grill, how to
commit, how to build, how to verify: those are left to other skills (or the
agent's own judgement). The prompts only describe **intent**, plus the `TODO.md`
and `.gtd/` plumbing that lets phases bridge across runs.

Every prompt also includes the current `git diff HEAD` (untracked files
included) inline.

## Model configuration

gtd uses two model tiers, configured in your `~/.pi/AGENTS.md`:

```markdown
## Model preferences

- Use Claude Opus for planning work
- Use Claude Sonnet for execution work
```

- **Planning model**: High-reasoning for developing plans, grilling, and
  decomposing work packages
- **Execution model**: Everyday work for implementing tasks, running tests,
  fixing failures

If no preferences are set, the prompts include sensible defaults.

## Workflow

The machine evaluates guards in priority order and resolves to a single leaf
state per run:

```mermaid
flowchart TD
    Start([Invoke /gtd]) --> Resolve{Fold history + working tree}
    Resolve -->|REVIEW.md ticks only| CloseReview[close-review: close approved review]:::terminal
    Resolve -->|REVIEW.md dirty| ReviewProcess[review-process]:::terminal
    Resolve -->|code change outside TODO.md| CodeChanges[code-changes: commit]
    Resolve -->|.gtd/ has packages| Execute[execute next package]
    Resolve -->|.gtd/ empty| Cleanup[cleanup .gtd/]
    Resolve -->|TODO.md finalized + simple| ExecuteSimple[execute-simple]
    Resolve -->|TODO.md finalized| Decompose[decompose into packages]
    Resolve -->|trailing fix\(gtd\): run hit 5| Escalate[escalate: stop, ask human]:::terminal
    Resolve -->|TODO.md new| NewTodo[new-todo: develop plan]
    Resolve -->|TODO.md modified| ModifiedTodo[modified-todo: incorporate edits]
    Resolve -->|clean, base..HEAD has diff| HumanReview[human-review: generate REVIEW.md]:::terminal
    Resolve -->|nothing left| Verified[verified: healthy & reviewed]:::terminal
    HumanReview -.->|user edits REVIEW.md, next /gtd| ReviewProcess
    CloseReview -.->|auto re-run| Verified
    classDef terminal fill:#2d6a4f,color:#fff
```

A typical feature:

1. Create a `TODO.md` with a sketch of what you want.
2. `/gtd` — the agent (using the planning model) fleshes it out, appends an
   `## Open Questions` section, and commits `TODO.md`.
3. Open `TODO.md`, write inline answers under each question.
4. `/gtd` again — the agent integrates your answers, moves resolved questions to
   `## Answered Questions`, raises new ones, and commits. Repeat until
   `## Open Questions` is empty.
5. `/gtd` once more — agent first records `TODO.md` as
   `docs(plan): record TODO.md` (when not already in `HEAD`, preserving the
   plan and its Q&A history), then decomposes it into work packages in `.gtd/`,
   deletes `TODO.md`, and commits the plan.
6. `/gtd` again — agent executes the first package: spawns parallel workers
   (execution model + TDD), runs tests, fixes failures, commits.
7. Repeat `/gtd` for each remaining package.
8. When `.gtd/` is empty, `/gtd` cleans up and verifies. After tests pass, if
   un-reviewed commits exist relative to the base (parent-branch merge-base or
   last review commit), it auto-generates `REVIEW.md` and stops for you to
   review it (human-review). If everything is already reviewed, it reports the
   tree healthy and fully reviewed (verified).
9. Edit `REVIEW.md` with feedback and run `/gtd` again — gtd detects the dirty
   `REVIEW.md` (review-process), first commits the reviewer's entire working
   tree verbatim as `docs(review): record raw feedback for <base>` (preserving
   annotated `REVIEW.md`, source edits, and `TODO:` markers in history), then
   resets and folds your feedback into a fresh `TODO.md`, and the loop starts
   over.

> If the test gate keeps failing, each fix is committed as `fix(gtd): <desc>`.
> Once five such commits stack up at HEAD, gtd resolves to **escalate**: it
> stops auto-advancing and asks you to fix the root cause. Commit that fix with
> any non-`fix(gtd):` prefix (or amend/squash the chain) to reset the counter
> and resume.

## Build orchestration

When a plan is finalized, gtd enters build mode:

### 1. Decompose

Before decomposing, if `TODO.md` is not already committed and unchanged at
`HEAD`, it is recorded verbatim as `docs(plan): record TODO.md` — preserving
the plan and its full Q&A history (`## Open Questions` / `## Answered
Questions`) in git history before deletion. In the normal flow this is a no-op
(the plan was already committed by `new-todo`/`modified-todo`); it only fires
when a fresh, never-committed `TODO.md` is routed directly to decompose.

A planning-model subagent then breaks `TODO.md` into executable work packages:

```
.gtd/
  01-auth-module/
    01-define-types.md
    02-implement-login.md
    COMMIT_MSG.md
  02-api-endpoints/
    01-create-routes.md
    02-add-middleware.md
    COMMIT_MSG.md
```

Rules:

- **Packages are sequential** — Package 02 cannot start until 01 is complete
- **Tasks within a package are parallel** — No dependencies between tasks
- **Task files are self-contained** — Include description, acceptance criteria,
  relevant file paths

### 2. Execute

For each package:

1. Spawn parallel execution-model workers for all tasks (with `tdd` skill)
2. If any worker fails: ask user to retry/skip/abort
3. Spawn a testing subagent to run tests and fix failures
4. On a test failure, make one fix and commit it as `fix(gtd): <desc>`, then
   re-run gtd — the machine re-evaluates and either continues or, once five
   consecutive `fix(gtd):` commits accumulate at HEAD, resolves to `escalate`
   and hands control back to the human
5. Delete package directory, commit with `COMMIT_MSG.md`

### 3. Cleanup

Remove empty `.gtd/`, verify working tree is healthy.

## Q&A format inside TODO.md

The `## Open Questions` section lives at the TOP of TODO.md (before the plan
body). Each question looks like this:

```markdown
### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

<!-- user answers here -->
```

To answer, replace the comment with your response:

```markdown
### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

50 — these tables get long and 25 wastes a click for most users.
```

On the next run, the agent integrates the answer into the plan body and moves
the question to `## Answered Questions` at the bottom:

```markdown
## Answered Questions

### What should pagination default to?

**Recommendation:** 25 per page — matches the admin tables elsewhere.

**Answer:** 50 — these tables get long and 25 wastes a click for most users.
```

This preserves the decision history for future reference.

## Formatting

gtd ships a `format` subcommand that formats a markdown file in place:

```bash
node scripts/gtd.js format <file>
```

It uses a bundled prettier with a fixed, gtd-owned config (`parser: "markdown"`,
`printWidth: 80`, `proseWrap: "always"`). The host repo's `.prettierrc` is
**intentionally ignored** — determinism across consumer repos matters more than
local style preferences.

The main gtd prompt instructs the agent to invoke this command after every edit
to `TODO.md` or `REVIEW.md`, so those files stay consistently formatted
regardless of the host project's toolchain.

> [!NOTE] Upgrading gtd may reflow existing `TODO.md` files if the bundled
> prettier major version changes.

## Development

```bash
npm install
npm run build        # tsup → scripts/gtd.js (checked in)
npm test             # vitest
npm run test:e2e     # cucumber integration tests
npm run typecheck
npm run lint
```

`scripts/gtd.js` is committed to the repo so the skill installs zero-step.
Rebuild it before tagging a release.

## License

MIT
