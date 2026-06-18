feat(prompts): execute all packages in one run without stopping

Change execute.md to loop through all .gtd/ packages sequentially
instead of stopping after the first and waiting for re-invocation.

- Title: "Execute all work packages" (was "Execute the next work package")
- Opening: "Execute all packages sequentially, in numeric order, without pausing"
- Replace "Continue" stop-and-wait with "Continue to next package" loop:
  delete package dir → check for more → repeat or finish

Update integration test assertion to match new title.
Add scenario verifying both packages appear in output when multiple exist.
