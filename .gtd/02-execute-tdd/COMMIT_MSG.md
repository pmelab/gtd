feat(prompts): inline TDD discipline rules in execute.md

Replace vague "Inject the tdd skill" with explicit rules:
- Vertical slices: one test → implement → pass → repeat
- Forbid horizontal slicing (all tests first then implement)
- Tests verify behavior through public interfaces
- Good tests survive refactors (implementation detail signal)
- Each test responds to learnings from previous cycle
