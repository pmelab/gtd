# Spec feedback — 03 Writing into a live worktree

## 1. BLOCKER — a server-written note leaves the file failing its own validator (T2, last criterion)

`Footnotes.ts#footnoteAttachEdits` seeds every new definition with
`PLACEHOLDER_BODY` (`"your comment"`), and `computeFindings` reports exactly
that body as a finding (`Footnotes.ts`, "still has its seeded placeholder
body"). So the document a `writeNote` produces never validates.

Reproduced against `REVIEW_FORMAT`:

- content: the pristine review doc used by `SteeringFormats.test.ts`'s
  `PRISTINE_CONTENT.review`
- `REVIEW_FORMAT.annotate(content, { kind: "hunk", chunkIndex: 0, index: 0 })` →
  ok
- `applySteeringEdits(content, edits)` → `[^nafroa8k]: your comment`
- `REVIEW_FORMAT.validate(result)` → one finding, not zero

T2's criterion "the resulting document passes its own format's validator" is
unmet, and no test in `src/Footnotes.test.ts` asserts it — the `describe`
`footnoteAttachEdits` block covers the other six criteria and stops short of
this one.

This is the deadlock T7 exists to prevent, arriving through the front door
rather than through a reflow: the server writes, the beat's `validate:` runs
before landing, and the round is stuck on a placeholder no human ever typed.

Root cause worth naming with it: `WriteNoteRequest` carries no note text at all
(`worktreePath`, `filePath`, `expectedHeadSha`, `expectedContentHash`, `mode`,
`anchor`), and `SteeringFormat.annotate`'s signature is `(content, anchor)`. The
human's typed note — the thing requirement 5 says "writes through immediately",
and the thing `saveDraft(…, text, …)` already persists on refusal — has no path
into the file. Whatever the fix, T2's validator criterion and requirement 5's
"attached note writes through" both point at the same missing parameter.

## 2. T6 — nothing in the shipped code binds a persistent store

`drafts.ts`'s doc comment says a draft "survives a page reload since it's
`localStorage`-backed". No code in `src/web/` ever reads or writes
`window.localStorage`; the only two occurrences of the word are that comment and
the `DraftStorage` interface's own comment.

`drafts.test.ts`'s first case is titled "leaves the typed text recoverable after
a page reload (a fresh read off the same storage)" but runs against an in-memory
`fakeStorage()` — a second read of a `Map`, which proves nothing about reload
survival. T6's first criterion has no implementation and no test behind it. A
named export binding the real `window.localStorage` (and a test that the binding
exists) is what is missing.

## 3. T1 — the "universal per-registry-entry" anchor test is not universal

`SteeringFormats.test.ts`'s "every anchor `view` reports is one `annotate`
accepts" runs against a hardcoded `PRISTINE_CONTENT` map keyed by mode name,
with one hand-authored fixture per built-in. Two consequences:

- a third registry entry gets `PRISTINE_CONTENT[mode]!` === `undefined` and
  fails on a confusing `undefined` rather than on the property under test — the
  exact "someone writes a third adapter" cost T1 set out to remove
- neither format's own `sample` is exercised by the property, so the criterion
  is asserted only about fixtures the test itself authored

The test comment correctly explains why the sample can't be used as-is (it
already carries a note at one of its own anchors, so a re-attach is a by-design
`id-collision` per T2). The reconciliation should be derived from the registry
entry itself — e.g. assert against the sample and accept `id-collision` as a
pass while treating `anchor-not-found` as the failure — not from a per-mode
fixture table.

## 4. T4 — one criterion has no test

"the content hash is over the file's exact bytes, so a whitespace-only change
invalidates it" holds in code (`contentHashOf` hashes the string verbatim) but
`src/serve/Write.test.ts` never asserts it — no case feeds two contents
differing only in whitespace. The other six T4 criteria each have a named case.

## Verified clean, for the record

- T1: `src/SteeringFormat.ts` still has zero imports; both `view` and `annotate`
  are non-optional; `npm run typecheck` passes
- T3: the `na`-prefixed ids in both samples are the real `anchorId` outputs
  (`chunk:4` → `naduiqc4`, `option:7` → `na17v2bjb`)
- T5, T7, T8: every criterion has a matching case, and all 365 tests across the
  eight touched files pass
- CRLF: `annotate` + `applySteeringEdits` round-trips a CRLF document with no
  mixed line endings
