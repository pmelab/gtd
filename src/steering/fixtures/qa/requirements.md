# Review note severity tiers (issue #270, T3b)

Sketch: `.gtd/TODO.md` said "work on issue 270". Issue #270: at the
`review.triage` judge rest (T3, shipped), ask four narrow questions per human
note — `security` (yes/no), `reversibility` (one-way/two-way), `blastRadius`
(local/module/contract), `newConcept` (yes/no) — in the same commit, as more
`Gtd-Judge:` trailers. Flow code, never the model, turns the answers into a
tier: security yes or one-way → `critical`; contract or new concept → `should`;
else `could`.

## Open Questions

### Which notes get a severity tier?

T3 already routes each note by verdict: `edit` → planning lap, `question` →
answered in place, `nit` → one batched fix, `praise` → dropped. The tier can
reroute only edits, or also pull questions and nits into a lap.

- [ ] Only `edit` notes are tiered
  - critical/should edits → REQUIREMENTS.md now; could edits → TODO.md
  - Questions, nits, praise route exactly as today; no severity asked for them
  - A nit that renames a published API (one-way) is still fixed without a plan
  - Done-when holds only if the six style notes are judged `edit`, not `nit`
- [ ] Every note but praise is tiered; the tier only escalates
  - A critical/should question or nit goes to REQUIREMENTS.md instead of its T3
    route
  - A could question is still answered, a could nit still fixed now; only could
    edits are deferred
  - More judge questions per rest; a misjudged "touches auth" pulls a harmless
    nit into a full lap
- [ ] Every note but praise is tiered; could also defers nits
  - Same escalation as above, plus could nits go to TODO.md instead of being
    fixed
  - The T3 nit route then only fires for nothing — effectively retired
  - Matches the done-when literally whether style notes are judged edit or nit
- [ ] _your answer_

### What does "a lap cannot sign off with an open critical" enforce?

A critical note always goes to REQUIREMENTS.md, so the round it appears in
already cannot sign off. The fork is whether the NEXT round checks that the
critical was actually dealt with.

- [ ] Nothing extra: routing a critical into a lap is the block
  - No new step, no new guard
  - The next round signs off whenever the human signs off, even if the fix
    missed the point
- [ ] Carry each critical into the next REVIEW.md as an item the human must tick
  - The review gate refuses sign-off while any carried critical is unticked
  - New visible ritual in REVIEW.md; the human, not a model, decides "resolved"
- [ ] A judge asks "is this critical resolved?" per carried critical at sign-off
  - One more judge rest per signing round
  - Below-floor or unanswered keeps sign-off blocked, which can loop until the
    human edits again
- [ ] _your answer_

### What happens to deferred `could` notes in `.gtd/TODO.md`?

TODO.md is the human's sketch file at `idle`. A deferred note written there mid
process gets committed onto the branch, and the next process's `unwind` only
reverts what the human adds at `idle` — not what is already committed — so
deferred notes do not reach the next triage on their own.

- [ ] Append them to TODO.md and leave them committed; the human pulls them into
      a later process by hand
  - Smallest build
  - `.gtd/TODO.md` ships in the branch/PR unless the human deletes it
  - Deferred items are only a reminder until a human re-types or re-touches them
- [ ] Append them to TODO.md, and the next ordinary start treats a committed
      TODO.md as part of its sketch
  - Deferred items become concerns of the next process automatically
  - Changes what `unwind`/triage read for every ordinary start
  - `.gtd/TODO.md` still sits in the branch until that next process
- [ ] Do not commit them: hand them back at sign-off (message or summary), tree
      stays clean
  - No `.gtd/` file leaks into the PR
  - Deviates from the issue's "TODO.md as a deferred package"; nothing persists
    unless the human copies it
- [ ] _your answer_

## Concerns

### 1. Severity questions at the triage rest — PRODUCT

The `review.triage` rest asks the four severity questions per tiered note (which
notes: open question above) alongside the T3 verdict, in one commit. Question
wording follows the issue: one-way covers migrations, published API shapes, file
formats, anything another system depends on by tomorrow; new concept is judged
against the code, never a glossary file, and reusing or extending an existing
concept is not new.

### 2. Tier derivation and guard rails — PRODUCT

Flow code derives the tier: security yes OR one-way → `critical`; contract OR
new concept → `should`; else `could`. Deferring is the risky direction: an
unanswered question, truncated evidence, or `p` below `reviewSeverityMinP` makes
the note `critical`, never `could`. A human note starting with `!` is `critical`
and gets no severity questions.

### 3. Routing by tier — PRODUCT

`critical` + `should` → `.gtd/REQUIREMENTS.md` this round, via the existing
collecting turn. `could` → `.gtd/TODO.md` as a deferred package (lifecycle: open
question above). Inside REQUIREMENTS.md: one-way doors first, then new concepts,
then the rest in note order.

### 4. Sign-off block on criticals — PRODUCT

A round with an open critical cannot sign off (what counts as resolved: open
question above).

### 5. `!` marker in the review format — TECHNICAL

`src/steering/review.ts` recognises the leading `!` on a human note and strips
it from the text the folding turn sees.

### 6. New process setting `reviewSeverityMinP` — TECHNICAL

Default and fold-time recording per the answered questions below; outcomes stay
re-foldable from the recorded trailers (T7, #272), never re-asked.

### 7. Acceptance — PRODUCT

A review with one one-way-door note, one new-concept note and six style notes
produces REQUIREMENTS.md with two entries (one-way door first) and TODO.md with
six, and sign-off stays blocked until the one-way door is resolved. Cucumber
scenarios cover it; README and `docs/` reflect the `!` marker, the new setting
and the deferral.

## Answered Questions

### Where does the `!` go, and on which notes?

As the first character of the human's own note text, on any note kind — pointer
note, footnote, chunk prose — stripped before folding; prefixing the pointer
path itself would break the pointer parse, and one rule for all kinds is easier
to remember.

### Does a REQUIREMENTS.md entry show its tier?

Yes: each folded note names its tier and the answer that earned it ("critical:
one-way door", "critical: forced by `!`", "critical: judge unsure"); the issue
rejects a single score for being unauditable, so the reason must be visible.

### What order do concerns take inside REQUIREMENTS.md?

One-way doors, then new concepts, then every other critical/should note in
document order — the issue fixes the first two; document order is the existing
tie-break.

### What is `reviewSeverityMinP`'s default, and what does a blank value do?

`0.7`, one floor for all four questions, matching `reviewNoteActionable` and
`judgeIdenticalMinP`; a blank value makes every tiered note `critical`, the same
fail-safe a blank `reviewNoteActionable` gives (every note an `edit`).

### What happens without a configured judge?

Same as T3: the rest surfaces to the driver, which answers the extra questions
like the verdict; no separate fallback.
