# Task: Rewrite `verify.md` with Diagnose Discipline

## File to modify

`src/prompts/verify.md`

## Current content (complete)

```markdown
## Task: Verify the working tree is healthy

The working tree is clean and the last commit was not a `TODO.md` checkpoint.
There is no plan to execute.

Verify the working tree is healthy. If anything is broken, fix it.
```

## What to change

Replace the entire file with a structured diagnosis protocol. The current prompt is only 2 lines and provides no discipline. The new version should:

1. **Happy path first**: Run tests, typecheck, lint — if all pass, done
2. **On failure**: Invoke structured 5-phase diagnosis (extracted from Matt Pocock's `diagnose` skill)

## Source intelligence to embed (from diagnose skill)

### Phase 1 — Build a feedback loop

> **This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause...
> Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Phase 3 — Hypothesise

> Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.
> Each hypothesis must be **falsifiable**: state the prediction it makes.

### Phase 4 — Instrument

> **Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep.

### Phase 5 — Fix + regression test

> Write the regression test **before the fix** — but only if there is a **correct seam** for it.

## New content to write

```markdown
## Task: Verify the working tree is healthy

The working tree is clean and the last commit was not a `TODO.md` checkpoint.
There is no plan to execute.

### Happy path

1. Run tests, typecheck, lint (whatever the project has configured)
2. If all pass → done, report success

### On failure — structured diagnosis

If anything fails, invoke this discipline. Do not skip phases.

#### Phase 1: Build a feedback loop

**This is the skill.** If you have a fast, deterministic, agent-runnable
pass/fail signal, you will find the cause. Spend disproportionate effort here.

Turn the failure into:
- A failing test at whatever seam reaches the bug
- A CLI invocation with fixture input
- A minimal script that reproduces the failure

Do not proceed until you have a reliable feedback loop.

#### Phase 2: Generate ranked hypotheses

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis
generation anchors on the first plausible idea and wastes cycles.

Each hypothesis must be **falsifiable** — state the prediction:
> "If <X> is the cause, then <changing Y> will make the bug disappear."

#### Phase 3: Instrument and test

Test hypotheses one at a time. Prefer:
1. Debugger / REPL inspection (one breakpoint beats ten logs)
2. Targeted logs at boundaries that distinguish hypotheses

**Tag every debug log** with a unique prefix: `[DEBUG-xxxx]`
Cleanup becomes a single grep. Untagged logs survive; tagged logs die.

#### Phase 4: Fix and verify

1. Apply the fix
2. Verify the original feedback loop passes
3. Run full test suite to check for regressions

#### Phase 5: Cleanup

Before declaring done:
- [ ] Original failure no longer reproduces
- [ ] All `[DEBUG-*]` instrumentation removed (grep the prefix)
- [ ] Full test suite passes
```

## Acceptance criteria

- [ ] `verify.md` has a "Happy path" section that runs tests/typecheck/lint first
- [ ] On failure, there are 5 clearly numbered phases
- [ ] Phase 1 emphasizes building a feedback loop as "the skill"
- [ ] Phase 2 requires 3-5 ranked hypotheses before testing any
- [ ] Phase 3 mentions tagged debug logs with `[DEBUG-xxxx]` prefix
- [ ] Phase 4 requires verifying the original feedback loop passes
- [ ] Phase 5 has cleanup checklist including grep for debug instrumentation
- [ ] File is pure markdown, no TypeScript changes
