# Task: Update execute.md for continuous multi-package execution

## File to modify

`src/prompts/execute.md`

## Current content (complete)

```markdown
## Task: Execute the next work package

Work packages exist in `.gtd/`. Execute the lowest-numbered package.

### Orchestration
...

### Continue

After committing, the next `/gtd` invocation will pick up the next package
(or proceed to cleanup if none remain).
```

## Changes required

### Change 1 — Title and opening

Replace:
```
## Task: Execute the next work package

Work packages exist in `.gtd/`. Execute the lowest-numbered package.
```

With:
```
## Task: Execute all work packages

Work packages exist in `.gtd/`. Execute all packages sequentially, in numeric
order (01 before 02, etc.), without pausing between them.
```

### Change 2 — "Continue" section (end of file)

Replace:
```
### Continue

After committing, the next `/gtd` invocation will pick up the next package
(or proceed to cleanup if none remain).
```

With:
```
### Continue to next package

After committing a package:
1. Delete the package directory from `.gtd/`
2. Check if more packages remain in `.gtd/`
3. If yes: return to Step 1 for the next package
4. If no: done — all packages complete. The `.gtd/` cleanup will be handled
   on the next `/gtd` invocation if the directory remains.
```

## Acceptance criteria

- [ ] Title reads "Execute all work packages" (not "Execute the next work package")
- [ ] Opening line says "Execute all packages sequentially, in numeric order"
- [ ] Opening line says "without pausing between them"
- [ ] "Continue" section replaced with "Continue to next package" loop
- [ ] Loop instructs: delete package dir → check for more → repeat or finish
- [ ] No TypeScript changes — pure markdown edit
