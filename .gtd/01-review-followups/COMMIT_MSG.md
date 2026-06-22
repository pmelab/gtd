fix(gtd): tighten review-base payload coherence, CRLF subjects, and guard test coverage

Resolve the four follow-up items from the event-sourced state-machine review
(base 939f65b). No behavior-visible bugs were found; these are
correctness-hygiene and test-coverage items.

- Events.ts: initialize reviewBasePresent to false and set it true only inside
  the non-empty-diff branch, so reviewBasePresent and refDiff always agree
  (no more reviewBasePresent:true / refDiff:undefined payloads).
- Git.ts: trim each line in commitSubjects so CRLF checkouts no longer leave a
  trailing \r on commit subjects (matching sibling git operations).
- Prompt.test.ts: add buildPrompt cases for the execute, cleanup, decompose, and
  execute-simple leaves (section render + auto-advance partial).
- Machine.test.ts: add edge cases for reviewBasePresent-with-empty-refDiff
  resolving to verified, and escalate winning over post-cap leaves once the
  fix(gtd) counter hits the cap.
