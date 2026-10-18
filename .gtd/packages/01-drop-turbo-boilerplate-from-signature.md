# 01 — Drop turbo boilerplate from the failure signature

## Requirements

- **1. Drop turbo boilerplate from the signature** — drop every task-prefixed
  line turbo writes itself: the cache line (`cache miss, executing <hash>` /
  `cache bypass, force executing <hash>` / `cache hit, replaying logs <hash>`),
  the up-to-2 `> ` echo lines right after it, blank task lines, and
  `ERROR  command (…) … exited (<n>)`. **Never drop a line the task printed**,
  including a task's own `> ` line. **All-boilerplate stdout yields `""`.**
- **2. Test a boilerplate-only failure in two states** — two boilerplate-only
  states each print their full log and a plain `FAIL` label, never
  `same failure as`; boilerplate plus one real diagnostic stays non-empty and
  equal across states; real turbo `exit 1` gives `""`.

See `.gtd/ARCHITECTURE.md` for the filter rules and interface.

## Tasks

### 1. Position-based boilerplate filter in `failureSignature`

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

- [ ] Signature of `failureSignature(stdout, tasks)` unchanged; `reportFailure`
      untouched
- [ ] Per task, inside the existing loop after prefix match: cache line drops
      and opens an echo window of 2; blank/whitespace body drops anywhere
      without touching the window; `> ` line drops only while the window has
      echoes left; exit line (`^\s*ERROR\s+command \(.*\) .* exited \(\d+\)$`)
      drops; any other line is kept (normalised as today) and closes the window
- [ ] A task line with no preceding cache line never opens the window — existing
      hand-written tests keep their signatures
- [ ] Unit: hand-written boilerplate-only block (cache line, blank, `> boom`,
      `> exit 1`, blank, `ERROR  command (…) … exited (1)`) returns `""` for
      each of the three cache-line wordings
- [ ] Unit: boilerplate head plus a task-printed `> quoted` after the two echo
      lines returns a non-empty signature containing `> quoted`
- [ ] Unit: two boilerplate-only stdouts, differing hashes, same command, each
      return `""`
- [ ] Unit: boilerplate plus one real diagnostic line gives a non-empty
      signature equal across two states with differing hashes
- [ ] Unit (real turbo): script `exit 1`, no echo, gives `""`, beside the
      existing `boom-line` test
- [ ] Unit (real turbo): script `echo "> quoted"; exit 1` gives a signature
      containing `> quoted`

### 2. `runStates` never collapses a boilerplate-only failure

Paths: `tests/tooling/test-states.test.ts`

- [ ] Unit: two failing states with boilerplate-only stdout (differing hashes,
      same command) each print their full log and end on a plain
      `test-states: <label> — FAIL` line
- [ ] Output holds no `same failure as`
- [ ] Full suite green (`npm test`)

## Tests

- unit: `tests/tooling/test-states.test.ts`
