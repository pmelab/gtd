feat(gtd): add execute-simple branch for lightweight tasks

- Add "execute-simple" to Branch type
- Detect `<!-- simple -->` marker in finalized TODO.md
- Route to execute-simple instead of decompose when marker present
- Create execute-simple.md prompt (single worker, no .gtd/ packages)
- Register prompt in Prompt.ts with auto-advance
- Add integration tests for marker detection
