# Detect the "approved, no changes" REVIEW.md diff in Events.ts

Compute a new `reviewApprovedNoChanges` fact and surface it on `ResolvePayload`.
This is the first of the feature's two code edges: it detects a forward-tick-only
REVIEW.md diff so the machine (task 03) can route to the new `close-review` leaf.

## Files

- `src/Events.ts`
  - `REVIEW.md` probing block inside `if (reviewExists)` (`:184-206`) — after the
    existing `reviewModified` / base-ref checks, compute the new fact.
  - RESOLVE payload assembly (`:222-241`) — add `reviewApprovedNoChanges` to the
    `payload` object.
- `src/Machine.ts`
  - `ResolvePayload` interface (`:25-49`) — add the new field (this is a shared
    type; declaring it here is required for `Events.ts` to compile).

## Predicate — forward ticks ONLY

Set `reviewApprovedNoChanges: true` **iff ALL** of the following hold; otherwise
`false`:

1. `reviewModified` is true (REVIEW.md is dirty).
2. The only dirty path is `REVIEW.md` — i.e. `codeDirty` is false. (`codeDirty`
   is already computed at `Events.ts:158` as "any non-TODO entry". Approval
   requires no code edits; treat any non-`REVIEW.md` dirty path as
   disqualifying. Note: a dirty `TODO.md` does not set `codeDirty`, but for the
   close path require the only dirty entry to be `REVIEW.md` — exclude the case
   where `TODO.md` is also dirty by checking entries explicitly.)
3. Read committed REVIEW.md via `git.showHead(REVIEW_FILE)` (task 01) and the
   working copy via `fs.readFileString(REVIEW_FILE)` (already read into
   `reviewContent` at `:194-196`). Split both into lines.
4. Equal line counts AND no added/removed lines (compare positionally, line by
   line).
5. For **every** line that differs between committed and working:
   - committed side matches `/^- \[ \] /` (unticked), AND
   - working side matches `/^- \[x\] /` (ticked), AND
   - the two lines are identical after normalizing the marker (e.g. replace the
     leading `- [ ] ` / `- [x] ` with a common token, then string-equal). This
     guarantees only the checkbox marker changed and nothing on the rest of the
     line.
6. At least one line differs (a forward tick actually happened). If committed and
   working are identical, `reviewModified` would already be false, so this is
   defensive.

An **un-tick** (committed `- [x] `, working `- [ ] `) fails rule 5 →
`reviewApprovedNoChanges` is false → falls through to
`reviewModified → review-process`. A prose edit changes a non-checkbox line →
fails rule 5. A code edit sets `codeDirty` → fails rule 2.

## Implementation notes

- Read committed content with `git.showHead(REVIEW_FILE)` wrapped in
  `Effect.mapError((e) => new Error(String(e)))` to match the module's error
  style (see `:176`, `:194-196`).
- Guard the `showHead` call so it only runs when `reviewModified` is true — when
  REVIEW.md is unmodified the existing `Effect.fail` at `:187-193` already aborts
  before reaching here, but keep the read inside the modified branch regardless.
- Add `readonly reviewApprovedNoChanges: boolean` to `ResolvePayload` in
  `Machine.ts` with a short doc comment ("Forward-tick-only REVIEW.md edit:
  approve as-is, route to close-review.").
- Add `reviewApprovedNoChanges` to the `payload` literal at `:222-241`.
- The close short-sha for the prompt already flows: `reviewBaseRef` (parsed from
  `<!-- base: … -->` at `:205`) is passed through as `baseRef`. No new
  passthrough needed.
- Default the value to `false` whenever `reviewExists` is false (declare
  `let reviewApprovedNoChanges = false` alongside `reviewModified` at `:182`).

## Edge cases / constraints

- Whitespace/CRLF: split on `\n` and strip a trailing `\r` per line (mirror
  `parsePorcelainPaths` at `:24`) so CRLF checkouts don't spuriously differ.
- A REVIEW.md with zero checkboxes that only had prose edited must NOT match
  (rule 5 fails on the prose line).
- Do not change the existing "exists but has no changes" and "missing base ref"
  failure semantics (`:187-204`).

## Acceptance criteria

- [ ] `ResolvePayload.reviewApprovedNoChanges: boolean` exists in `Machine.ts`.
- [ ] `Events.ts` computes it per the predicate and includes it in the RESOLVE
      payload.
- [ ] Forward-tick-only edit (committed `- [ ]`, working `- [x]`, otherwise
      identical, no other dirty files) → `true`.
- [ ] Un-tick (`- [x]` → `- [ ]`) → `false`.
- [ ] Any prose/line-content change → `false`.
- [ ] Any non-REVIEW.md dirty path (code or TODO.md) → `false`.
- [ ] Existing failure paths unchanged; project typechecks.
