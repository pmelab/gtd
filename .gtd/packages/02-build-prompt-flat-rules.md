# 02 — Build prompt: flat SATISFIED rules

See `.gtd/ARCHITECTURE.md` (Package B, Interfaces) for the pinned rule text.
Independent of package 01.

## Requirements

**Concern 2 — Build prompt states the `.gtd/SATISFIED.md` rules flat, with no
"otherwise".** Replace the single "First check…" bullet in
`packagesItemBuildingPrompt` with four flat rules:

- First check the acceptance criteria against the current tree — an earlier fix
  turn may already meet them
- **Every criterion already met in the tree**: write `.gtd/SATISFIED.md` with
  evidence per criterion — commit, file, symbol, issue URL, or command output —
  and change nothing else
- **No `## Tests` and work outside the tree**: first check it was not already
  done by an earlier attempt (e.g. existing issue with the same title via `gh`)
  and reuse that as evidence, or do the work; then write `.gtd/SATISFIED.md`
  with that evidence and change nothing else in the tree
- **Any other package: implement normally, write no `.gtd/SATISFIED.md`**

**The word "otherwise" appears nowhere in the prompt.** Wording may tighten;
substance may not drop. The remaining bullets (tests first, `(unchanged)` needs
only to exist, e2e wording, fan-out, leave the package file) stay as they are.

## Tasks

### 1. Rewrite the SATISFIED bullet

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] Single bullet replaced by the four flat rules above
- [ ] Unit: prompt never matches `/otherwise/i`
- [ ] Unit: prompt carries "evidence per criterion", "commit", "symbol", "issue
      URL", "command output", "it was not already done", "via `gh`", "change
      nothing else"
- [ ] Unit: names the already-met case, the no-`## Tests` out-of-tree case, and
      the implement-normally case with "no `.gtd/SATISFIED.md`"; old "met by
      work outside the tree" and "do the work, then write the file" assertions
      replaced
- [ ] Unit: existing `(unchanged)` / "needs only to exist" / "leave that file
      alone" case still passes unchanged

## Tests

- unit: `src/workflows/shared/text.test.ts`
