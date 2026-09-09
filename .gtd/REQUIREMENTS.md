# Requirements

## Gate `gtd ui` on a human rest, not on the beat's content kind

PRODUCT. `gtd ui` refuses to start on both steps it exists for, and starts only
on steps no human sits at. The gate is on the wrong axis.

`isRenderable` (`src/ui/Server.ts#287`) admits a step only when its content kind
is `prompt`. Seven states in `src/workflows/unified.yaml` carry a `mode:`. The
two with `actor: human` — `build.review.await-review` (line 767, `mode: review`)
and the QA `answer` gate (line 390, `mode: qa`) — both declare `message:`, so
the beat reports kind `message` and the gate rejects them. The remaining five
are `actor: agent` or `actor: check`: `design.triage`, `architecture.author`,
`build.review.reviewing`, `build.review.deciding`, `build.review.collecting`.
Those are the only steps `gtd ui` will bind on today.

Verified live on this worktree resting at `build.review.await-review`: `gtd ui`
exits with "refuses to start — 'Awaiting your review' rests at message, which
has no phone screen".

The command exists to facilitate the steps where a HUMAN feeds a steering file.
Gate on that: a rest whose actor is human and whose `file` and `mode` resolve to
a registered steering format.

**Content kind is the wrong axis regardless of which kinds are listed.** A
`message` state's kind shifts to `capture` the moment the human dirties the
tree, so a kind-based test is unstable under the very editing the UI invites.

The startup gate is checked once, so it shares one defect with the mid-flight
staleness already recorded in the review: the server's view of the rest is a
snapshot. Both sides of that defect belong to this concern.

Two e2e groups pin the current behaviour and move with the gate:
`tests/integration/features/ui.feature#163` (the no-registered-format refusal)
and the `ui-lifecycle.feature` startup refusal cases, which assert exit 2 and no
bound port per non-renderable kind.
