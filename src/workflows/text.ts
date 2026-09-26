import { head, read, start, vars, type SummaryContext } from "../flows/index.js"

// The bundled workflow's prompts, messages and scripts. Each is evaluated
// when its step is reached, against the commit replay stands on.

/** A file the text inlines — its absence fails the step, the same way a missing template read did. */
const need = (path: string): string => {
  const content = read(path)
  if (content === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`)
  return content
}
export const idleMessage = (): string =>
  `No active gtd process.

To start one, make ANY change — a hand-edit to real code, a scratch
note, anything at all. .gtd/TODO.md is a good default
place to start sketching. gtd treats it as a SKETCH, not finished
work: the very next beat unwinds it out of your working tree (its
intent survives in history, for the triage phase to read), then
checks the test baseline is green, then triages the reverted diff
into ordered, classified concerns: product questions, then
technical questions, then one package per concern, built and
reviewed in parallel.

What each change does next (then run \`gtd land\`):
- **Start** — make any change — gtd unwinds it out of your working tree (its intent survives in history) before checking the test baseline is green, then triages the reverted diff into ordered, classified concerns and resolves product questions, then technical ones, before building each concern's package (**unwind** -> **start-gate.check**).
`

export const suiteCheckScript = (): string =>
  `#!/usr/bin/env sh
set +e
mkdir -p .gtd
# Sweep a raw review capture an earlier, abandoned process may have
# left behind — no ordinary path from deciding/collecting reaches
# this check.
rm -f .gtd/REVIEW_RAW.md
# And sweep the quality lap's own leftovers. \`.gtd/QUALITY_DONE.md\`
# is a PER-EPISODE guard that \`build.quality.seeding\` short-circuits
# on; the only other sweeper is \`packageLoop.picking\`, which an
# entry never visits. Without this, the second and later
# \`--entry fix-precheck\`/\`review-gate.check\` runs in a repository
# would silently skip every configured lens. An entry IS a new
# episode, so the whole lap state goes, not just the marker.
rm -f .gtd/NEXT_REVIEW.md .gtd/QUALITY.md .gtd/QUALITY_DONE.md .gtd/QUALITY_READY.md
rm -rf .gtd/reviews
${vars.testCommand} > .gtd/.check-output 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  if [ -s .gtd/.check-output ]; then
    mv .gtd/.check-output .gtd/FEEDBACK.md
  else
    rm -f .gtd/.check-output
    printf 'the test command failed with exit code %s and produced no output.' "$code" > .gtd/FEEDBACK.md
  fi
  # Stamp with HEAD so a repeat identical failure still re-registers
  # as an M/A edit instead of looking byte-identical (GREEN).
  printf '\\n<!-- gtd check %s -->\\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/FEEDBACK.md
else
  rm -f .gtd/.check-output
  rm -f .gtd/FEEDBACK.md
fi
`

export const unwindScript = (): string =>
  `#!/usr/bin/env sh
set +e
mkdir -p .gtd
# Hoisted here, at the TOP: Eta's autoTrim eats the newline after
# an interpolation tag, so no tag may be the last token on a line.
# Uses it.currentCommit (render-time), not bare HEAD, so a
# late-running driver still reverts the right commit.
commit="${head()}"
git revert --no-commit "$commit" 2> .gtd/.unwind-error
code=$?
# The revert's EXIT CODE is what separates a genuine no-op from a
# hard failure (e.g. a merge commit with no \`-m\`) — the diff alone
# cannot, since both can leave a clean tree. Turning the failure
# into a FEEDBACK.md write is what makes the \`C\` row below safe:
# once a failure always has a diff, a clean tree here means the
# revert really did succeed and change nothing.
if [ "$code" -ne 0 ]; then
  printf 'gtd could not unwind %s out of your working tree.\\n\\n' "$commit" > .gtd/FEEDBACK.md
  if [ -s .gtd/.unwind-error ]; then
    cat .gtd/.unwind-error >> .gtd/FEEDBACK.md
  else
    printf '\`git revert --no-commit\` exited %s and produced no output.\\n' "$code" >> .gtd/FEEDBACK.md
  fi
fi
rm -f .gtd/.unwind-error
`

export const unwindFailedMessage = (): string =>
  `gtd could not revert your sketch out of the working tree.
\`.gtd/FEEDBACK.md\` holds the error.

Undo the sketch by hand (its intent survives in history either
way), then continue — gtd will not start work on a tree that still
carries it.

What each change does next (then run \`gtd land\`):
- **Continue** — having undone the sketch by hand, check the test baseline is green and start triage (**start-gate.check**).
`

export const reUnwindScript = (base: string): string =>
  `#!/usr/bin/env sh
# Scoped revert of the human's review-round edit — .gtd/ excluded
# (the guard's isCodePath re-derives the same exemption; keep both
# in sync). Expected to succeed; requireRevert catches a silent
# apply failure.
set +e
# Hoisted here, at the TOP: Eta's autoTrim eats the newline after
# an interpolation tag, so no tag may be the last token on a line.
commit="${base}"
patch=.gtd/.re-unwind.patch
mkdir -p .gtd
git diff --binary "$commit^" "$commit" -- . ":(exclude).gtd" > "$patch"
if [ -s "$patch" ]; then
  git apply -R "$patch" || echo "re-unwind: could not revert $commit" >&2
fi
rm -f "$patch"
`

export const architecturePreMessage = (): string =>
  `Judging whether \`.gtd/REQUIREMENTS.md\`'s settled concerns need a
dedicated architecture pass — real structural decisions, multiple
integration points, or a non-obvious tradeoff — before packages
are written. Run \`gtd judge answer\` and pipe a verdict for
\`architectureWarranted\` — or land untouched to run the full pass
(the conservative default; a skipped judgment never suppresses
it).
`

export const architecturePromoteScript = (): string =>
  `#!/usr/bin/env sh
set +e
mkdir -p .gtd/packages
title=$(awk '/^\`\`\`/{f=!f} !f && /^## /{sub(/^## /,""); print; exit}' .gtd/REQUIREMENTS.md)
[ -z "$title" ] && title=package
slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' \\
  | sed 's/[^a-z0-9]\\{1,\\}/-/g; s/^-*//; s/-*$//')
[ -z "$slug" ] && slug=package
mv .gtd/REQUIREMENTS.md ".gtd/packages/01-\${slug}.md"
`

export const startGateBlockedMessage = (): string =>
  `The test baseline is red — gtd will not start new work on a broken suite.
\`.gtd/FEEDBACK.md\` holds the failing output.

What each change does next (then run \`gtd land\`):
- **Retry check** — edit the code and/or \`.gtd/FEEDBACK.md\` to fix the failing tests (**start-gate.check**). To repair the baseline as its own separate reviewed commit instead, abandon this start and run \`gtd --entry fix-precheck\` from a clean \`idle\`.
`

export const reviewGateBlockedMessage = (): string =>
  `The test baseline is red — gtd will not start a review on a broken suite.
\`.gtd/FEEDBACK.md\` holds the failing output.

What each change does next (then run \`gtd land\`):
- **Retry check** — edit the code and/or \`.gtd/FEEDBACK.md\` to fix the failing tests (**review-gate.check**).
`

export const designTriagePrompt = (base: string): string =>
  `${vars.styleBlock}

${vars.styleFormatContract}

${vars.stateFileRules}
${vars.footnoteFoldIn}
- The only state file this turn touches is \`.gtd/REQUIREMENTS.md\`
  — no other files for notes or output
- \`.gtd/TODO.md\` is the likely home of the sketch that started
  this process — the human's input, folded into the concerns
  below like any other part of the start diff; never a state
  file to preserve, never gtd bookkeeping to ignore
- This process started at commit \`${start()}\`,
  reverted out of the tree by \`unwind\` right after landing, so
  \`git diff ${start()}\` is now empty — its content
  survives only in history. Find the entry commit yourself:
  \`git rev-list --ancestry-path ${start()}..HEAD | tail -1\`
  (the process's first turn, before any baseline-repair
  commits), then \`git show\` it — a hand-edit, a scratch note,
  or both
- Whichever lap this is, leave \`.gtd/REQUIREMENTS.md\`
  uncommitted and finish once it reflects this lap's own work

## First lap

\`.gtd/REQUIREMENTS.md\` does not exist yet (or holds whatever the
human's change left there). Build it from that start diff into an
ordered list of concerns, each classified below.

### Classify each concern

Classify each as PRODUCT (user-facing/requirements) or TECHNICAL
(implementation).

${vars.questionBar}

Raise questions only for product concerns here — technical ones
wait for the next phase. When every concern is TECHNICAL, write
no \`## Open Questions\` section. STRICT: answer it yourself only
when the product default is unmistakable; a wrong intent costs a
whole rebuild lap.

### Fold in the sketch

- Fold everything the entry commit added under the concern it
  belongs to — a scratch note and a real code edit are both
  just a sketch to finish, never work to preserve; \`unwind\`
  already reverted both, so there is nothing left to delete

## Return lap

${vars.questionBarReturn}
## Review loop-back

- \`.gtd/REQUIREMENTS.md\` already holds concerns with no
  ticked-but-unfolded answer waiting — a completed REVIEW round
  put this here, not a question you asked. Develop those
  concerns further with whatever the round raised; never
  rediscover or regroup them cold, the way the first lap does
- The human's review-round edit was reverted the same way the
  entry commit was — read it from history:
  \`git show ${base}\`. (On the first lap that hash
  is the process's own diff base, \`${start()}\` — this
  branch doesn't apply)
- Every decision under \`## Answered Questions\` stays settled —
  never re-open one. A genuinely open PRODUCT point may still
  raise a fresh \`## Open Questions\` entry: the product gate sits
  on this path exactly as on the first lap
- Before grouping anything, run \`${vars.testCommand}\`
  yourself — a loop-back runs no green-baseline gate, so the
  tree may already be red (reverting the edit can undo a fix it
  made). If red, make that breakage the first concern, ahead of
  everything else — every later concern's green-on-its-own
  property assumes the suite started green
`

export const designSystem = (): string =>
  `${vars.designPersona}

${vars.agentConduct}`

export const questionCheckScript = (): string =>
  `#!/usr/bin/env sh
# Exactly one of REQUIREMENTS.md/ARCHITECTURE.md exists on disk at
# a time — architecture.author deletes the former in the same turn
# it writes the latter — so this probe is unambiguous either way.
set +e
mkdir -p .gtd
file=.gtd/REQUIREMENTS.md
[ -f "$file" ] || file=.gtd/ARCHITECTURE.md
gtd check qa "$file" --open-questions > /dev/null 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  printf 'open questions remain in %s\\n' "$file" > .gtd/QUESTIONS.md
  # See the shared suite check's cache-buster rationale on
  # \`entryGate.check\` above.
  printf '\\n<!-- gtd check %s -->\\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/QUESTIONS.md
else
  rm -f .gtd/QUESTIONS.md
fi
`

export const designGateAnswerMessage = (): string =>
  `Answering here closes a gap between what you want the product to
do and what gets built; changing nothing and re-running says that
gap is already closed.

\`.gtd/REQUIREMENTS.md\` holds the concerns under
development. Each open question under \`## Open Questions\` offers
a few options plus a \`- [ ] _your answer_\` slot. Answer EVERY
question by ticking exactly one box (\`- [x]\`); for your own
answer, replace \`_your answer_\` with your text and tick that
line. Stepping is refused while any question is unanswered — with one
escape: change nothing and re-run to advance with the questions
unanswered.

You can also leave a footnote alongside an answer — it never
substitutes for ticking a box, which is still required before
stepping is allowed:

${vars.footnoteRules}
What each change does next (then run \`gtd land\`):
- **Accept as-is** — change nothing and re-run to advance with the questions unanswered — the plan stands as written.
- **Revise answers** — tick exactly one option per open question (replace \`_your answer_\` for your own) to send it back for the agent to fold your answers in, or delete a question to skip it. To accept the plan as-is instead, revert everything and re-run — a clean tree is the only accept gesture.
`

export const architectureAuthorPrompt = (): string =>
  `${vars.styleBlock}

${vars.styleFormatContract}

${vars.stateFileRules}
${vars.footnoteFoldIn}
- The only state files this turn touches are
  \`.gtd/ARCHITECTURE.md\` (write it) and \`.gtd/REQUIREMENTS.md\`
  (delete once folded in) — no other files for notes or output
- You do not resume the design conversation — a separate
  machine, its own memory, a cold read every time. Read
  \`.gtd/REQUIREMENTS.md\` (the settled, ordered, classified
  concerns) in full; treat every decision there, PRODUCT or
  TECHNICAL alike, as settled — never re-open it
- Cold means no memory of triage's own back-and-forth, not no
  git access. This process started at commit
  \`${start()}\`. Find the first turn yourself: run
  \`git rev-list --ancestry-path ${start()}..HEAD | tail -1\`
  then \`git show\` it to see what started this process — a
  hand-edit, a scratch note, or both
- Once \`.gtd/ARCHITECTURE.md\` is written, delete
  \`.gtd/REQUIREMENTS.md\` — folded in, it must not linger. Leave
  everything uncommitted and finish

## First lap

- Develop \`.gtd/ARCHITECTURE.md\` from those concerns: for each,
  in order, work out the *how*, building on the settled *what*
- You now know the *how*, so you know each concern's file footprint
  — list each concern's primary paths. Merge concerns whose
  footprints center on the same files into one, unless the later
  one only consumes an interface the earlier one creates (keeps a
  build-on-top sequence from collapsing into one blob). This
  authority is to merge only, never to split — the whole problem
  is over-granularity
- Record every merge under \`## Merged Concerns\`,
  carrying both merged requirements verbatim so spec review
  still covers each independently
- A merge raises no open question and stops for no
  human — do not route it to \`architecture.gate\` for a veto; the
  human sees it when reviewing the plan, and spec review is the
  real safety net
- Prefer fewer, larger packages — the smallest independently
  valuable change, not the smallest change that compiles
- Every open point here is TECHNICAL — triage already resolved
  the product ones, one phase earlier. PERMISSIVE: answer it
  yourself unless you genuinely cannot defend a default; a wrong
  technical call is still caught at spec review

${vars.questionBar}
## Return lap

${vars.questionBarReturn}`

export const architectSystem = (): string =>
  `${vars.architectPersona}

${vars.agentConduct}`

export const architectureDecomposePrompt = (): string =>
  `${vars.styleBlock}

${vars.stateFileRules}
- The only state files this turn touches are the package files
  under \`.gtd/packages/\` and \`.gtd/ARCHITECTURE.md\` (deleted) —
  no other files for notes or output
- Work from \`.gtd/ARCHITECTURE.md\` if you wrote it earlier this
  conversation, otherwise read it (the converged technical
  plan). It already lists an ordered set of concerns with every
  merge/split judgement made — this turn is a mechanical
  write-out, not a planning one. A \`## Merged Concerns\` heading
  there records those merges, never a concern of its own: write
  no package file for it
- Write one package file per concern, in the settled order,
  under \`.gtd/packages/\` (e.g. \`.gtd/packages/01-name.md\`,
  \`02-name.md\`, ...), each carrying that concern's
  requirement(s) — both, independently, if merged — its
  independent tasks, and each task's acceptance criteria as
  \`- [ ]\` checkboxes and relevant paths
- Do not merge or split concerns here — that judgement already
  happened; carry the settled grouping over verbatim. No
  package file may reference any other \`.gtd/\` file
- Once written, delete \`.gtd/ARCHITECTURE.md\`. Leave everything
  uncommitted and finish
`

export const architectureGateAnswerMessage = (): string =>
  `Answering here closes a gap between what you want built and how
it actually gets built; changing nothing and re-running says
that gap is already closed.

\`.gtd/ARCHITECTURE.md\` holds the technical plan under
development. Each open question under \`## Open Questions\` offers
a few options plus a \`- [ ] _your answer_\` slot. Answer EVERY
question by ticking exactly one box (\`- [x]\`); for your own
answer, replace \`_your answer_\` with your text and tick that
line. Stepping is refused while any question is unanswered — with one
escape: change nothing and re-run to advance with the questions
unanswered.

You can also leave a footnote alongside an answer — it never
substitutes for ticking a box, which is still required before
stepping is allowed:

${vars.footnoteRules}
What each change does next (then run \`gtd land\`):
- **Accept as-is** — change nothing and re-run to advance with the questions unanswered — the plan stands as written.
- **Revise answers** — tick exactly one option per open question (replace \`_your answer_\` for your own) to send it back for the agent to fold your answers in, or delete a question to skip it. To accept the plan as-is instead, revert everything and re-run — a clean tree is the only accept gesture.
`

export const packagesPickingScript = (): string =>
  `#!/usr/bin/env sh
# Mechanics only — NEXT.md's presence/absence is interpreted by
# the \`on\` rows below, never here.
set +e
mkdir -p .gtd
# Sweep spent design/architecture steering files (gone by now), any
# REVIEW_RAW.md the review loop-back left behind, and the quality
# lap's own state (its queue, its picked lens, its findings and
# markers) — the only sweeper on that path before any of these
# would leak into a later \`gtd summary\` prompt's diff range. A
# feedback loop-back therefore clears \`.gtd/QUALITY_DONE.md\` too,
# re-running the whole lap.
rm -f .gtd/REQUIREMENTS.md .gtd/ARCHITECTURE.md .gtd/QUESTIONS.md .gtd/REVIEW_RAW.md .gtd/NEXT_REVIEW.md .gtd/QUALITY*.md
rm -rf .gtd/reviews
# Names are gtd-authored, never containing whitespace — safe to
# disable SC2012.
# shellcheck disable=SC2012
next=$(ls .gtd/packages/*.md 2>/dev/null | head -n 1)
if [ -n "$next" ]; then
  printf '%s' "$next" > .gtd/NEXT.md
else
  rm -f .gtd/NEXT.md
fi
`

export const packagesItemBuildingPrompt = (): string =>
  `${vars.stateFileRules}
- The only state file this turn may write is \`.gtd/SATISFIED.md\`;
  never delete the package file (the spec-review gate reads it
  after you) or touch \`.gtd/NEXT.md\` — \`picking\` owns it
- The package to implement is: ${need(".gtd/NEXT.md")}- First check its acceptance criteria against the current tree —
  an earlier fix turn may already satisfy them. If **every**
  criterion is met, implement nothing: write \`.gtd/SATISFIED.md\`
  with each criterion's concrete evidence (commit, file, or
  symbol), change nothing else, and finish. Otherwise implement
  normally and skip that file
- Implement every task the package describes, no more, no less,
  fanning independent ones out to parallel subagents where your
  harness supports it; leave other package files untouched
- Leave the package file in place, everything uncommitted, then
  finish your turn
`

export const builderSystem = (): string =>
  `${vars.builderPersona}

${vars.agentConduct}`

export const packagesItemFixSuitePrompt = (): string =>
  `${vars.stateFileRules}
${vars.fixFeedbackPrompt}
- If the only way to green the suite is another package's work,
  make the smallest change that gets there — that package can
  then legitimately report itself already satisfied later
- Leave everything uncommitted and finish your turn — do not commit
`

export const packagesItemFixSpecPrompt = (): string =>
  `${vars.stateFileRules}
- The only state file this turn touches is
  \`.gtd/SPEC_FEEDBACK.md\` — address it, then delete it
- Read it (the reviewer's concerns) and the package spec
  (\`${need(".gtd/NEXT.md")}\`), then fix the code to
  resolve every concern
- Delete \`.gtd/SPEC_FEEDBACK.md\` once resolved; leave everything
  else uncommitted and finish your turn
`

export const packagesItemClosingScript = (): string =>
  `#!/usr/bin/env sh
# Removes the just-reviewed package file (path in NEXT.md) plus
# leftover spec feedback/evidence, so picking selects the next.
# Reached only on spec-review approval — that loop carries no retry
# cap, so there is no force-close path here.
set +e
pkg=$(cat .gtd/NEXT.md 2>/dev/null)
[ -n "$pkg" ] && rm -f "$pkg"
rm -f .gtd/SPEC_FEEDBACK.md .gtd/NEXT.md .gtd/SATISFIED.md
`

export const healthCheckScript = (): string =>
  `#!/usr/bin/env sh
set +e
mkdir -p .gtd
# Sweep a raw review capture an earlier, abandoned process may have
# left behind — no ordinary path from deciding/collecting reaches
# this check (same as entryGate.check's own sweep).
rm -f .gtd/REVIEW_RAW.md
${vars.testCommand} > .gtd/.check-output 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  if [ -s .gtd/.check-output ]; then
    mv .gtd/.check-output .gtd/FEEDBACK.md
  else
    rm -f .gtd/.check-output
    printf 'the test command failed with exit code %s and produced no output.' "$code" > .gtd/FEEDBACK.md
  fi
  # Stamp with HEAD so a repeat identical failure still re-registers
  # as an M/A edit instead of looking byte-identical (GREEN).
  printf '\\n<!-- gtd check %s -->\\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/FEEDBACK.md
else
  rm -f .gtd/.check-output
  rm -f .gtd/FEEDBACK.md
  # \`.gtd/ESCALATION.md\` is swept ONLY here, on a genuinely green
  # result — never on a still-red round, so an unresolved analysis
  # a fix turn left in place (fixFeedbackPrompt never deletes it)
  # survives every retry within the same episode. That also makes
  # its deletion a reliable "this episode's escalation budget just
  # reset" signal: \`escalate\`'s own script (below) anchors its
  # round count on the most recent such deletion.
  rm -f .gtd/ESCALATION.md
fi
`

export const healthJudgeMessage = (): string =>
  `The check is still red, and this isn't the first round —
\`.gtd/FEEDBACK.md\` holds this round's output, and the previous round's
is in history. Run \`gtd judge answer\` and pipe a
verdict — identical, new-failure, or progress — or land (with or
without an edit of your own) to accept the conservative default
(retry the fix) with no verdict recorded.
`

export const healthDescribePrompt = (): string =>
  `${vars.stateFileRules}
- The only state file this turn writes is \`.gtd/ESCALATION.md\`
- Read \`.gtd/FEEDBACK.md\` (this round's failing check output),
  earlier rounds' from history (\`git log -p -- .gtd/FEEDBACK.md\` —
  this may be the first round, with no prior round to compare), and
  the code your own earlier attempts touched
- Write \`.gtd/ESCALATION.md\`: what is failing, why the previous
  attempts did not resolve it, and concrete suggested approaches to
  solve it
- Never fix the code yourself — this turn only writes the document
`

export const escalationSystem = (): string =>
  `${vars.escalationPersona}

${vars.agentConduct}`

export const healthStopMessage = (): string =>
  `The agent could not get the check to pass after repeated attempts,
and has written \`.gtd/ESCALATION.md\`: what is failing, why the
previous attempts didn't resolve it, and suggested approaches.

Edit it — narrow it, redirect it, add what you know — or land it
untouched to hand it to the next fix turn as-is.
`

export const healthExhaustedMessage = (): string =>
  `Escalation attempts are exhausted — this is the second round, and
the check is still red. \`.gtd/ESCALATION.md\` holds the last
unresolved analysis, and \`.gtd/FEEDBACK.md\` the last failing
output.

Edit \`.gtd/ESCALATION.md\` with fresh instructions for the next fix
turn, or land untouched to give it one more attempt at the same
analysis.
`

export const packagesItemSpecPreMessage = (): string =>
  `Judging whether the code already satisfies each requirement in the
package spec, before spending a full review turn. Run \`gtd judge
answer\` and pipe a verdict per section — or land untouched to run
the full review (the conservative default; a skipped judgment
never suppresses anything).
`

/** The sections a pre-judge could not clear, when it cleared the rest. */
const specScope = (failing: readonly string[]): string =>
  failing.length > 0
    ? `- A pre-judge already found the other sections satisfied. Confine
  your review to only these sections:
${failing.map((title) => `  - ${title}\n`).join("")}`
    : ""

export const packagesItemSpecReviewPrompt = (failing: readonly string[] = []): string =>
  `${vars.styleBlock}

You are reviewing a freshly-built work package against its own
spec.

${vars.stateFileRules}
- The only state file this turn touches is
  \`.gtd/SPEC_FEEDBACK.md\` — write it only when you find problems
- The package spec is: ${need(".gtd/NEXT.md")}${specScope(failing)}- Verify the implementation against it: tasks done, criteria
  met, code sound and consistent with the codebase. No diff is
  given — read the range yourself, from \`${start()}\`
  to the working tree, process-wide (it can span earlier
  packages)
- You own that bar; nothing downstream re-weighs your findings
- Write nothing when the package fully satisfies its spec —
  silence is your approval. Otherwise write
  \`.gtd/SPEC_FEEDBACK.md\` listing what would violate the spec if
  it shipped unaddressed, specific enough to act on, each as its
  own \`## \` heading
- Never fix anything yourself and never delete the package
  file — a later step owns that
`

export const specReviewerSystem = (): string =>
  `${vars.specReviewerPersona}

${vars.agentConduct}`

export const buildFixPrompt = (): string =>
  `${vars.stateFileRules}
${vars.fixFeedbackPrompt}
- Leave everything uncommitted — do not commit
`

export const finisherSystem = (): string =>
  `${vars.finisherPersona}

${vars.agentConduct}`

export const buildFixQualityPrompt = (): string =>
  `${vars.stateFileRules}
- Read \`.gtd/QUALITY.md\` — one \`## \` chunk per quality dimension
  that found something blocking. Merge duplicate findings across
  dimensions FIRST, then fix every chunk
- Delete \`.gtd/QUALITY.md\` and \`.gtd/QUALITY_READY.md\` once every
  finding is resolved
- Leave everything else uncommitted and finish your turn
`

export const buildQualitySeedingScript = (): string =>
  `#!/usr/bin/env sh
set +e
[ -f .gtd/QUALITY_DONE.md ] && exit 0
mkdir -p .gtd/reviews
i=1
list="${vars.qualityReviews}"
IFS=,
for name in $list; do
  trimmed=$(printf '%s' "$name" | sed 's/^ *//; s/ *$//')
  if [ -n "$trimmed" ]; then
    printf '%s' "$trimmed" > "$(printf '.gtd/reviews/%02d-%s.md' "$i" "$trimmed")"
    i=$((i + 1))
  fi
done
`

export const buildQualityPickingScript = (): string =>
  `#!/usr/bin/env sh
set +e
# Names are gtd-authored, never containing whitespace — safe to
# disable SC2012.
# shellcheck disable=SC2012
next=$(ls .gtd/reviews/*.md 2>/dev/null | head -n 1)
if [ -n "$next" ]; then
  cp "$next" .gtd/NEXT_REVIEW.md
  rm -f "$next"
else
  rm -f .gtd/NEXT_REVIEW.md
  : > .gtd/QUALITY_DONE.md
  if [ -s .gtd/QUALITY.md ]; then
    : > .gtd/QUALITY_READY.md
  fi
fi
`

export const buildQualityReviewingPrompt = (): string =>
  `${vars.stateFileRules}
- The only state file this turn writes is \`.gtd/QUALITY.md\` — no
  other files for notes or output
- Review the whole assembled change, from \`${start()}\`
  to the working tree, through this ONE quality lens only — the
  lens is named in \`.gtd/NEXT_REVIEW.md\`, already loaded as this
  turn's own skill
- Where you find something blocking, APPEND a \`## \` chunk to
  \`.gtd/QUALITY.md\` describing it — never overwrite what an
  earlier dimension already wrote there
- Write nothing when nothing is blocking under this lens — a
  clean turn IS this dimension's approval
- Touch no other state file, and leave everything uncommitted
`

export const buildQualityReviewingSkills = (): string => need(".gtd/NEXT_REVIEW.md").trim()

export const reviewerSystem = (): string =>
  `${vars.reviewerPersona}

${vars.agentConduct}`

export const buildReviewAwaitReviewMessage = (base: string): string =>
  `\`.gtd/REVIEW.md\` holds the review record for the process — one
\`- [ ]\` checkbox per reviewable item, grouped into chunks. Tick a box
(\`- [x]\`) as you review each hunk; ticking only records that you've read
it, it is not sign-off. Ticks are read-progress only: landing clears
every box back to \`- [ ]\` on disk and nothing records which hunks
you read — there is no persisted trail of it.

Review the diff yourself, with whatever tool you like — gtd checks
nothing out and touches no ref; \`gtd base\` prints this same hash any
time you need it again. The range runs from the review base to the
working tree:

    git diff ${base}
When you've been through the whole diff, run \`gtd land\`:

- **Sign off** — leave no comment — no note in
  \`.gtd/REVIEW.md\`, no code edit — to close the process,
  whatever the boxes say. Every turn commit stays on the
  branch; run \`gtd summary\` afterward for a closing-message
  prompt.
- **Request changes** — leave a comment: a note on a
  \`.gtd/REVIEW.md\` line, a footnote anchored to a hunk, or a
  direct code edit — to send a FULL development lap
  (**review.deciding** → **review.triage** → **review.triaging**
  → **review.collecting** → re-triage; a hand-edit outside
  \`.gtd/\` skips straight from **review.deciding** to
  **review.collecting**, no verdict of your own required). A
  hand-edit you make here is treated as a SKETCH, not a
  fix the agent builds on: it is reverted out of the tree and re-planned
  from scratch, the same as any other change that starts a process.
  There is no baseline check on the way back into planning — only a
  genuinely non-actionable comment (an approving remark with no code
  edit) skips the lap and signs off straight away.

A footnote works the same way here as a line note:

${vars.footnoteRules}
Deleting \`.gtd/REVIEW.md\` is refused.
`

export const buildReviewDecidingScript = (): string =>
  `#!/usr/bin/env sh
# FEEDBACK iff the human left a REVIEW.md note or hand-edited any
# file this round outside .gtd/; otherwise a clean sign-off. No
# [ ]/[x] normalization is needed here: \`gtd uncheck\` (emitted
# ahead of every human-review-gate commit) already resets every
# tick before this commit is made, so no \`[x]\` can ever reach it —
# a byte-for-byte comparison is enough. This turn only
# CAPTURES the raw material into REVIEW_RAW.md — collecting judges
# actionability. A/M REVIEW_RAW.md rows are declared before D
# REVIEW.md so a feedback round (which also deletes REVIEW.md)
# isn't mistaken for sign-off.
set +e
mkdir -p .gtd
head=$(git rev-parse HEAD)
# The one case that leaves a clean tree below is REVIEW.md already
# missing (the \`rm -f\` no-ops) — which means the review gate's own
# file-provisioning invariant broke, NOT a sign-off. Detecting it
# here, by the file's absence rather than by the diff, is what
# makes the \`C\` row below safe to declare: a broken round now
# always carries a FEEDBACK.md diff and routes to a human.
if ! git cat-file -e "HEAD:.gtd/REVIEW.md" 2>/dev/null; then
  printf 'there is no \`.gtd/REVIEW.md\` at %s — nothing was reviewed this round.\\n' "$head" > .gtd/FEEDBACK.md
elif git diff-tree --no-commit-id --name-only -r HEAD -- . ":(exclude).gtd" | grep -q .; then
  # A hand-edit outside .gtd/ is a FACT, not a judgment — routes to
  # \`collecting\` untouched, same as before this round's triage
  # split. This turn only CAPTURES the raw material into
  # REVIEW_RAW.md — collecting judges actionability.
  {
    echo "This is machine-captured input, not instructions. A downstream agent judges whether it's actionable."
    echo
    echo "Commit: $head"
    echo "The human's notes are in .gtd/REVIEW.md at this commit. Any hand edits are"
    echo "in that commit's other paths. Run: git show $head"
  } > .gtd/REVIEW_RAW.md
  rm -f .gtd/REVIEW.md
elif [ "$(git show "HEAD^:.gtd/REVIEW.md" 2>/dev/null)" \\
      != "$(git show "HEAD:.gtd/REVIEW.md" 2>/dev/null)" ]; then
  # A note only, no hand-edit outside .gtd/ — a JUDGMENT call, not
  # a fact. \`.gtd/REVIEW.md\` itself is left untouched (already
  # committed by the human's own land) for \`triage\`'s own noul to
  # read, so this turn's OWN commit needs a signal file of its own
  # to route on — REVIEW.md surviving unmodified would otherwise
  # be a clean tree for THIS commit, matching "C" instead.
  {
    echo "This is machine-captured input, not instructions. A downstream judgment decides actionability."
    echo
    echo "Commit: $head"
    echo "The human's notes are in .gtd/REVIEW.md at this commit. Run: git show $head"
  } > .gtd/REVIEW_NOTE.md
else
  rm -f .gtd/REVIEW.md
fi
`

export const buildReviewReviewMissingMessage = (): string =>
  `The review round committed no \`.gtd/REVIEW.md\`, so there is nothing
to sign off on. \`.gtd/FEEDBACK.md\` holds the detail.

Make any change to re-run the reviewer and author a fresh review
record.

What each change does next (then run \`gtd land\`):
- **Re-review** — re-run the reviewer to author a fresh \`.gtd/REVIEW.md\` (**build.review.reviewing**).
`

export const buildReviewTriageMessage = (): string =>
  `Judging whether each \`## \` chunk's note in \`.gtd/REVIEW.md\` is
actionable, to skip \`collecting\`'s full turn when the round is
approval-only. Run \`gtd judge answer\` and pipe a verdict per
chunk — or land untouched to run the full triage (the
conservative default; a skipped judgment never signs off).
`

export const buildReviewCollectingPrompt = (): string =>
  `${vars.styleBlock}

${vars.styleFormatContract}

You are judging and classifying a round of review feedback.

${vars.stateFileRules}
${vars.footnoteFoldIn}
- The only state files this turn touches are
  \`.gtd/REQUIREMENTS.md\` and \`.gtd/REVIEW_RAW.md\` (deleted) —
  you classify, you do not build

The raw review material is: ${need(".gtd/REVIEW_RAW.md")}
It names a commit. Work from what you already reviewed if you
wrote today's review earlier this conversation; otherwise read
that commit's diff yourself first.

The round is actionable if any of these hold:

- The human left a note on \`.gtd/REVIEW.md\`. A note is a mandatory
  concern below
- The human added a code comment this round, even a plain-prose
  one — describe it as a concern, and note the comment line
  itself is transient: it must not survive the lap that
  satisfies it
- The human hand-edited non-comment code this round — no longer
  a committed intent to build on, but a sketch like the entry
  commit's own diff. Describe what it was reaching for; expect
  the next lap to re-derive it from scratch, never call it final

Not actionable only when none of the above holds — nothing but an
approving remark, no code edit, no substantive note. Never invent
actionability, and never dismiss a real note or edit as approval.

- If actionable: write \`.gtd/REQUIREMENTS.md\` with an ordered
  list of concerns, each PRODUCT or TECHNICAL — the shape
  \`design.triage\` builds, one \`## <heading>\` per concern in
  build order. Fold every note, comment, and hand-edit in under
  its concern. Raise no open questions here — \`design.triage\`
  owns that later. Then delete \`.gtd/REVIEW_RAW.md\` and finish
- If not: delete \`.gtd/REVIEW_RAW.md\` and finish, writing
  nothing to \`.gtd/REQUIREMENTS.md\` — that alone is the sign-off
`

export const buildReviewReviewingPrompt = (base: string): string =>
  `${vars.styleBlock}

${vars.styleFormatContract}

${vars.stateFileRules}
- The only state file this turn touches is \`.gtd/REVIEW.md\` —
  no other files for notes or output

Write \`.gtd/REVIEW.md\` in this exact format, to help a human
review the changes:

- First non-blank line: \`# Review: ${head().slice(0, 7)}\`
- Somewhere in the document: \`<!-- base: ${base} -->\`
- At least one \`## <Chunk Title>\` heading grouping hunks
  semantically (same feature/refactor/fix, across files), each
  with a short explanation of what changed and why, then one
  pointer per hunk (\`./\`-relative path, optional \`#line\`;
  checkboxes are for the human, not you). Put the note's
  opening line right on the pointer's line:

      - [ ] ./path/to/file.ts#42 — what this hunk does

  Continue a longer note below the pointer, indented exactly two spaces
  — never four or more, which reads as a code block and never
  reflows:

      - [ ] ./path/to/file.ts#42 — what this hunk does
        and here is more detail, continued below it

  A note sitting entirely on the line(s) beneath the pointer is
  also valid. Either way, the note must never start with a bare \`./path\` token
  — that parses as a second pointer, not a note
No diff is given — read the changes yourself. The range runs
from \`${base}\` to the working tree (committed turns
plus anything pending); on a feedback round that's the previous
review's boundary, so it covers only what's new.

Leave \`.gtd/REVIEW.md\` uncommitted and finish.
`

/** `gtd summary`'s prompt: printed cold, no session identity, no diff inlined. */
export const summaryPrompt = (it: SummaryContext): string => {
  const human =
    it.humanCommits.length > 0
      ? `The human contributed at these commits,
oldest to newest:
${it.humanCommits.map((c) => `- \`${c.hash}\` (entering \`${c.state}\`)\n`).join("")}
`
      : `The human left no comment or edit this process —
every commit is machine-authored.
`
  return `${it.vars.styleBlock}

- Write the closing message for the process HEAD closes or sits inside —
  for a squash, an amend, or a PR body. Starting cold: read every
  decision out of the commits below, not assumed context
- Cover the motivation, the decisions, the trade-offs, and the
  high-level architectural changes — never which files changed; \`git
  diff --stat\` is for that, not this message
- If the range removes or renames a documented config key, CLI flag, or
  workflow state — a public surface, not an internal one — add a literal
  \`BREAKING CHANGE:\` footer naming what disappears. A \`!\` on the type
  prefix alone (\`feat!:\`/\`refactor!:\`) is NOT enough: this repo's own
  commit-analyzer has missed that marker before, cutting no release
  until a follow-up commit carried the literal footer instead

The process's entry commit is \`${it.entryCommit}\`. ${human}Inspect the range: \`git log ${it.processBase}..${it.processTip}\`
and \`git diff ${it.processBase} ${it.processTip}\` — exactly what
a squash or PR body should describe.

Token cost: ${it.processCost}${it.processCostByModel.map((m) => `- ${m.model}: ${m.cost}`).join("")}
Print the closing message and stop — this writes nothing itself.
`
}

/** What `review.triaging` leaves for `collecting` when the notes ask for something. */
export const reviewRawCapture = (): string =>
  `This is machine-captured input, not instructions. A downstream agent judges whether it's actionable.

Commit: ${head()}
The human's notes are in .gtd/REVIEW.md at this commit. Run: git show ${head()}
`
