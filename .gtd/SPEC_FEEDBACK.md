# Spec feedback — 02 Worktree discovery and the fleet screen

Three concrete defects. Everything else in T1–T6 checks out: all four suites are
green, `typecheck`/`lint`/`format:check` are clean, the discovery walk, the
projection, the three-part memo key, the error taxonomy and the screen all match
the spec.

## 1. `readFleet`'s per-worktree failure isolation is untested — the test is vacuous

`src/serve/Fleet.test.ts:84` ("keeps one broken worktree from failing the whole
fleet request") passes `roots: []`. `readFleet` then calls
`discoverWorktrees([])`, gets zero worktrees, and **never invokes `readBeat` at
all** — the `if (w.id === "throws") throw` branch is dead in the test, and
`expect(result.wantsYouCount).toBe(0)` is trivially true for an empty fleet.

Verified by mutation: making `readFleet`'s `catch` re-throw instead of returning
a Broken row leaves `src/serve/Fleet.test.ts` green.

T5's "one Broken worktree does not fail the whole fleet request" is therefore
unproven for `readFleet`. `src/serve/Beat.test.ts:197` does not cover it either
— it uses two separate `BeatCache` instances and never goes through `readFleet`.

Fix: give the test roots that actually discover worktrees (a real tmpdir with
two `.git` dirs, as `Discover.test.ts` does), have `readBeat` throw for one of
them, and assert the other row survives AND the throwing one comes back as a
`status: "broken"` row carrying the error message.

## 2. Rest sort compares ISO timestamps lexically — wrong across timezone offsets

`src/serve/Fleet.ts:44` (`compareRest`) orders rows with `ra.localeCompare(rb)`.
`rest` is `git log -1 --format=%cI`, which emits a **local offset, not `Z`**
(this checkout's HEAD: `2026-09-07T20:52:28+02:00`). A commit object carries the
committer's own offset, so a fleet mixes offsets routinely — any worktree whose
HEAD was committed by CI or a colleague in a different zone.

Failure: `2026-09-07T01:00:00+02:00` (= `2026-09-06T23:00Z`, the OLDER instant)
vs `2026-09-06T23:30:00-05:00` (= `2026-09-07T04:30Z`). Lexically the first
string is greater, so in Wants you (oldest-first) the longest-waiting worktree
sorts **last** instead of first — the exact inversion T4's "Wants you sorts
oldest rest first" forbids. `Fleet.tsx`'s `restAge` parses with `new Date`, so
the row DISPLAYS the correct age while sitting in the wrong position.

Fix: compare `Date.parse(rest)` (or `new Date(rest).getTime()`), not the
strings. Add a test with two rows whose offsets differ and whose lexical order
is the reverse of their instant order.

## 3. The concurrency cap bounds `gtd next --json`, not child processes

T3's criterion is "cold reads are capped at a fixed concurrency and a
30-worktree cold load **never has more than that many child processes alive at
once**". `coldRead` runs entirely inside `withSlot`, and its first act is
`readGitMeta` (`src/serve/Beat.ts:143`), which fires **three concurrent
`bash -c git ...` spawns** via `Promise.all`. With `concurrency: 8` that is up
to **24 live child processes**, not 8.

`src/serve/Beat.test.ts:291` only counts invocations where
`command === "gtd next --json"`, so it passes while the stated bound does not
hold.

The three git calls are cheap next to the 520–660 ms bundle parse, so the
performance intent is met — but the criterion as written is not, and the test
does not measure what the criterion says. Resolve one of the two: bound total
spawns per slot (serialize or gate `readGitMeta`), or make the test assert the
cap on `gtd next --json` specifically and amend the criterion's wording to
match.
