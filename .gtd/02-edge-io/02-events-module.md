# Task: Build the edge-IO event-gathering module

Create `src/Events.ts` — the Effect edge that gathers all git/FS facts and
produces the typed event array (`COMMIT[]` then one `RESOLVE`) the machine folds.
This is where ALL IO lives; the machine stays pure.

## What to build

`gatherEvents(): Effect.Effect<ReadonlyArray<Event>, Error, GitService |
FileSystem.FileSystem>` that:

1. **COMMIT events**: compute the stream base —
   `mergeBase(resolveDefaultBranch(), HEAD)` when both resolve, else `undefined`
   (whole history fallback). Call `git.commitSubjects(base)` and map each subject
   to `{ type: "COMMIT", isFixGtd: /^fix\(gtd\):/.test(subject) }`, oldest →
   newest.

2. **RESOLVE event**: assemble `ResolvePayload` from the working tree —
   port the probing currently in `src/State.ts#detect()`:
   - porcelain parse → `codeDirty` (any non-`TODO.md` entry), `todoDirty`
     ("new" if status has `?`/`A` else "modified" if `TODO.md` present, else null)
   - `.gtd` packages (reuse `getPackages` logic) → `hasPackages`, `gtdDirExists`
   - `TODO.md` finalized check (no `<!-- user answers here -->`, code-stripped) →
     `todoFinalized`; `<!-- simple -->` → `todoSimple`
   - REVIEW.md present + modified → `reviewModified`; read its `<!-- base: -->`
     for `baseRef` (keep the existing corruption/unmodified error behavior)
   - `computeReviewBase` → `reviewBasePresent` + `refDiff` (`diffRef(base)`)
   - passthrough: `lastCommitSubject`, `workingTreeClean`, `packages`, `diff`
     (`diffHead`)

3. **Move `computeReviewBase` here** from `State.ts` (export it; `State.ts` will
   import from here in the cutover package). Keep its logic identical.

## Acceptance criteria

- [ ] `src/Events.ts` exports `gatherEvents()` returning `COMMIT[]` + one
      `RESOLVE`, typed to `Machine.ts`'s event types
- [ ] `computeReviewBase` lives in `Events.ts`, behavior unchanged
- [ ] All IO (git + FS) is in this module; no machine logic here
- [ ] `npm run typecheck` passes (module compiles even though not yet wired into
      `detect()`)

## Files

- `src/Events.ts` (new)
- Reference/source of truth to port: `src/State.ts` (`detect()` body
  lines 173–284, `computeReviewBase` lines 77–125, `getPackages` lines 55–75,
  `parsePorcelainPaths` lines 38–43, finalized/marker checks lines 186–203)
- `src/Machine.ts` (event/payload types from package 01)
- `src/Git.ts` (`commitSubjects` from sibling task)

## Constraints

- Preserve the existing REVIEW.md error semantics (exists-but-unmodified →
  error; missing base comment → error).
- Do NOT modify `State.ts`/`Prompt.ts`/`main.ts` yet — that is the cutover
  package. To keep the build green, `Events.ts` may temporarily re-export
  `computeReviewBase` while `State.ts` still references its own copy, OR leave a
  thin re-export; the cutover package removes the duplication.
