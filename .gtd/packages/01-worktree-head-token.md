# 01 — Worktree-correct HEAD token and in-place recovery

## Requirement

Answering a question on the phone refuses. The banner reads "Someone else
committed a change underneath you — reload to see the latest before trying
again." That sentence is `src/web/Refusal.tsx#13`, reachable only from
`reason: "stale-token"` with `moved: "sha"`. Nobody committed anything: the
process stopped at a human gate, the ui was started, nothing else was running.

**Root cause, proven by running it: `liveHeadSha` (`src/ui/Beat.ts#332`) returns
`undefined` in every linked worktree.** In a linked worktree `.git` is a file
pointing at `…/gtd/.git/worktrees/<name>`, so `worktreeGitDir` resolves there.
That directory's `HEAD` is `ref: refs/heads/<branch>`, and both fallbacks miss:
`join(gitDir, "refs/heads/<branch>")` does not exist — a linked worktree's
gitdir carries no `refs/` tree, branch refs live in the common directory named
by its `commondir` file — and `packed-refs` does not exist there either, so the
`.catch(() => "")` yields an empty string with no match. `git rev-parse HEAD` in
the same directory returns the sha without trouble.

**That `undefined` becomes a token that can never match.**
`src/ui/ReadSteeringFile.ts#61` coerces it to `""` (`?? ""`) and hands `""` to
the client; `src/ui/Write.ts#159` compares the raw `string | undefined` against
it, and `undefined !== ""` refuses. Every write behind `verifyForWrite` —
`writeNote`, `setValue`, `done` — refuses with `moved: "sha"`, on the first
attempt, forever, with no commit by anyone. **The phone is unusable in any
linked worktree, which is how this repository is worked on.**

The fix is two changes, both required:

- Resolve the ref through the common directory: keep reading `HEAD` from the
  per-worktree gitdir (it is per-worktree, correctly), but resolve
  `refs/heads/*` and `packed-refs` against the path in `commondir`. A bare
  40-hex detached `HEAD` keeps working as it does today.
- Delete the `?? ""` asymmetry. An unresolvable sha must refuse the READ with a
  named reason, never hand out a token no write can ever match. The current doc
  comment on `ReadSteeringFileDeps` argues the opposite — that a mismatch is "a
  normal, already-handled `stale-token` refusal either way" — and that reasoning
  is what shipped this bug; it goes with the code.

**HEAD stays in the compare-and-swap token, and the client recovers in place.**
On `moved: "sha"` the client refetches `readSteeringFile` and retries the write
once, silently; the banner appears only when that retry also refuses. A write
may therefore land one commit later than the human saw it, which is accepted.

Risk: **the retry must fire on `moved: "sha"` only, never on
`moved: "content-hash"`, and never more than once.** Retrying a content-hash
refusal silently overwrites an edit someone else made to the same file, and an
uncapped retry turns two clients writing the same file into a loop.

The refusal banner also gets an in-page recovery control instead of the word
"reload": a human told to reload on a phone loses their place in a deck.

## Task 1 — Resolve branch refs through `commondir`

`src/ui/Beat.ts#liveHeadSha` keeps reading `HEAD` from the per-worktree gitdir
(`worktreeGitDir`, correct as-is) and keeps the bare-40-hex detached branch
untouched. Add a private helper in the same file: read
`join(gitDir, "commondir")`, trim it, resolve it against `gitDir` when relative,
fall back to `gitDir` itself when the file is absent (the non-worktree case).
Both remaining lookups — the loose `refs/heads/*` file and `packed-refs` —
resolve against that common directory, never against `gitDir`.

Stays filesystem-only: no `git rev-parse` subprocess. A spawn per steering-file
read is exactly what this function exists to avoid.

Paths: `src/ui/Beat.ts`, `src/ui/Beat.test.ts`.

- [ ] `src/ui/Beat.test.ts` builds a real repo and a real `git worktree add` in
      a tmpdir and expects `liveHeadSha(linkedPath)` to equal
      `git rev-parse HEAD` run in that same linked worktree. No existing fixture
      covers a linked worktree at all — this test fails before the change.
- [ ] A second case runs `git pack-refs --all` in the main worktree first, then
      asserts the same equality — covering the `packed-refs` path through
      `commondir`.
- [ ] A detached-HEAD case (bare 40-hex `HEAD`) still resolves, proving the
      existing branch is untouched.
- [ ] `liveHeadSha` spawns no subprocess: the implementation contains no
      `CommandRunner`/`run` call.

## Task 2 — An unresolvable sha refuses the read

`src/ui/ReadSteeringFile.ts`'s refusal union gains a third member,
`"head-unresolved"`. Delete the `?? ""`, and delete the `ReadSteeringFileDeps`
doc comment defending it — that reasoning is what shipped the bug.
`src/ui/Router.ts#ReadSteeringFileRefusal`'s reason union grows the same third
member and keeps mapping non-`file-vanished` reasons to `BAD_REQUEST`.

Paths: `src/ui/ReadSteeringFile.ts`, `src/ui/Router.ts`, and their test files.

- [ ] A unit case: a `headSha` dep resolving `undefined` yields
      `{ ok: false, reason: "head-unresolved" }`, never an `ok: true` carrying
      `headSha: ""`.
- [ ] No `ok: true` result anywhere can carry an empty `headSha`.
- [ ] The router surfaces the new reason through the existing
      `error.data.readRefusal.reason` path with code `BAD_REQUEST`.
- [ ] The `?? ""` and the doc comment defending it are both gone from
      `src/ui/ReadSteeringFile.ts`.

## Task 3 — Screens render a read refusal by name

`src/web/screens/Plan.tsx`'s `view === undefined && !isLoading` prints "Could
not load the plan." for every failure and `src/web/screens/Review.tsx` does the
same — neither reads `error.data.readRefusal.reason`. Both containers now read
it and render one named sentence per reason, in the same style as
`src/web/Refusal.tsx#messageFor`.

`head-unresolved` gets a message that offers no retry, because a retry cannot
help: **"Can't read this repository's current commit — editing is disabled until
that's fixed."**

Paths: `src/web/screens/Plan.tsx`, `src/web/screens/Review.tsx`,
`src/web/screens/Plan.stories.tsx`, `src/web/screens/Review.stories.tsx`.

- [ ] A story per screen whose mocked `readSteeringFile` rejects with
      `readRefusal.reason: "head-unresolved"` renders that exact sentence, and
      renders no retry control.
- [ ] A story per screen with `reason: "file-vanished"` renders a different,
      named sentence — not the generic "Could not load the plan." fallback.

## Task 4 — One pure single retry, `moved: "sha"` only

New `src/web/staleRetry.ts`:

    withStaleShaRetry<T>(
      attempt: (tokens: CasTokens) => Promise<T>,
      tokens: CasTokens,
      refetch: () => Promise<CasTokens>,
    ): Promise<T>

It calls `attempt(tokens)`; on rejection it reads the refusal through
`src/web/api.ts#writeRefusalFrom` and rethrows unless
`reason === "stale-token" && moved === "sha"`; then it awaits `refetch()` and
calls `attempt(fresh)` exactly once, literally — no loop, no recursion, no
second catch. **The retry fires on `moved: "sha"` only and can fire at most
once, because there is no code path in the function that reaches the second call
twice.** A `content-hash` refusal never triggers a refetch at all.

Wiring: `Plan.tsx#usePlanMutations` and `Review.tsx`'s equivalent hook each
route `writeNote`, `setValue` and `done` through it. `refetch` is
`utils.readSteeringFile.fetch({ filePath, mode })` — `fetch`, not `invalidate`,
because the retry needs the fresh tokens as a value. The existing
`onSettled: invalidate` stays; a `fetch` populates the same cache entry, so the
two do not fight.

Paths: `src/web/staleRetry.ts`, `src/web/staleRetry.test.ts`,
`src/web/screens/Plan.tsx`, `src/web/screens/Review.tsx`.

- [ ] `src/web/staleRetry.test.ts` (unit project, same shape as
      `src/web/api.test.ts`): a `content-hash` refusal rethrows and `refetch` is
      never called.
- [ ] A `sha` refusal refetches exactly once, calls `attempt` exactly twice
      total, and resolves with the second attempt's value.
- [ ] A second `sha` refusal on the retried attempt rethrows, with `refetch`
      called exactly once — never twice.
- [ ] A non-refusal error (network failure, `writeRefusalFrom` returning
      `undefined`) rethrows untouched with no refetch.
- [ ] A `Plan.stories.tsx` story whose mocked `writeNote` refuses `moved: "sha"`
      on call one and accepts on call two, with `readSteeringFile` returning a
      new `headSha` in between: the write lands and no banner ever renders.
- [ ] The same story shape for `Review.stories.tsx`.
- [ ] `src/ui/Write.test.ts#353` is rewritten to assert the server still refuses
      a genuine sha move — the recovery is client-side and the server-side
      compare-and-swap does not soften.

## Task 5 — The banner recovers in place instead of saying "reload"

`src/web/Refusal.tsx`: `useRefusal.showRefusal(error, retry?)` stores an
optional thunk alongside the refusal state; `RefusalBanner` renders a
`Try again` button when one is present, clears the refusal when it resolves, and
re-shows on rejection. The thunk is the whole write path, so pressing it
refetches tokens through `withStaleShaRetry` again — never a replay against the
tokens that already failed. `Dismiss` stays.

Both `stale-token` sentences drop the word "reload"; the `sha` one now describes
a refusal that already survived one silent retry.

**Risk: `src/web/screens/Question.stories.tsx` lines 591, 622 and 697 pin the
old banner strings.** Changing the text without updating those three assertions
reds `npm run test:web`. What is pinned is that a genuine `content-hash` change
still shows the banner — not that the sentence is byte-identical.

Paths: `src/web/Refusal.tsx`, `src/web/screens/Question.stories.tsx`,
`src/web/screens/Plan.tsx`, `src/web/screens/Review.tsx`.

- [ ] A story where a write refuses `content-hash`: the banner appears with the
      updated sentence, and that sentence contains no "reload".
- [ ] Pressing `Try again` re-runs the write path and dismisses the banner when
      the write succeeds.
- [ ] Pressing `Try again` on a second refusal leaves the banner up with the
      refusal's message.
- [ ] `Question.stories.tsx` lines 591, 622 and 697 assert the new text and
      still prove the banner appears for a genuine content-hash change.
- [ ] `npm run test:web` and `npm run test:unit` both pass.
