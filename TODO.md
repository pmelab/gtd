# Plan: Extract Intelligence from Matt Pocock's Skills into gtd Prompts

## Summary

Extract the disciplined thinking from Matt Pocock's [skills collection](https://github.com/mattpocock/skills/tree/main/skills) and bake it directly into gtd's own prompts. **No external dependencies, no structural changes to gtd's flow.** The goal is better prompts, not different architecture.

**Four target areas:**

| gtd phase | Source skill | What to extract |
|-----------|--------------|-----------------|
| Q&A batch interview | grilling | Question-selection discipline, branch-walking, "explore codebase instead" rule |
| Decompose | to-issues | Vertical-slice rules, acceptance criteria, blocked-by relationships |
| Execute (build) | tdd | Anti-horizontal-slicing, tracer bullets, behavior-not-implementation testing |
| Verify | diagnose | 6-phase discipline (esp. "build feedback loop first"), ranked hypotheses |

---

## Detailed Extractions

### 1. Q&A Batch Interview ← Grilling

**Current state:** `new-todo.md` says "interview the plan relentlessly" but gives no specific discipline.

**Extract from grilling:**

> Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

> If a question can be answered by exploring the codebase, explore the codebase instead.

**Concrete changes to `new-todo.md` and `modified-todo.md`:**

- Add: "Walk every branch of the design tree, resolving dependencies between decisions one-by-one"
- Add: "Before asking a question, check if the codebase or project docs already answer it — explore instead of asking"
- Add: "Each question must advance toward a decision; avoid questions that don't change implementation"
- Keep: Batch format with `## Open Questions` section (user edits asynchronously)

---

### 2. Decompose ← To-Issues

**Current state:** `decompose.md` creates numbered packages with task files. No guidance on slice granularity.

**Extract from to-issues:**

> Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

> - Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
> - A completed slice is demoable or verifiable on its own
> - Prefer many thin slices over few thick ones

> Slices may be 'HITL' or 'AFK'. HITL slices require human interaction... AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

**Concrete changes to `decompose.md`:**

- Add vertical-slice rules to package creation guidance
- Add: "Each package must be demoable/verifiable on its own — no 'set up infrastructure' packages that deliver nothing testable"
- Add: "Prefer many thin packages over few thick ones"
- Add HITL/AFK classification to task files (mark tasks needing human decisions)
- Require acceptance criteria in task files (currently just "clear description")

---

### 3. Execute ← TDD

**Current state:** `execute.md` says "Inject the `tdd` skill" but doesn't specify what that means.

**Extract from tdd:**

> **Anti-Pattern: Horizontal Slices**
> DO NOT write all tests first, then all implementation. This is "horizontal slicing"...

> **Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle.

> ```
> WRONG (horizontal):
>   RED:   test1, test2, test3, test4, test5
>   GREEN: impl1, impl2, impl3, impl4, impl5
>
> RIGHT (vertical):
>   RED→GREEN: test1→impl1
>   RED→GREEN: test2→impl2
>   ...
> ```

> Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Concrete changes to `execute.md`:**

- Replace "Inject the tdd skill" with explicit rules:
  - "Write ONE test → implement → pass → repeat (vertical slices)"
  - "DO NOT write all tests first then implement (horizontal slicing)"
  - "Tests verify behavior through public interfaces, not implementation details"
  - "A good test survives refactors — if renaming an internal function breaks the test, it's testing implementation"

---

### 4. Verify ← Diagnose

**Current state:** `verify.md` is two lines: "Verify the working tree is healthy. If anything is broken, fix it."

**Extract from diagnose:**

> ## Phase 1 — Build a feedback loop
> **This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause...
> Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

> ## Phase 3 — Hypothesise
> Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

> ## Phase 4 — Instrument
> **Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep.

**Concrete changes to `verify.md`:**

- Expand the happy path: run tests, typecheck, lint — if all pass, done
- On failure, invoke structured diagnosis:
  1. Build a feedback loop (failing test, script, minimal repro)
  2. Generate 3-5 ranked hypotheses before fixing anything
  3. Instrument with tagged debug logs (cleanup via grep)
  4. Fix + verify the original repro passes
  5. Remove all `[DEBUG-*]` instrumentation

---

## Implementation Order

**Phase 1 — Prompt text changes only (no TypeScript):**

1. `verify.md` ← diagnose discipline (most improvement per effort)
2. `execute.md` ← tdd anti-horizontal-slicing rules
3. `decompose.md` ← to-issues vertical-slice rules
4. `new-todo.md` + `modified-todo.md` ← grilling question discipline

---

## Open Questions

### Which grilling principles actually apply to batch Q&A?

Grilling asks one question at a time, waiting for response. gtd batches questions. What translates?

**Recommendation:** Keep batching but adopt: (1) "explore codebase first" rule — don't ask what can be answered by reading code; (2) question prioritization — ask the questions that most affect implementation first; (3) branch-walking — group related questions by decision branch so user can answer one branch completely. The "one at a time" aspect doesn't translate; the "resolve dependencies between decisions" does.

<!-- user answers here -->

---

### Should task files include explicit acceptance criteria format?

Current task files require "clear description" and "acceptance criteria" but no template. To-issues has a specific format:

```markdown
## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

**Recommendation:** Yes, adopt the checkbox format. It's machine-parseable (testing subagent can check off criteria) and forces concrete, testable criteria. Add to decompose.md: "Acceptance criteria must be checkboxes that a testing subagent can verify programmatically."

<!-- user answers here -->

---

### How much of the 6-phase diagnosis loop belongs in verify.md?

The full diagnose skill is ~200 lines. verify.md is currently 2 lines. Options:

1. **Minimal:** Just add "generate 3-5 hypotheses before fixing" rule
2. **Medium:** Add phases 1, 3, 4, 5 (feedback loop, hypothesize, instrument, fix)
3. **Full:** Inline the entire 6-phase discipline

**Recommendation:** Medium. Phases 1 and 3 are the key insights ("build a feedback loop first" and "3-5 ranked hypotheses"). Phase 2 (reproduce) is implicit. Phase 6 (postmortem) is nice-to-have. Skip the 10 ways to build a feedback loop — that's too detailed for a prompt; trust the model to figure it out.

<!-- user answers here -->

---

### Should decompose.md add HITL/AFK classification?

To-issues distinguishes tasks needing human decisions (HITL) from autonomous tasks (AFK). gtd currently treats all tasks as autonomous.

**Recommendation:** No. gtd's flow assumes the planning phase resolved all HITL decisions via `## Open Questions`. If a task genuinely needs human input mid-execution, that's a planning failure. Adding HITL classification would complicate the execute phase (pause for human input between tasks). Keep it simple: plan resolves decisions, execute is autonomous.

<!-- user answers here -->

---

### What happens if verify.md diagnosis loop fails after N attempts?

Current execute.md has a retry limit (default 5) for the testing subagent. If diagnosis fails after 5 attempts, what then?

**Recommendation:** Same pattern as execute.md — ask the user: "Diagnosis failed after N attempts. Commit with WIP marker / Open issue / Abort?" Don't silently fail. The verify phase should surface the ranked hypotheses it tried so the human has context.

<!-- user answers here -->

---

### Should the tdd rules go in execute.md or a separate tdd-rules.md include?

execute.md is already ~60 lines. Adding detailed TDD rules could make it unwieldy.

**Recommendation:** Inline them. The rules are ~10 lines. A separate file adds indirection without benefit. If execute.md grows too large later, refactor then.

<!-- user answers here -->
