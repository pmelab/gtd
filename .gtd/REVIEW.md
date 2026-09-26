# Review: 65d91a2

<!-- base: 1cc43fad4f59ec10926af868f6a0076f0c9f0557 -->

Five independent threads landed in this range: one real `each:` loop bug, one
load-time guard closing an unenterable position, one shell-injection fix in the
bundled workflow, a deliberate shrink of the free-form phone screen, and a
cluster of test-flake repairs. Read the loop bug and the shell fix first — those
two change behaviour users already depend on.

## Empty sibling loop silently swallowed the outer loop's remaining items

A process running loop A then loop B dropped every A item after the first
whenever B's snapshotted list was empty. `qualifyLoopTarget` chains an empty
loop's target straight through to that loop's own `drained:`, so by the time
`applyEachDrainAdvance` ran, the resolved target was B's `drained:` — matching
neither A's nor B's `drained:` string — and A's advance never fired. The fix
threads the pre-chain target (the string `qualifyLoopTarget` was originally
asked to qualify) alongside the resolved one, and matches `ref.drained` against
either.

- [ ] ./src/PatternMachine.ts#746 — `qualifyLoopTarget` now returns a third
      field, `preChainTarget`, always this call's own `target` argument
      verbatim. Every return path sets it; the empty-list chaining branch sets
      it to the pre-chain value rather than inheriting the recursion's.
- [ ] ./src/PatternMachine.ts#577 — `applyRetry` threads `preChainTarget`
      through its own recursion, taking the terminal hop's value the same way it
      already did for `enteredEachRef`.
- [ ] ./src/PatternMachine.ts#811 — `applyEachDrainAdvance` takes
      `preChainTarget` and matches `ref.drained` against EITHER stripped target.
      Check this widening cannot fire a FALSE advance: two refs may declare the
      same `drained:`, and the `qualifierIndexAt` guard below is what keeps the
      match scoped to the ref whose subtree `currentState` actually sits in.
- [ ] ./src/PatternMachine.ts#972 — `step`'s call site destructures and passes
      the new field through both hops.
- [ ] ./src/PatternMachine.test.ts#3056 — the unit test: A has two items, B's
      list is empty, expect `A[0].build → A[1].build`.
- [ ] ./tests/integration/features/each-loop.feature#215 — the same case end to
      end through the real driver protocol.

## A process may no longer start or be entered inside a loop

Both reachability roots — `entries.default` (the root machine's recursively
resolved `entry:`) and every `entries.manual` state (`entry: true`) — are now
load errors when they land inside an `each:` reference's subtree. A loop has no
item selected until something enters it through the reference, so there is no
unqualified state to start at.

- [ ] ./src/PatternMachine.ts#1062 — the new check inside `validateEntries`,
      wording the verb per root kind ("start" vs "be entered"). BREAKING for an
      existing repo: a `.gtdrc` that today points the root machine's `entry:` at
      a looped local stops loading outright rather than degrading. Confirm that
      shape was already broken at runtime — if it merely misbehaved, this turns
      a soft bug into a hard load failure with no migration note anywhere.
- [ ] ./src/PatternMachine.test.ts#1502 — three unit tests: default inside,
      manual inside, and the accepting case with both outside.
- [ ] ./tests/integration/features/config-errors.feature#329 — the end-to-end
      scenario, plus a large batch of pre-existing config-error cases this new
      file now pins that had no feature coverage before.
- [ ] ./docs/configuration.md#172 — the user-facing paragraph, plus the two
      inline key comments for `entry:` (machine-level) and `entry: true`
      (state-level).

## A package filename carrying shell syntax no longer executes

`it.item` is untrusted — it comes from a glob over the working tree, not from
the workflow author. Two bundled `script:` states interpolated it inside DOUBLE
quotes, which stop word-splitting but not `$(...)`, a backtick, or `$var`. A
package file named with a command substitution ran that command as the reviewer.

- [ ] ./src/workflows/unified.yaml#1710 — `packages.spec.scoping`'s `pkg=`
      switched to single quotes.
- [ ] ./src/workflows/unified.yaml#1907 — the same in `packages.closing`. Single
      quotes hold because Eta autoescaping renders a literal `'` in a filename
      as `&#39;`, so the quoting can't be broken out of. That safety depends on
      autoescaping staying on for `<%= %>` — worth a moment's check, since the
      neighbouring `<%~ %>` form does NOT escape.
- [ ] ./tests/integration/features/package-filename-shell-safety.feature#15 — an
      `@live` scenario that drives the real bundled workflow far enough to
      render both scripts and asserts the embedded command never ran.
- [ ] ./docs/configuration.md#228 — documents `it.item` as untrusted and tells
      workflow authors to single-quote it themselves.
- [ ] ./tests/shell/corpus/workflow.packages.closing.sh#1 — corpus fixtures
      regenerated to match.
- [ ] ./tests/shell/corpus/workflow.packages.spec.scoping.sh#1 — same.

## Free-form screen shrunk to read, note, and a textfield when empty

Per-block Edit/Delete is gone from the phone's free-form screen. The format now
only ever APPENDS; every other anchor refuses `anchor-not-found`. This is a
deliberate capability removal, not a refactor — confirm you want the phone to
lose block editing on mode-less files.

- [ ] ./src/steering/freeform.ts#101 — `freeFormApply` collapsed to two guards
      and an append. The replace and delete branches, and their blank-line
      bookkeeping, are deleted.
- [ ] ./src/steering/freeform.ts#115 — `freeFormView` no longer passes
      `fullText`, so nodes stop carrying raw source bytes.
- [ ] ./src/steering/Blocks.ts#198 — the `fullText` option and its `rawNodeText`
      helper are removed entirely, and `blockOf` loses its wrap-and-override
      shape for a plain switch. Check nothing else ever asked for `fullText`; it
      was documented as opt-in per caller, and free-form was the only caller.
- [ ] ./src/web/screens/FreeForm.tsx#24 —
      `APPEND_LINE = Number.MAX_SAFE_INTEGER` is how the client reaches the
      append branch without knowing the file's line count.
- [ ] ./src/web/screens/FreeForm.tsx#42 — `EmptyDocumentCapture`: bare textarea
      plus Save, shown only when `view.nodes.length === 0`. Deliberately no
      `autoFocus` (iOS Safari refuses programmatic focus) and no draft
      persistence — a tab eviction mid-capture loses typed text silently,
      accepted in the comment. Worth checking: Save with empty text still fires
      a write that appends nothing.
- [ ] ./src/web/screens/ProseBlock.tsx#187 — the `actions` prop and its render
      row are removed, and `ProseBlock` itself is no longer exported (only
      `ProseBlocks` is imported anywhere).
- [ ] ./src/web/Button.tsx#25 — the `danger` variant survives but its
      FreeForm-specific comment is dropped. Nothing in `src/` renders `danger`
      for free-form any more — check whether another screen still does, or
      whether the variant is now dead.
- [ ] ./src/web/App.tsx#20 — dispatch doc updated to "read plus note, plus a
      textfield when empty".
- [ ] ./README.md#361 — the user-facing sentence matches the new behaviour.
- [ ] ./tests/integration/features/ui.feature#332 — the block-edit scenario is
      rewritten as an append scenario; the stale-token scenario now writes to
      paragraph 9999 so both writes land past the last line regardless of what
      `ui.format` did to the file length.
- [ ] ./src/steering/freeform.test.ts#1 — unit tests cut from 283 lines' worth
      of replace/delete coverage down to the append surface.
- [ ] ./src/web/screens/FreeForm.stories.tsx#137 — stories cut by ~730 lines;
      the remaining interaction stories drive the empty-document textarea.

## Blockquote text no longer leaks its own `> ` continuation marker

A soft-broken blockquote (two lines, no blank `>` row) rendered with a literal
`>` inside its title, because the raw bytes between two children cross the
continuation marker. The marker is now stripped on the RAW slice, before
whitespace collapse erases the newline that distinguishes a line-leading marker
from a `>` typed mid-prose.

- [ ] ./src/steering/Blocks.ts#22 — `rawChildText`, the uncollapsed per-child
      slice this needs.
- [ ] ./src/steering/Blocks.ts#35 — `stripContinuationMarker`'s regex,
      `/\n[ \t]*>[ \t]?/g`. Anchored to a newline, so a mid-prose `>` survives.
      The one case to think about: a fenced code block nested INSIDE a
      blockquote whose content lines legitimately start with `>` — in that
      position the line also carries the blockquote's own marker, so stripping
      is right, but it is the edge worth confirming against a real sample.
- [ ] ./src/steering/Blocks.ts#64 — `blockquoteChildrenText`, scoped to
      blockquotes only. The comment is explicit that `listItemText` must NOT
      reuse it, since a list item's own fenced child can carry a real
      line-leading `>`.
- [ ] ./src/steering/Blocks.ts#130 — `blockTitle`'s blockquote arm switched to
      the new helper.
- [ ] ./src/steering/qa.test.ts#1240 — three tests: no `>` in a soft-broken
      quote, a literal mid-prose `>` surviving, and an inline link keeping its
      `[label](url)` syntax.
- [ ] ./src/steering/Blocks.test.ts#57 — matching unit coverage.

## Test flakes under host-wide CPU contention

Three unrelated flakes, all traced to concurrent test runs across sibling
worktrees rather than to product code.

- [ ] ./tests/tooling/support/run-in-pty.py#36 — the read loop is rewritten from
      poll-plus-drain to blocking straight to real EOF, removing the "child
      exited before its last write arrived" race by construction. A 10-second
      watchdog thread kills the child so a genuine wedge fails fast instead of
      consuming the outer CI timeout, and raises `TimeoutError`. Two things to
      weigh: the watchdog kills any child legitimately slower than 10s, and
      `os.close(master)` sits outside the `try`/`finally`, so it is skipped if
      the loop raises anything the inner `except OSError` doesn't catch.
- [ ] ./src/OutcomeScript.test.ts#136 — the same test ALSO retries up to three
      times on zero captured bytes. If the pty rewrite above really removes the
      race by construction, this retry is belt-and-braces that will now hide a
      future regression of exactly that kind. Decide whether both land or just
      one.
- [ ] ./src/ui/Tls.test.ts#149 — tmpdir assertions relaxed from exact equality
      with a snapshot to "no NEW `gtd-tls-*` dir survives", since `tmpdir()` is
      shared machine-wide and other workers create their own.
- [ ] ./src/ui/Tls.test.ts#228 — the same helper duplicated in the second
      describe block rather than hoisted; intentional per its comment, but it is
      a verbatim copy.

## Release bookkeeping

- [ ] ./package.json#3 — version 12.3.0 → 12.5.0, from two semantic-release
      commits inside this range.
- [ ] ./package-lock.json#1 — the matching lockfile bump.
