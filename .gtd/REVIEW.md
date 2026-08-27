# Review: f48954f

<!-- base: 49972bdb53bf893061c02c615c5c2898f68008a5 -->

Twenty commits, six files, one idea: `## Open Questions` must be the **first**
`##` section in a qa file and `## Answered Questions` must be the **last**. The
parser now enforces it, the bundled prompts now state it, the docs now document
it. Working tree is clean — everything below is committed.

## The positional rule in the qa parser

New `checkSectionOrder` prepends up to two findings to `parseOpenQuestions`'s
`errors`, which is exactly what `QA_FORMAT.validate` returns — so this lands on
`gtd check qa` and `gtd validate`, the gate a driver runs before `gtd land`. One
finding per rule, no matter how many sections offend.

- [x] ./src/OpenQuestions.ts#207 — the whole rule: collect every level-2 heading
      index, then compare against the first `## Open Questions` and first
      `## Answered Questions` line. Two independent checks, so a file with
      Answered above Open reports both.
- [x] ./src/OpenQuestions.ts#234 — `errors` seeded from `checkSectionOrder`
      instead of starting empty. Ordering findings therefore sort ahead of the
      existing "has no question text" finding.
- [x] ./src/OpenQuestions.ts#201 — the invariant comment. It carries the "why"
      (reader and driver always find open first, resolved last) and the
      at-most-one-finding-per-rule decision, which the code alone does not
      state.

**Risk — a `##` inside a fenced or indented code block trips the rule.**
`parseHeading` trims the line and has no fence awareness, so an example heading
in prose hard-fails validation. Reproduced against the built bundle: a qa file
whose Answered section ends with a ` ```md ` fence containing `## Some Heading`
exits 1 with "must come last". This was harmless before the change; now it
blocks `gtd land`. Nothing in the new prompt text warns an agent about it, so
the fix loop can spin.

**Risk — retroactive break with no autofix.** `QA_FORMAT` gained validation
only; no `format:` pass reorders sections. Every already-authored qa file in
this repo or downstream that puts `## Answered Questions` anywhere but last now
fails its gate and must be hand-edited.

- [x] ./src/OpenQuestions.ts#366 — `QA_FORMAT`'s doc comment still says "Its one
      finding is always positionless". There are three kinds of finding now. The
      positionless part is still true; the "one" is stale.

## Unit tests for the ordering rule

Eight cases, table-flat and readable: one violation each way, the
multiple-offenders dedupe, both-at-once, three no-finding cases (Open alone,
Answered alone, neither), and lead prose under a `#` title.

- [x] ./src/OpenQuestions.test.ts#251 — the two violation cases, asserting the
      exact finding strings via `toEqual` on the full array.
- [x] ./src/OpenQuestions.test.ts#287 — dedupe: two sections before Open still
      yields one finding.
- [x] ./src/OpenQuestions.test.ts#309 — Answered-before-Open yields both
      findings, in rule order.
- [x] ./src/OpenQuestions.test.ts#330 — the three clean cases plus the level-1
      title and lead prose case, which pins that `#` and prose are exempt.

**Gap — no test covers a `##` inside a code fence.** That is the one behaviour
where the rule misfires, and it is untested in either direction, so nobody will
notice when it changes.

## The rule in the bundled prompts

The workflow is data: both `questionBar` and `questionBarReturn` now state the
positional rule so `design.triage` and `architecture.author` write conforming
files. The return-lap wording is the load-bearing half — it tells the agent a
moved question lands at the bottom, not where `## Open Questions` used to sit.

- [x] ./src/workflows/unified.yaml#191 — decide-it-yourself sink: Answered is
      always the last section.
- [x] ./src/workflows/unified.yaml#198 — Open Questions goes "before every other
      `##` section", explicitly replacing the old vague "near the top".
- [x] ./src/workflows/unified.yaml#213 — the return lap. Spells out that the
      moved question does not inherit Open Questions' old position.
- [x] ./src/workflows/templates.test.ts#642 — pins the phrasing in all three
      spots with `\s+`-tolerant regexes, so a reflow of the YAML block scalar
      does not red the test but a deletion does.

## Docs and end-to-end coverage

- [x] ./tests/integration/features/check.feature#58 — failing scenario: Answered
      before Open, asserts both finding strings on stderr and empty stdout.
- [x] ./tests/integration/features/check.feature#83 — passing scenario: correct
      order exits 0 silently.
- [x] ./docs/configuration.md#377 — `questionBar`'s description grows the
      ordering rule; still no `src/*.ts` name, per the docs policy.
- [x] ./docs/configuration.md#496 — user-facing statement under the qa mode
      section that getting the order backwards fails `gtd check qa` /
      `gtd validate`.
