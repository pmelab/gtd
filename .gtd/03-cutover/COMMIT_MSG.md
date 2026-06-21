refactor(gtd): cut over to the event-sourced state machine

Rewrite `detect()` to gather events → fold through the machine → return a single
resolved state; drop the `branches[]` model, ref-arg/review-create path, and
`diffAddsTodoMarker`. Rework `Prompt.ts` to emit one section per leaf with a
flag-driven auto-advance, add `escalate.md` + test-gate preambles, fold
`TODO:`-marker extraction into review-process, and delete the dead
`verify`/`todo-markers`/`review-create` prompts. Update unit + cucumber suites
(no ref arg, markers-are-code, new verify-loop coverage).
