feat(prompts): add vertical slice rules to decompose.md

Extract intelligence from Matt Pocock's to-issues skill:
- New rule: packages must be vertical slices, not horizontal
- Each package demoable/verifiable on its own
- Prefer many thin packages over few thick ones
- Forbid "set up infrastructure" packages that deliver nothing testable
- Acceptance criteria must use checkbox format: `- [ ] Criterion`
