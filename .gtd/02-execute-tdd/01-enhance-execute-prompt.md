# Task: Enhance `execute.md` with TDD Anti-Horizontal-Slicing Rules

## File to modify

`src/prompts/execute.md`

## Current content (relevant section)

The file currently says:

```markdown
### Step 1: Spawn task workers

For each task file in the current package, spawn a **parallel subagent** with:

- **Model**: The execution model from AGENTS.md (or current work model)
- **Skill**: Inject the `tdd` skill — workers write tests first, then implement
- **Context**: The task file content only (self-contained)
- **Fresh context**: Each worker starts fresh, no conversation history
```

The problem: "Inject the `tdd` skill" is vague. Workers don't have access to external skills. The rules need to be inline.

## Source intelligence to embed (from tdd skill)

### Anti-Pattern: Horizontal Slices

> **DO NOT write all tests first, then all implementation.** This is "horizontal slicing" - treating RED as "write all tests" and GREEN as "write all code."
>
> This produces **crap tests**:
> - Tests written in bulk test _imagined_ behavior, not _actual_ behavior
> - You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior

### Correct approach

> **Vertical slices via tracer bullets.** One test → one implementation → repeat. Each test responds to what you learned from the previous cycle.
>
> ```
> WRONG (horizontal):
>   RED:   test1, test2, test3, test4, test5
>   GREEN: impl1, impl2, impl3, impl4, impl5
>
> RIGHT (vertical):
>   RED→GREEN: test1→impl1
>   RED→GREEN: test2→impl2
>   ...
> ```

### Test quality

> **Tests should verify behavior through public interfaces, not implementation details.** Code can change entirely; tests shouldn't. A good test survives refactors — if renaming an internal function breaks the test, it's testing implementation.

## What to change

Replace the "Skill" bullet point with inline TDD rules. Change this:

```markdown
- **Skill**: Inject the `tdd` skill — workers write tests first, then implement
```

To this expanded version:

```markdown
- **TDD discipline** (inline rules for workers):
  - Write ONE test → implement → pass → repeat (vertical slices)
  - **DO NOT** write all tests first then implement (horizontal slicing)
  - Tests verify behavior through public interfaces, not implementation details
  - A good test survives refactors — if renaming an internal function breaks the test, it's testing implementation
  - Each test responds to what you learned from the previous cycle
```

## Acceptance criteria

- [ ] The "Skill: Inject the tdd skill" bullet is removed
- [ ] Replaced with "TDD discipline" section containing 5 inline rules
- [ ] Rules explicitly forbid horizontal slicing (all tests first)
- [ ] Rules require vertical slices (one test → implement → repeat)
- [ ] Rules mention testing behavior not implementation
- [ ] Rules mention surviving refactors as a quality signal
- [ ] File is pure markdown, no TypeScript changes
