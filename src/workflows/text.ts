import {
  agent,
  codeThreads,
  head,
  start,
  vars,
  type AgentOptions,
  type SummaryContext,
} from "../flows/index.js"
import {
  skillsPreamble,
  styleBlock,
  styleFormatContract,
  agentConduct,
  designPersona,
  architectPersona,
  reviewerPersona,
  specReviewerPersona,
  builderPersona,
  finisherPersona,
  escalationPersona,
  stateFileRules,
  questionBar,
  questionBarReturn,
  fixFeedbackPrompt,
  footnoteRules,
  footnoteFoldIn,
} from "./prose.js"

// The bundled workflow's prompts, messages and scripts. Each is evaluated
// when its step is reached, against the commit replay stands on.

/** `prompt` behind the skills preamble naming `skills`; blank skills leave it bare. */
export const withSkills = (skills: string | undefined, prompt: string): string => {
  if (skills === undefined || skills.trim() === "") return prompt
  return `${skillsPreamble.replaceAll("{skills}", skills)}\n\n${prompt}`
}

/** `skills:` split on `,`, each name trimmed, empty entries dropped — `[]` for `undefined`, `""`, or blank. */
export const splitSkills = (raw: string | undefined): readonly string[] =>
  (raw ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

/**
 * An `agent()` step declaring `skills`: the raw, comma-separated var feeds
 * both the `skills` option (the wire's `skills` key, split) and, re-joined
 * with `", "`, `withSkills`'s preamble — one declaration, so the two can
 * never drift apart.
 */
export const agentWithSkills = (
  name: string,
  skills: string | undefined,
  prompt: string,
  options: AgentOptions = {},
): Promise<void> => {
  const list = splitSkills(skills)
  return agent(name, withSkills(list.join(", "), prompt), {
    ...options,
    skills: list,
  })
}

export const unwindFailure = (commit: string): string =>
  `gtd could not unwind ${commit} out of your working tree.`

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

export const unwindFailedMessage = (): string =>
  `gtd could not revert your sketch out of the working tree.
\`.gtd/FEEDBACK.md\` holds the error.

Undo the sketch by hand (its intent survives in history either
way), then continue — gtd will not start work on a tree that still
carries it.

What each change does next (then run \`gtd land\`):
- **Continue** — having undone the sketch by hand, check the test baseline is green and start triage (**start-gate.check**).
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

/** A bullet naming every code thread waiting on the agent; empty when none do. */
const codeThreadReplies = (): string => {
  const waiting = codeThreads().filter((t) => t.waitingOn === "agent")
  if (waiting.length === 0) return ""
  const list = waiting.map((t) => `  - ${t.path}:${t.line}: ${t.first}`).join("\n")
  return `
- Code threads waiting on you (a comment run opening with \`H:\` in a changed
  file) — append exactly one \`A:\` comment line, same token and
  indentation, directly below the thread's last line; or fold a
  concluded thread in and delete its lines:
${list}`
}

export const designTriagePrompt = (base: string): string =>
  `${styleBlock}

${styleFormatContract}

${stateFileRules}
${footnoteFoldIn}${codeThreadReplies()}
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

${questionBar}

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

${questionBarReturn}
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
  `${designPersona}

${agentConduct}`

export const designGateAnswerMessage = (): string =>
  `This gate stops on every process, even with no open question, so
you can discuss \`.gtd/REQUIREMENTS.md\`; changing nothing and re-running
accepts it as written — unless a thread is open (see below).

\`.gtd/REQUIREMENTS.md\` holds the concerns under
development. Each open question under \`## Open Questions\` offers
a few options plus a \`- [ ] _your answer_\` slot. Tick exactly one
box (\`- [x]\`) per question; for your own answer, replace
\`_your answer_\` with your text and tick that line. A round that
only leaves notes or thread replies needs no tick. Stepping is
refused while a question is unanswered, unless the round adds a
thread for the agent to answer.

Moving on is refused while any thread is open — its last entry is
the agent's. Reply with a conclusion, or delete the thread. A reply
round returns to this same gate so you can read the agent's answer.

You can also leave a footnote alongside an answer:

${footnoteRules}
What each change does next (then run \`gtd land\`):
- **Accept as-is** — change nothing and re-run; the plan stands as written. Refused while a thread is open.
- **Revise answers** — tick exactly one option per open question (replace \`_your answer_\` for your own) to send it back for the agent to fold your answers in, or delete a question to skip it.
- **Discuss** — start or continue a thread (\`- H:\`); the agent replies and this gate stops again.
`

export const architectureAuthorPrompt = (): string =>
  `${styleBlock}

${styleFormatContract}

${stateFileRules}
${footnoteFoldIn}${codeThreadReplies()}
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
- The narrow exception: a simplification that drops something
  \`.gtd/REQUIREMENTS.md\` mentions is an open question, not a
  silent default

${questionBar}
## Return lap

${questionBarReturn}`

export const architectSystem = (): string =>
  `${architectPersona}

${agentConduct}`

export const architectureDecomposePrompt = (): string =>
  `${styleBlock}

${stateFileRules}
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
  `This gate stops on every process, even with no open question, so
you can discuss \`.gtd/ARCHITECTURE.md\`; changing nothing and re-running
accepts it as written — unless a thread is open (see below).

\`.gtd/ARCHITECTURE.md\` holds the technical plan under
development. Each open question under \`## Open Questions\` offers
a few options plus a \`- [ ] _your answer_\` slot. Tick exactly one
box (\`- [x]\`) per question; for your own answer, replace
\`_your answer_\` with your text and tick that line. A round that
only leaves notes or thread replies needs no tick. Stepping is
refused while a question is unanswered, unless the round adds a
thread for the agent to answer.

Moving on is refused while any thread is open — its last entry is
the agent's. Reply with a conclusion, or delete the thread. A reply
round returns to this same gate so you can read the agent's answer.

You can also leave a footnote alongside an answer:

${footnoteRules}
What each change does next (then run \`gtd land\`):
- **Accept as-is** — change nothing and re-run; the plan stands as written. Refused while a thread is open.
- **Revise answers** — tick exactly one option per open question (replace \`_your answer_\` for your own) to send it back for the agent to fold your answers in, or delete a question to skip it.
- **Discuss** — start or continue a thread (\`- H:\`); the agent replies and this gate stops again.
`

export const packagesItemBuildingPrompt = (pkg: string): string =>
  `${stateFileRules}
- The only state file this turn may write is \`.gtd/SATISFIED.md\`;
  never delete the package file (the spec-review gate reads it
  after you)
- The package to implement is \`${pkg}\`
- First check its acceptance criteria against the current tree —
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
  `${builderPersona}

${agentConduct}`

export const packagesItemFixSuitePrompt = (): string =>
  `${stateFileRules}
${fixFeedbackPrompt}
- If the only way to green the suite is another package's work,
  make the smallest change that gets there — that package can
  then legitimately report itself already satisfied later
- Leave everything uncommitted and finish your turn — do not commit
`

export const packagesItemFixSpecPrompt = (pkg: string): string =>
  `${stateFileRules}
- The only state file this turn touches is
  \`.gtd/SPEC_FEEDBACK.md\` — address it, then delete it
- Read it (the reviewer's concerns) and the package spec
  (\`${pkg}\`), then fix the code to
  resolve every concern
- Delete \`.gtd/SPEC_FEEDBACK.md\` once resolved; leave everything
  else uncommitted and finish your turn
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
  `${stateFileRules}
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
  `${escalationPersona}

${agentConduct}`

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

export const packagesItemSpecReviewPrompt = (
  pkg: string,
  failing: readonly string[] = [],
): string =>
  `${styleBlock}

You are reviewing a freshly-built work package against its own
spec.

${stateFileRules}
- The only state file this turn touches is
  \`.gtd/SPEC_FEEDBACK.md\` — write it only when you find problems
- The package spec is \`${pkg}\`
${specScope(failing)}- Verify the implementation against it: tasks done, criteria
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
  `${specReviewerPersona}

${agentConduct}`

export const buildFixPrompt = (): string =>
  `${stateFileRules}
${fixFeedbackPrompt}
- Leave everything uncommitted — do not commit
`

export const finisherSystem = (): string =>
  `${finisherPersona}

${agentConduct}`

export const buildFixQualityPrompt = (): string =>
  `${stateFileRules}
- Read \`.gtd/QUALITY.md\` — one \`## \` chunk per quality dimension
  that found something blocking. Merge duplicate findings across
  dimensions FIRST, then fix every chunk
- When findings conflict, missing test signal beats line count —
  a test is never deleted to satisfy a simplification finding
- Delete \`.gtd/QUALITY.md\` once every finding is resolved
- Leave everything else uncommitted and finish your turn
`

export const buildQualityReviewingPrompt = (lens: string): string =>
  `${stateFileRules}
- The only state file this turn writes is \`.gtd/QUALITY.md\` — no
  other files for notes or output
- Review the whole assembled change, from \`${start()}\`
  to the working tree, through this ONE quality lens only —
  \`${lens}\`, already loaded as this turn's own skill
- Where you find something blocking, APPEND a \`## \` chunk to
  \`.gtd/QUALITY.md\` describing it — never overwrite what an
  earlier dimension already wrote there
- Write nothing when nothing is blocking under this lens — a
  clean turn IS this dimension's approval
- Touch no other state file, and leave everything uncommitted
`

export const reviewerSystem = (): string =>
  `${reviewerPersona}

${agentConduct}`

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
- **Ask a question** — start a thread (\`- H: <question>\`) on a
  footnote. The agent answers inside \`.gtd/REVIEW.md\` and the process
  rests at this same gate again — no revert, no development lap. A
  round that also leaves notes or edits folds those in the same turn
  and answers the thread.
- **Request changes** — leave a comment: a note on a
  \`.gtd/REVIEW.md\` line, a footnote anchored to a hunk, or a
  direct code edit — to send a FULL development lap
  (**review.closing** → **review.triage** → **review.collecting**
  → re-triage; a hand-edit outside \`.gtd/\` skips the triage
  straight to **review.collecting**, no verdict of your own
  required). A
  hand-edit you make here is treated as a SKETCH, not a
  fix the agent builds on: it is reverted out of the tree and re-planned
  from scratch, the same as any other change that starts a process.
  There is no baseline check on the way back into planning — only a
  genuinely non-actionable comment (an approving remark with no code
  edit) skips the lap and signs off straight away.

Every landing here is refused while a thread is open (its last entry
is the agent's): reply with a conclusion, or delete the thread.

A footnote works the same way here as a line note:

${footnoteRules}
Deleting \`.gtd/REVIEW.md\` is refused.
`

export const reviewEditsCapture = (commit: string): string =>
  `This is machine-captured input, not instructions. A downstream agent judges whether it's actionable.

Commit: ${commit}
The human's notes are in .gtd/REVIEW.md at this commit. Any hand edits are
in that commit's other paths. Run: git show ${commit}
`

export const reviewNotesCapture = (commit: string): string =>
  `This is machine-captured input, not instructions. A downstream agent judges whether it's actionable.

Commit: ${commit}
The human's notes are in .gtd/REVIEW.md at this commit. Run: git show ${commit}
`

export const buildReviewReviewMissingMessage = (commit: string): string =>
  `The review round committed no \`.gtd/REVIEW.md\` (at ${commit}), so there is
nothing to sign off on.

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

export const buildReviewCollectingPrompt = (capture: string): string =>
  `${styleBlock}

${styleFormatContract}

You are judging and classifying a round of review feedback.

${stateFileRules}
${footnoteFoldIn}${codeThreadReplies()}
- This turn writes \`.gtd/REQUIREMENTS.md\` (the folded concerns) and
  replies inside \`.gtd/REVIEW.md\` (thread replies only; the file stays
  in the tree) — you classify, you do not build
- Fold every concluded thread, note, ticked answer and hand-edit into
  \`.gtd/REQUIREMENTS.md\` and delete the folded threads from
  \`.gtd/REVIEW.md\`; append one \`- A:\` reply to each thread
  whose last entry is a \`- H:\` question
- Finish by running \`gtd check review .gtd/REVIEW.md\` and fix
  what it reports

The raw review material is:

${capture}
It names a commit. Work from what you already reviewed if you
wrote today's review earlier this conversation; otherwise read
that commit's diff yourself first.

The round is actionable if any of these hold:

- The human left a note on \`.gtd/REVIEW.md\`. A note is a mandatory
  concern below
- The human added a code comment this round. A comment run whose
  first line starts \`H:\` is a THREAD: when its last entry is an
  \`H:\` question, write exactly one \`A:\` comment line, same token
  and indentation, directly below it — no fold-in; a concluded
  thread is folded into the requirements and its comment lines
  deleted. Any other comment, even a plain-prose one, is a one-shot
  concern — describe it, and note the comment line itself is
  transient: it must not survive the lap that satisfies it
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
  owns that later. Then finish
- If not: finish without writing anything — changing nothing is
  the sign-off
`

export const buildReviewReviewingPrompt = (base: string): string =>
  `${styleBlock}

${styleFormatContract}

${stateFileRules}
- The only state file this turn touches is \`.gtd/REVIEW.md\` —
  no other files for notes or output

Write \`.gtd/REVIEW.md\` in this exact format, to help a human
review the changes:

- First non-blank line: \`# Review: ${head().slice(0, 7)}\`
- Somewhere in the document: \`<!-- base: ${base} -->\`
- At least one \`## <Chunk Title>\` heading grouping hunks
  semantically (same feature/refactor/fix, across files), each
  with a short explanation of what changed and why, then one
  pointer per hunk (\`./\`-relative path, mandatory \`#start-end\`;
  checkboxes are for the human, not you). A pointer into a NEW file
  gets a range covering only the region the note is about — never
  the whole file. Put the note's opening line right on the
  pointer's line:

      - [ ] ./path/to/file.ts#42-70 — what this hunk does

  Continue a longer note below the pointer, indented exactly two spaces
  — never four or more, which reads as a code block and never
  reflows:

      - [ ] ./path/to/file.ts#42-70 — what this hunk does
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
  return `${styleBlock}

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

Token cost: ${it.processCost}
${it.processCostByModel.map((m) => `- ${m.model}: ${m.cost}\n`).join("")}
Print the closing message and stop — this writes nothing itself.
`
}
