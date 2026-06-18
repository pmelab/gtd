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
