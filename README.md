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

| Leaf state       | When it wins (first matching guard, top to bottom)                                 | Prompt                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `close-review`   | `REVIEW.md` dirty with ONLY forward checkbox ticks (`- [ ]`→`- [x]`), nothing else | Discard ticks, delete `REVIEW.md`, commit the close                                                                                                                                                                                                                                                                                                                              |
| `review-process` | `REVIEW.md` exists and is dirty (user-edited)                                      | Commit raw feedback verbatim as `docs(review): record raw feedback for <base>`, then reset and synthesize `TODO.md`                                                                                                                                                                                                                                                              |
| `code-changes`   | Any uncommitted change outside `TODO.md`                                           | Commit the uncommitted changes                                                                                                                                                                                                                                                                                                                                                   |
| `execute`        | `.gtd/` contains numbered work packages                                            | gtd runs the test suite (`npm run test`) itself first; on green it names the single next package and inlines its task files' contents into the prompt, executed via parallel subagents (on the last package it also removes the empty `.gtd/` in the same commit so the next run goes straight to human-review); on red it emits the fix-tests prompt (or `escalate` at the cap) |
| `cleanup`        | `.gtd/` exists but holds no packages                                               | Remove empty `.gtd/`, then verify — a vestigial safety net for a stray empty `.gtd/` (e.g. created by hand); the normal last-package path skips it since execute removes `.gtd/` itself                                                                                                                                                                                          |
| `execute-simple` | `TODO.md` finalized and marked `<!-- simple -->`                                   | Implement the simple plan directly                                                                                                                                                                                                                                                                                                                                               |
| `decompose`      | `TODO.md` finalized (no unanswered questions)                                      | Record `TODO.md` as `docs(plan): record TODO.md` (when not already in `HEAD`), then decompose into work packages (planning model)                                                                                                                                                                                                                                                |
| `escalate`       | Trailing run of `fix(gtd):` commits at HEAD reached 5                              | Stop; ask the human to fix the root cause                                                                                                                                                                                                                                                                                                                                        |
| `new-todo`       | `TODO.md` is new (untracked / added)                                               | Develop the plan (planning model)                                                                                                                                                                                                                                                                                                                                                |
| `modified-todo`  | `TODO.md` is modified                                                              | Incorporate edits, keep developing (planning)                                                                                                                                                                                                                                                                                                                                    |
| `human-review`   | Clean tree, a review base exists, and `base..HEAD` has a non-empty diff            | gtd runs the test suite (`npm run test`) itself; on green it generates `REVIEW.md`, on red it emits the fix-tests prompt (or `escalate` at the cap)                                                                                                                                                                                                                              |
| `verified`       | Nothing else matched — tree clean, nothing left to review                          | Report the working tree healthy and reviewed                                                                                                                                                                                                                                                                                                                                     |

> **`fix-tests` is a prompt, not a leaf state.** It is never one of the
> machine's resolved leaf states — it is selected in the Effect edge (keyed off
> the resolved leaf + the test exit code) when the hardcoded `npm run test`
> fails on the `human-review` or `execute` path. It embeds the captured failure
> output and instructs the agent to make exactly ONE `fix(gtd): <desc>` commit,
> then re-run gtd so the gate re-evaluates.

> **Review base**: the closest-to-HEAD of {parent-branch merge-base, last
> `<!-- base: … -->` review commit, last `chore(gtd): close approved review`
> commit}, restricted to ancestors of HEAD. When no base exists or `base..HEAD`
> is empty, there is nothing to review. Because the close commit itself becomes
> the new base, the run immediately after a close resolves to `verified`.

> **Test-fix iterations**: each test-gate fix is committed as
> `fix(gtd): <desc>`. The trailing run of such commits at HEAD is counted; when
> it reaches **5** (the hardcoded `MAX_VERIFY_ITERATIONS` — **not** configurable
> via AGENTS.md) gtd resolves to `escalate` and stops. Any non-`fix(gtd):`
> commit at HEAD resets the counter to 0. The cap is enforced **in the Effect
> edge** before emitting fix-tests, so it works uniformly for both
> `human-review` and `execute` — the latter sits above `capReached` in the
> machine's guard order (the machine checks `hasPackages` first), so without the
> edge cap a failing-test package would loop forever. `src/Machine.ts` stays
> pure/IO-free; the guard order is unchanged.

> **Deterministic test execution**: when the fold lands on `human-review` or
> `execute`, gtd runs the test suite **itself** in the Effect edge — not the
> agent. It spawns the hardcoded `npm run test` (no env/config override for
> now), captures stdout + stderr + the exit code, and branches the emitted
> prompt on the result: a green run (exit 0) emits the leaf's normal prompt
> (`REVIEW.md` generation / execute the next package); a red run emits the
> `fix-tests` prompt with the captured output embedded (or `escalate` once the
> cap is reached). The fold in `src/Machine.ts` stays pure — the actual test run
> lives only in the edge.

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
    Resolve -->|.gtd/ has packages| ExecuteTest{execute: edge runs npm run test}
    ExecuteTest -->|green| Execute[execute next package]
    ExecuteTest -->|red, below cap| FixTests[fix-tests prompt]
    ExecuteTest -->|red, at cap| Escalate
    Execute -.->|last package: removes .gtd/ in same commit| Resolve
    Resolve -->|stray empty .gtd/ safety net| Cleanup[cleanup .gtd/]
    Resolve -->|TODO.md finalized + simple| ExecuteSimple[execute-simple]
    Resolve -->|TODO.md finalized| Decompose[decompose into packages]
    Resolve -->|trailing fix\(gtd\): run hit 5| Escalate[escalate: stop, ask human]:::terminal
    Resolve -->|TODO.md new| NewTodo[new-todo: develop plan]
    Resolve -->|TODO.md modified| ModifiedTodo[modified-todo: incorporate edits]
    Resolve -->|clean, base..HEAD has diff| HumanReviewTest{human-review: edge runs npm run test}
    HumanReviewTest -->|green| HumanReview[human-review: generate REVIEW.md]:::terminal
    HumanReviewTest -->|red, below cap| FixTests
    HumanReviewTest -->|red, at cap| Escalate
    Resolve -->|nothing left| Verified[verified: healthy & reviewed]:::terminal
    FixTests -.->|one fix\(gtd\): commit, re-run /gtd| Resolve
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
   `docs(plan): record TODO.md` (when not already in `HEAD`, preserving the plan
   and its Q&A history), then decomposes it into work packages in `.gtd/`,
   deletes `TODO.md`, and commits the plan.
6. `/gtd` again — first the edge runs `npm run test` (green or, on the first
   package, nothing to verify yet); on green the prompt names the single next
   package and inlines its task contents, and the agent executes it: spawns
   parallel workers (execution model + TDD), commits with `COMMIT_MSG.md`,
   deletes the package directory. It does **not** run tests in-prompt — the next
   cycle's edge runs `npm run test` to verify the package just committed.
7. Repeat `/gtd` for each remaining package — one package per cycle, each
   cycle's edge verifying the previous commit. A red test run emits the
   fix-tests prompt (one `fix(gtd):` fix per cycle) until green or the cap
   escalates. On the **last** package the execute prompt also removes the empty
   `.gtd/` in the same commit, so cleanup is normally skipped.
8. With `.gtd/` already gone, the next `/gtd` proceeds straight to human-review
   (the `cleanup` step survives only as a safety net for a stray empty `.gtd/`).
   If un-reviewed commits exist relative to the base (parent-branch merge-base
   or last review commit), it resolves to human-review and **runs the test suite
   itself**: on green it auto-generates `REVIEW.md` and stops for you to review
   it; on red it emits the fix-tests prompt (one fix per cycle, committed as
   `fix(gtd):`) or, once the iteration cap is reached, `escalate`. If everything
   is already reviewed, it reports the tree healthy and fully reviewed
   (verified).
9. Edit `REVIEW.md` with feedback and run `/gtd` again — gtd detects the dirty
   `REVIEW.md` (review-process), first commits the reviewer's entire working
   tree verbatim as `docs(review): record raw feedback for <base>` (preserving
   annotated `REVIEW.md`, source edits, and `TODO:` markers in history), then
   resets and folds your feedback into a fresh `TODO.md`, and the loop starts
   over.

> If the test gate keeps failing, each fix is committed as `fix(gtd): <desc>`.
> The cap (five trailing `fix(gtd):` commits → **escalate**) is enforced in the
> Effect edge before fix-tests is emitted, so it applies uniformly to both the
> `human-review` and `execute` gates. Once the cap is hit, gtd stops
> auto-advancing and asks you to fix the root cause. Commit that fix with any
> non-`fix(gtd):` prefix (or amend/squash the chain) to reset the counter and
> resume.

## Build orchestration

When a plan is finalized, gtd enters build mode:

### 1. Decompose

Before decomposing, if `TODO.md` is not already committed and unchanged at
`HEAD`, it is recorded verbatim as `docs(plan): record TODO.md` — preserving the
plan and its full Q&A history (`## Open Questions` / `## Answered Questions`) in
git history before deletion. In the normal flow this is a no-op (the plan was
already committed by `new-todo`/`modified-todo`); it only fires when a fresh,
never-committed `TODO.md` is routed directly to decompose.

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

Execution is **one package per cycle**. gtd selects the single next package
itself, NAMES it in the prompt, and inlines its task files' full contents
directly into the emitted prompt (noting its `COMMIT_MSG.md`) — the prompt is
self-contained, so the agent never browses `.gtd/` or picks a package.
Verification is deterministic and lives in the edge, not in the prompt: before
any execute prompt is emitted the edge runs `npm run test`, and the cycle that
follows a package commit re-runs it to verify that commit.

On the **last** package, the execute prompt also instructs removing the
now-empty `.gtd/` directory in the **same** commit, so the next run proceeds
straight to `human-review` — the `cleanup` round-trip is normally skipped.

A single execute cycle (green test gate):

1. Spawn parallel execution-model workers for all tasks in the selected package
   (with `tdd` skill)
2. If any worker fails (crash/timeout, not a test failure): ask user to
   retry/skip/abort
3. Commit all changes with `COMMIT_MSG.md`, then delete the package directory.
   Do **not** run or determine a test command here.
4. Re-run gtd — the next cycle's edge runs `npm run test` to verify what was
   just committed, then advances to the next package.

When that edge test run fails, the edge emits the `fix-tests` prompt instead:
make exactly one fix, commit it as `fix(gtd): <desc>`, and re-run gtd. Once five
consecutive `fix(gtd):` commits accumulate at HEAD, the edge resolves to
`escalate` and hands control back to the human.

### 3. Cleanup

Remove empty `.gtd/`, verify working tree is healthy. This step is now a
**vestigial safety net**: the normal tail no longer reaches it, because the last
execute package removes the empty `.gtd/` in its own commit (see above). It is
retained only to catch a stray empty `.gtd/` — e.g. one created by hand — so the
machine still has a defined transition for that case.

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
npm run dev          # run from source, no build (node dev/run.mjs)
npm run build        # tsup → scripts/gtd.js (checked in)
npm test             # vitest
npm run test:e2e     # cucumber integration tests
npm run typecheck
npm run lint
```

`npm run dev` runs `src/main.ts` directly via Node's native TypeScript
type-stripping (requires Node 22.6+). It registers `dev/hooks.mjs`, which fills
the two gaps the tsup build otherwise covers: resolving `./Foo.js` specifiers to
the on-disk `./Foo.ts`, and importing `*.md` prompt files as text. Pass CLI args
after `--`, e.g. `npm run dev -- format <file>`. The helpers live in `dev/`
rather than `scripts/` because tsup wipes `scripts/` (`clean: true`) on build.

`scripts/gtd.js` is committed to the repo so the skill installs zero-step.
Rebuild it before tagging a release.

## License

MIT
