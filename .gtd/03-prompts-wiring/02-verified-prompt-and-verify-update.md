# Add the verified prompt and update verify.md to auto-advance

Create the terminal `verified` prompt, and change `verify.md`'s happy path from
"STOP, do not re-run gtd" to auto-advancing on green so the workflow reaches
`human-review` on the next run.

## Files

- `src/prompts/verified.md` (new)
- `src/prompts/verify.md` (modify happy path only)

## verified.md (new)

Residual terminal prompt for an already-reviewed, healthy tree (no resolvable
review base, or base == HEAD):

- Heading: `## Task: ...` consistent with the other prompts' style.
- Steps: run tests / typecheck / lint (whatever the project has configured); on
  green, report "working tree healthy and fully reviewed" and **STOP**.
- On failure, reuse the same structured-diagnosis discipline as `verify.md` (you
  may keep it brief or reference the same phased approach — do not silently drop
  the failure path).
- Terminal: STOP, no re-run gtd.

## verify.md (modify)

Currently the happy path (lines ~6-10) says: "If all pass → report success and
STOP. Do not re-run gtd." Change ONLY the happy path so that on green it
**auto-advances** (re-runs gtd) so the next run can reach `human-review`.

- Replace the "STOP. Do not re-run gtd" happy-path wording with an instruction
  to re-run gtd on success (the `auto-advance` partial will also be appended
  programmatically once `verify` is added to `AUTO_ADVANCE_BRANCHES` in task 03
  — keep the prompt body consistent with that, i.e. do not tell the user to STOP
  on green).
- Keep the entire "On failure — structured diagnosis" section unchanged. On
  failure the agent still stops and diagnoses (the auto-advance partial already
  says: stop and report if an unrecoverable error needs a human decision).

NOTE: the `auto-advance.feature` scenario "Verify prompt contains STOP and no
auto-advance" will be updated in package 04 — do not worry about it here, but be
aware your wording change is what makes it require updating.

## Constraints

- Match the existing prompt heading/format conventions.
- `verified.md` must be terminal (STOP, no auto-advance) — it is intentionally
  NOT added to `AUTO_ADVANCE_BRANCHES`.
- Do not change `verify.md`'s failure-path diagnosis content.

## Acceptance criteria

- [ ] `src/prompts/verified.md` exists, runs tests, reports "healthy and fully
      reviewed", and STOPs.
- [ ] `verify.md` happy path now instructs re-running gtd on green (no STOP on
      success).
- [ ] `verify.md` failure-path diagnosis section is unchanged.
