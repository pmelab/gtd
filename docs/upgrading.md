# Upgrading to v3 (BREAKING CHANGE)

## v3 is a clean break

v3 ("the pattern machine") deletes the entire v2 definition model — gates, guard
functions, actor kinds, interrupt/fallback ladders, capture rules, turn and
routing rules, `Gtd-Counters` trailers, conflicts, the review checkout window —
and replaces it with the much smaller pattern machine described in
[STATES.md](../STATES.md): named states, each with one content kind and an
ordered map of change-patterns to next states.

**All pre-v3 history is unrecognized and resolves to the initial state, by
design — v1 and v2 subjects alike.** v3's `resolveState`
(`src/PatternMachine.ts`) only recognizes its own `gtd(<actor>): <state>`
subject naming a state and an actor the active workflow currently declares;
everything else — a v1 `gtd: grilling`, a v2 `gtd(agent): building`, a plain
`chore: …` commit, anything from a foreign repo — parses as unrecognized and
lands at the workflow's initial state (`idle` in the bundled default). There is
no special-casing for "this looks like an old gtd commit": the mechanism is
exactly the same one that already made v1 history inert to v2, and v2 history
inert to a differently-configured workflow — v3 just applies it uniformly to all
prior history instead of drawing a v1/v2 line.

**Finish or squash any in-flight cycle first.** A repo mid-cycle on v1 or v2 has
no v3-shaped commit backing its steering files; upgrading mid-cycle lands cold
at the initial state with those files still pending, which the new workflow's
`on` patterns will classify as ordinary pending changes, not as the phase they
used to represent. Finish the cycle (or squash it) on the old binary first, or
manually clean up the steering files and commit a plain boundary, before
upgrading.

## What died

- **Counters.** `Gtd-Counters` trailers, `fixAttemptCap`/`reviewThreshold`
  config keys, and the counter-stamp machinery are gone. The only budget
  affordance left is a state's own `retry: { max, otherwise }`
  (§[STATES.md](../STATES.md#7-retry)) — a plain per-process entry cap
  redirected at write time, with no trailer to read back.
- **`.gtdrc` keys.** `testCommand`, `fixAttemptCap`, `reviewThreshold`,
  `agenticReview`, `squash`, `learning`, `decisionLog`, and `models` are all
  gone — `workflow:` is the only blessed key (see
  [Configuration](configuration.md)). A check's command now lives inline in its
  own `script:` content; squashing is a `commit:` state instead of a boolean
  flag; there is no learning phase, no decision log, and no model tiering — a
  workflow author is free to build any of that shape back with states of their
  own, but gtd no longer bakes it in.
- **The review checkout window.** v2 rewound HEAD/index to the review base while
  a human review rested, so editors would show the diff directly. Deleted in v3
  (may return later as an explicit state property — not in scope now).
- **`forceApprove`, content-inspection verdicts.** FEEDBACK.md emptiness,
  checkbox-only REVIEW.md diffs, and doc-structure validation are gone —
  verdicts are now expressed purely by which file a turn writes or deletes,
  matched by an ordinary `on` pattern (`D REVIEW.md` = approve, `M REVIEW.md` =
  feedback, in the bundled default).
- **`gtd questions` / `gtd changesets` / `gtd review <target>`.** Gone; the v3
  command surface is `step` / `next` / `run` / `status` / `format` (see
  [CLI reference](cli.md)).
- **Model tiers, the decision log.** No `models` config key, no `Gtd-Decisions`
  trailer scan, no grilling/architecting "prior decisions" context assembled
  from history.
- **LSP.** Not part of v3.

## How to adopt

`workflow:` is optional — with no config at all, the bundled default workflow
applies (the same grilling → architecting → decompose → building → checking →
reviewing → await-review → squashing → done shape v2 shipped, now expressed as
data rather than baked into the engine). Nothing to do for a repo that's happy
with the default shape beyond a normal `npm install -g @pmelab/gtd` upgrade,
from a settled (post-squash, idle) boundary.

A repo that customized v2's `workflow:` key (actors, gates, guard vocabulary,
ladders) needs to rewrite it from scratch in the v3 schema — see
[Configuration](configuration.md) for the schema and a complete worked example.
There is no automatic migration: the two vocabularies don't map field-for-field
(guards become patterns, capture rules become `on` targets, counters become
`retry`), so a v2 `workflow:` config is simply invalid v3 config and fails
loudly at load time rather than silently misinterpreting.

**Re-copy the loop skill.** If you vendor `skills/loop/` into a consuming repo
or agent harness, upgrading the `gtd` binary also means re-copying that skill
from this release.

## Prior breaking change: the v1 → v2 label grammar (historical)

v2 replaced v1's undifferentiated turn labels with six labels carrying the
branch outcome at capture time, moved steering files under `.gtd/`, and
introduced `Gtd-Counters` commit trailers. All of that is itself now superseded
by v3's clean break above — a v1 or v2 repo upgrades to v3 the same way
(finish/squash any in-flight cycle, then upgrade from a settled boundary);
there's no reason to upgrade v1 → v2 → v3 in two hops.

For maintainers: this repo releases via `semantic-release` reading Conventional
Commits, and needs **no config change** for a major bump — but the release
commit/PR **must carry a `BREAKING CHANGE:` footer** (or a `!` after the type)
for `@semantic-release/commit-analyzer` to compute the next major version rather
than a minor/patch bump.
