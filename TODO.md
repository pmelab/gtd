# Plan

## Work packages

### 1. Add `squashCommit` edge action to Machine.ts

In `src/Machine.ts`:

- Add
  `{ readonly kind: "squashCommit"; readonly squashBase: string; readonly commitMessage: string }`
  to the `EdgeAction` union (after `done`).
- Change the `squashing` rule (line ~611) to set `autoAdvance: false` and
  `edgeAction: undefined` — squashing is now a **prompt-bearing STOP state**
  (the agent writes the commit message, then the edge performs the commit on the
  next invocation).
  - Actually, revisit: the squashing state currently has `autoAdvance: true` and
    no `edgeAction`. The agent runs, outputs a commit message to stdout, and
    then what? The driver just emits the prompt — it cannot read the agent's
    output. The commit must happen on a _separate_ invocation after the agent
    has written the message somewhere the edge can read.
  - **Chosen approach**: the agent writes the commit message to a file
    `SQUASH_MSG.md` in the repo root (like REVIEW.md / FEEDBACK.md), then
    re-runs gtd. On the next invocation the edge sees `SQUASH_MSG.md` present,
    reads it, runs `git reset --soft <squashBase>` +
    `git commit -m "<message>"`, removes `SQUASH_MSG.md`, and the loop
    continues.
  - This requires:
    - A new `squashMsgPresent` flag in `ResolvePayload` (gathered from fs)
    - A `squashMsgContent` string in `ResolvePayload` (full file text)
    - New machine rule: when `squashMsgPresent` AND state would be `squashing`,
      return `edgeAction: { kind: "squashCommit", squashBase, commitMessage }`
      with `autoAdvance: true`.
    - `squashCommit` edge action in `perform()`: read the commit message from
      `action.commitMessage`, run `git reset --soft action.squashBase`, run
      `git commit -m action.commitMessage`, remove `SQUASH_MSG.md`.

**Changes to `src/Machine.ts`**:

- Add `squashMsgPresent: boolean` and `squashMsgContent: string` to
  `ResolvePayload` and `DEFAULT_PAYLOAD`.
- Add
  `{ readonly kind: "squashCommit"; readonly squashBase: string; readonly commitMessage: string }`
  to `EdgeAction`.
- In the `squashing` rule (~line 611): if `p.squashMsgPresent` and
  `p.squashBase !== undefined`, return
  `{ state: "squashing", autoAdvance: true, edgeAction: { kind: "squashCommit", squashBase: p.squashBase, commitMessage: p.squashMsgContent }, context }`.
  Else return the current no-action result (prompt the agent).

### 2. Update `src/prompts/squashing.md`

Two changes:

1. **Remove the git commands** — the agent must NOT run `git reset --soft` or
   `git commit`. Instead it writes the commit message to `SQUASH_MSG.md` and
   re-runs gtd.

2. **Add grilling-decision extraction** — instruct the agent to scan the
   full-process diff for `gtd: grilling` commit content (TODO.md changes visible
   in the diff) and include important decisions/trade-offs found there in the
   commit body.

New prompt structure:

- Read the full-process diff (inlined below).
- Identify the `gtd: grilling` rounds in the diff by looking at changes to
  TODO.md — extract key decisions, trade-offs, and design choices made during
  grilling.
- Draft ONE conventional-commits message:

  ```
  type(scope): subject

  body (explain the why — motivation, trade-offs, key decisions from grilling)
  ```

- Write the commit message to `SQUASH_MSG.md` in the repo root (plain text, no
  markdown wrapper).
- Run `gtd format SQUASH_MSG.md` to normalize.
- Re-run gtd to let the edge perform the actual squash commit.

### 3. Add `softResetTo` to `Git.ts`

A new method `softResetTo(ref: string)` that runs `git reset --soft <ref>`.

Add to `GitOperations` interface and `GitService.Live` implementation.

### 4. Implement `squashCommit` in `src/Events.ts`

- Add `SQUASH_MSG_FILE = "SQUASH_MSG.md"` constant.
- Add `SQUASH_MSG_FILE` to `STEERING_FILES` (so it's excluded from code diffs
  and review diffs).
- In `gatherEvents`: probe `fs.exists(SQUASH_MSG_FILE)`, read its content if
  present; set `squashMsgPresent` and `squashMsgContent` on the payload.
- In `perform` switch: add `case "squashCommit"`: call
  `git.softResetTo(action.squashBase)`, then
  `git.commitWithMessage(action.commitMessage)`, then
  `fs.remove(SQUASH_MSG_FILE)`.

Need a new `commitWithMessage(message: string)` in Git.ts — runs
`git add -A && git commit -m "<message>"` (not `commitAllWithPrefix` which
appends no body). Actually `commitAllWithPrefix` just runs
`git commit --allow-empty -m "<prefix>"` — can reuse it but the squash commit
message may be multiline; need to verify `git commit -m` handles multiline. It
does. So use `commitAllWithPrefix` with the full message string, but rename the
concern: the prefix param in `commitAllWithPrefix` is actually the full `-m`
value. This is fine as-is — pass the whole message string.

Actually `commitAllWithPrefix` runs `git add -A` first. After
`git reset --soft`, the working tree has the original content but index is
reset. Need `git add -A` to re-stage everything, then `git commit -m`. So
`commitAllWithPrefix(message)` works correctly here.

Remove `SQUASH_MSG.md` BEFORE the `git add -A` so its removal is not staged into
the squash commit.

### 5. Update `src/Prompt.ts`

- Add `SQUASH_MSG_FILE` exclusion? No — Prompt.ts has nothing to change; it
  already renders the squashing state and inlines `squashDiff`. The squashing
  prompt change is purely in `squashing.md`.
- Check `EDGE_ONLY_STATES`: `squashing` is NOT in the edge-only set — the agent
  runs and produces SQUASH_MSG.md. This is correct: the state stays
  prompt-bearing.

### 6. Tests

**`src/Machine.test.ts`**:

- Add test: squashing state with `squashMsgPresent: true` → returns
  `squashCommit` edge action with correct `squashBase` and `commitMessage`.
- Add test: squashing state with `squashMsgPresent: false` → no edge action
  (pure prompt state).

**`src/Events.test.ts`**:

- Add test for `gatherEvents` with a `SQUASH_MSG.md` present:
  `squashMsgPresent: true`, `squashMsgContent` matches file contents.
- Add test for `perform({ kind: "squashCommit", ... })`: calls `softResetTo`
  then `commitAllWithPrefix`, removes the file.

**Cucumber scenario** for squashing:

- `Given squash is enabled`
- `Given HEAD is "gtd: done"` with squash base computable
- `When gtd runs` → outputs squashing prompt (agent sees it, writes
  SQUASH_MSG.md)
- `Given SQUASH_MSG.md contains "feat: add feature\n\nbody"`
- `When gtd runs` → edge performs squash commit, HEAD subject is
  `"feat: add feature"`

no open questions — run gtd to plan
