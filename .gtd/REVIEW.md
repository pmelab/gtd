# Review: 7d2b965

<!-- base: 27f20a4d4862799b363365901cea4a2af29ef9ed -->

Two files. Every prompt and shared var in `unified.yaml` was rewritten from
prose paragraphs into terse bullet lists — 474 lines removed, 348 added, no
behaviour code touched. `templates.test.ts` gains one pin and loosens three
assertions. The suite is green (55/55 in `templates.test.ts`).

**Three constraints were dropped outright, not compressed.** They are called out
per hunk below.

## Shared style and conduct vars rewritten as bullets

`styleBlock`, `styleFormatContract`, `agentConduct` and `stateFileRules` are the
fragments injected into nearly every prompt, so a loss here propagates
everywhere.

- [ ] ./src/workflows/unified.yaml#37 — `styleBlock` goes from six prose
      paragraphs to eleven bullets. Every rule survives; the "outranks every
      other rule" line is now bolded, which the block itself asks for.
- [ ] ./src/workflows/unified.yaml#52 — `styleFormatContract` **drops "or
      replace a checkbox list with prose"**. That was the one clause naming the
      failure this whole rewrite risks — turning a machine-read `- [ ]` list
      into sentences. The surviving text says "keep every ... checkbox row
      exactly as specified", which is weaker: it forbids editing a row, not
      deleting the list. Restore the clause.
- [ ] ./src/workflows/unified.yaml#70 — `agentConduct` **drops "you are already
      inside a git repository, at the working directory you should treat as your
      whole world for this turn"**. The new bullets keep "no injected status
      block" and "orient yourself with `git status`", but the scope bound — do
      not wander outside this cwd — is gone entirely. That is a containment
      rule, not filler.
- [ ] ./src/workflows/unified.yaml#81 — the six personas each drop to one short
      paragraph. Content is intact; note they stayed prose rather than becoming
      bullets, which is right — they are `system:` prompts, not checklists.
- [ ] ./src/workflows/unified.yaml#130 — `stateFileRules` becomes two bullets.
      The comment directly above it still calls this "the scratchpad-opener
      sentence" and refers to each state's own "sentence" — stale as of this
      change, since both are now bullet rows.

## Shared prompt fragments condensed

- [ ] ./src/workflows/unified.yaml#144 — `questionBar`: the three-part warrant
      test, the decide-it-yourself sink, and the checkbox shape all survive. The
      positional rule is restated as "always the first `##` section" / "always
      the last `##` section" instead of "before/after every other `##` section"
      — equivalent, and exactly what `src/OpenQuestions.ts` actually enforces
      (findings at lines 219 and 222).
- [ ] ./src/workflows/unified.yaml#166 — `questionBarReturn`: fold, move, never
      re-raise, omit-when-empty — all four kept.
- [ ] ./src/workflows/unified.yaml#182 — `fixFeedbackPrompt`: three bullets,
      including the delete-if-wrong escape hatch. Nothing lost.

## Per-state prompt bodies condensed

Same treatment across every prompt-bearing state. Spot-check targets:

- [ ] ./src/workflows/unified.yaml#193 — `summary`. **Risk: the style bullets
      and the task bullets are now adjacent lists at the same level**, separated
      only by blank lines. A reader cannot tell "how to write" from "what to
      write" — previously the prose/prose split made that obvious. Worth a
      heading or a lead-in line between them.
- [ ] ./src/workflows/unified.yaml#386 — `design.triage`. First lap, return lap,
      and the review loop-back all survive, including the load-bearing "run the
      test suite first, a loop-back has no green-baseline gate" rule and its
      reason.
- [ ] ./src/workflows/unified.yaml#523 — `architecture.author`. The merge-only
      authority, the interface-consumer exception, `## Merged Concerns` with
      verbatim requirements, and "a merge stops for no human" all kept.
- [ ] ./src/workflows/unified.yaml#609 — `packages.decompose`. Mechanical
      write-out framing, the `## Merged Concerns` is-not-a-package rule, and the
      no-cross-`.gtd/`-reference rule all kept.
- [ ] ./src/workflows/unified.yaml#659 — `build.review.reviewing`. The exact
      review-document format survives intact: header line, base marker, the
      two-space continuation rule with its "never four or more" reason, and the
      bare-`./path` warning.
- [ ] ./src/workflows/unified.yaml#851 — `build.review.collecting`. The three
      actionability triggers and the not-actionable definition all survive, but
      this **drops "do not change any other file"**, keeping only "you classify,
      you do not build". Weaker: the persona states the role, the deleted clause
      stated the file-scope. The other classifying states still carry an
      explicit file list.
- [ ] ./src/workflows/unified.yaml#920 — `packages.item.spec.review`. The
      process-wide range caveat and silence-is-approval both kept.
- [ ] ./src/workflows/unified.yaml#1008 — `packages.item.building`. The
      already-satisfied precheck, `.gtd/SATISFIED.md` evidence requirement, and
      the never-touch-`NEXT.md` rule all kept.
- [ ] ./src/workflows/unified.yaml#1042 — `packages.item.fix-suite`,
      ./src/workflows/unified.yaml#1061 `fix-spec`, and
      ./src/workflows/unified.yaml#1128 `build.fix`. Straight compression, no
      dropped rules.

## Test assertions loosened

- [ ] ./src/workflows/templates.test.ts#305 — **both relaxations here are
      unnecessary and give up a guard for free.** The new `styleFormatContract`
      text still contains the literal strings "renumber or rename" and "refuses
      the turn", so the original `/renumber or\s+rename/` and
      `/refuses the turn|refused/` both still pass against it — verified
      directly. Revert these two lines to the strict regexes.
- [ ] ./src/workflows/templates.test.ts#653 — this relaxation _is_ required: the
      old regex pinned the literal phrase "before every other `##` section",
      which the rewrite replaced with "the first `##` section". The new
      structural pin matches what `OpenQuestions.ts` enforces. Accept.
- [ ] ./src/workflows/templates.test.ts#602 — new test pinning the
      `build.review.reviewing` document contract: header line, base marker,
      two-space continuation, the four-or-more warning, and the bare-`./path`
      rule. This is the right guard to add given how much of that prompt was
      reflowed.
