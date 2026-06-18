feat(prompts): add structured diagnosis discipline to verify.md

Extract intelligence from Matt Pocock's diagnose skill:
- Happy path first (tests/typecheck/lint pass → done)
- On failure: 5-phase diagnosis protocol
- Phase 1: Build feedback loop (the core skill)
- Phase 2: Generate 3-5 ranked hypotheses before testing
- Phase 3: Instrument with tagged debug logs [DEBUG-xxxx]
- Phase 4: Fix and verify original feedback loop passes
- Phase 5: Cleanup checklist including instrumentation removal
