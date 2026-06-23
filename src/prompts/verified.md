## Test gate (run first)

Before doing anything else, run the project's test suite. The `.gtdrc`
`testCommand` config takes precedence if set; otherwise determine the command
from AGENTS.md / `package.json` scripts / Makefile.

- **On failure:** make exactly **ONE** fix, then commit **all** the fix changes
  into a single commit with a `fix(gtd): <desc>` message. Do not commit
  `TODO.md` — leave it dirty (the working tree should end with only `TODO.md`
  pending, or otherwise clean). Then **re-run gtd** and stop; the gate will
  re-evaluate on the next cycle.
- **On green:** proceed inline with the task below in this same run.

## Task: Confirm the working tree is healthy and fully reviewed

The working tree is clean, there is no unreviewed diff (no resolvable review
base, or the review base equals HEAD). Nothing is pending.

### Steps

1. Run tests, typecheck, lint (whatever the project has configured).
2. If all pass → report **"working tree healthy and fully reviewed"** and
   **STOP**. Do not re-run gtd.

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

**Tag every debug log** with a unique prefix: `[DEBUG-xxxx]` Cleanup becomes a
single grep. Untagged logs survive; tagged logs die.

#### Phase 4: Fix and verify

1. Apply the fix
2. Verify the original feedback loop passes
3. Run full test suite to check for regressions

#### Phase 5: Cleanup

Before declaring done:

- [ ] Original failure no longer reproduces
- [ ] All `[DEBUG-*]` instrumentation removed (grep the prefix)
- [ ] Full test suite passes

**STOP.** Do not re-run gtd after fixing. Report the outcome and wait for the
human to decide the next step.
