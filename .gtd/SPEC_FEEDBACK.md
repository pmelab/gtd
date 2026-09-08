# Spec feedback — 05 Handing the turn back, and loop lifecycle

## 1. T6: "a worktree left dirty at a prompt rest reads as interrupted" is not implemented

Nothing in the server or the phone distinguishes a dirty prompt rest from a
clean one, so a worktree whose loop was killed by a restart reads exactly like
one an agent is still working on.

- `src/Beat.ts#beatKindOf` returns `prompt` for
  `{contentKind: "prompt", dirty: true}` (pinned by `src/Beat.test.ts:79`) — the
  beat `kind` carries no dirtiness at a prompt rest.
- `src/serve/Beat.ts#FleetRow` (lines 57–74) projects `kind`/`actor`/`idle`/
  `rest`/`logMtime`/`file`/`mode` and DROPS the beat's `changes` field, the only
  thing that says the tree is dirty.
- `src/serve/Fleet.ts#bucketOf` therefore buckets such a row as `working` (not
  idle, actor agent) with no registry entry behind it.
- `src/web/screens/Fleet.tsx` renders no interrupted state; the string
  "interrupted" appears nowhere in `src/` outside `generated.html`'s bundled
  React.
- No test asserts this criterion — `src/serve/Fleet.test.ts`,
  `src/serve/Registry.test.ts` and `src/serve/Server.test.ts:421` cover only "no
  Working rows carried over".

Fix must surface the dirty-at-prompt reading on the row itself and pin it with a
test.

## 2. T1/requirement 6: captured loop output can be truncated — `exit`, not `close`

`src/serve/Loop.ts#liveLoopSpawn` resolves `wait` from
`child.once("exit", ...)`. Node's `exit` fires when the process terminates,
BEFORE its piped stdio streams are necessarily drained and closed; `close` is
the event that guarantees both. So `LoopOutcome.stdout`/`stderr` — and the
`LoopFailure` that `src/serve/Registry.ts#register` copies out of them for
`Fleet.tsx#LoopFailureDetail` — can be missing the tail of a failing loop's
output.

Failure scenario: a loop command that writes several hundred KB to stderr and
exits 1. The fleet row shows a partial error, silently cut mid-stream, breaking
requirement 6's "failures show the captured output and the exit code inline,
since gtd exits 1 for every refusal and the text is the only thing that
distinguishes them" — the distinguishing text is exactly what gets lost.

This is also inconsistent with the codebase: `src/serve/Beat.ts:116` uses
`execFile`, whose callback fires only after stdio is fully collected.

Fix: resolve on `close` (keeping the `error` branch and the `settled` guard as
they are), and add a test spawning a child that emits output large enough to
exceed one pipe buffer immediately before exiting.
