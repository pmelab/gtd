Remove the duplicated jev auto-selection scenario in
tests/integration/features/judge-run.feature (around line 286): after the
judge_sonnet cleanup it repeats the scenario at lines 265-283 exactly. Keep the
original, delete the copy (Greptile P2 on PR 375).
