# Requirements: PR 393 review round 2 — boilerplate-only failures never collapse

Source: the `.gtd/TODO.md` directive in entry commit `686b76d0`. Scope is
`failureSignature` in `scripts/test-states.ts`, its tests in
`tests/tooling/test-states.test.ts`, and the collapsing paragraph in
`docs/development.md`.

**Risk: today a failing state whose log is pure turbo boilerplate gets a
non-empty signature, so two unrelated silent failures collapse into one
`same failure as <state>` line and hide the second.** Verified against real
turbo 2.10.9: a script `exit 1` with no output still emits
`boom: cache miss, executing <hash>`, `boom: > boom`, `boom: > exit 1`, blank
`boom: ` lines and `boom:  ERROR  command (<cwd>) … npm run boom exited (1)` —
all task-prefixed, all kept by the current filter.

## Concerns

### 1. Drop turbo boilerplate from the signature — TECHNICAL

- **Drop every task-prefixed line turbo writes itself, not the task:** the
  `cache miss, executing <hash>` / `cache bypass, force executing <hash>` /
  `cache hit, replaying logs <hash>` line, the `> <script>` and `> <command>`
  echo lines, task-prefixed lines that are blank after the prefix, and the
  `ERROR  command (…) … exited (<n>)` line.
- **Never drop a line the task itself printed** — a real diagnostic that starts
  with `> ` (a code frame, a quoted line) must still count. How the echo lines
  are told apart (position at the head of a task's block vs. a pattern) is the
  build's call; the test in concern 2 pins it.
- **A failure whose task lines are all boilerplate yields `""`**, which
  `reportFailure` already treats as "never collapse, print the full log".

### 2. Test a boilerplate-only failure in two states — TECHNICAL

- **Unit test: two states whose stdout holds only boilerplate (differing hashes,
  same command) each print their full log and a plain `FAIL` label — no
  `same failure as` line**, and `failureSignature` returns `""` for each.
- **Unit test: boilerplate plus one real diagnostic line still gives a non-empty
  signature equal across two states** — so the filter cannot pass by dropping
  everything.
- **Real-turbo test: a silent failing script (`exit 1`, no echo) gives `""`**,
  beside the existing `boom-line` test, so the filter is pinned to turbo's real
  output, not a hand-written imitation of it.

### 3. Document that a diagnostic-free failure never collapses — PRODUCT

- **`docs/development.md`'s collapsing paragraph gains one sentence:** a failing
  state that prints nothing beyond turbo's own lines is always shown in full,
  never collapsed.

## Answered Questions

### Do only the two named line kinds count as boilerplate, or also turbo's blank and `ERROR … exited (n)` lines?

All of them: the directive's stated goal is "no diagnostic output yields an
empty signature", and real turbo's blank and `ERROR … exited (1)` lines would
keep that signature non-empty, so dropping only the two named kinds misses the
goal.

### Should a diagnostic-free failure still print its log?

Yes: it prints in full as today; only collapsing is suppressed, so the human
still sees which task failed.

### Should the three deferred review notes (836985b, daed27f, eda53bb) be folded in?

No: the human deleted them in the entry commit, which drops them from this
process.
