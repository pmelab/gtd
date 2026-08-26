# Review: abc0408

<!-- base: aa83775d6f7bb76ddcb2608dd01c000cdd483606 -->

Two packages landed together: `--json=<path>` (a dotted-path reduction of the
existing JSON document) plus a prose default for `gtd next`/`gtd land`, then the
deletion of `--sh`/`src/Sh.ts` and the rewrite of the reference driver on top of
the new surface. **The whole suite is green** — unit (1418), e2e-inmem (309),
e2e-live (96, `driver-doc.feature` included), typecheck, lint, `lint:sh`,
`format:check`, `deadcode`. Everything below is judgment, not breakage.

## The selector engine

A new zero-import pure leaf walks the already-built fields object by dotted key
path. It never throws, treats `null` and `undefined` identically as "absent",
and short-circuits an absent parent to absent for the whole remaining path so a
driver's optional read is never fatal. Own-property lookup only, so
`constructor`/`toString`/`changes.length` are all `unknown` rather than real
document fields — a genuinely good hardening choice the architecture doc did not
ask for.

- [ ] ./src/Select.ts#14 — `toSelection` renders the leaf: array → one
      `JSON.stringify` per entry newline-joined, object → one `JSON.stringify`,
      everything else → `String(value)`. An EMPTY array falls out as `text: ""`,
      which prints one bare newline — so `gtd next --json=changes` on a clean
      tree and `gtd next --json=label` at a rest with no label are
      indistinguishable after command substitution. Harmless for both current
      callers; worth a sentence if a future field's emptiness ever has to mean
      something.
- [ ] ./src/Select.ts#38 — `resolveSegment` returns `NOT_FOUND` for EVERY
      segment against an array, not just all-digit ones. Stricter than the
      architecture doc's "a digit segment is an ordinary key name"; the effect
      is the same (unknown) and the blast radius is smaller.
- [ ] ./src/Select.test.ts#1 — covers scalars, booleans, lists, absent-vs-
      unknown, null leaves, prototype members, and the zero-import rule. No
      empty- array case (see above).

## `--json`'s third arity mode in the flag table

`FlagRow.arity` widens from `0 | 1` to `0 | 1 | "optional"` — one generic
tokenizer branch, not a bespoke `--json` check, so `Cli.test.ts`'s property test
still owns the "every unrecognized `--` token is a usage error" invariant.

- [ ] ./src/Cli.ts#643 — the `"optional"` branch. `=` with an empty right-hand
      side is a usage error whose message names only the `=` form; bare `--json`
      records presence and never consumes the following token, so `--json kind`
      leaves `kind` as a stray positional and exits 2 as designed.
- [ ] ./src/Cli.ts#766 — `decodeFlags` skips an `"optional"` row whose bag is
      empty. This is what lets `parseArgv` tell bare `--json` (document) from
      `--json=<path>` (select) at line 875; the two-place coupling is documented
      on both sides.
- [ ] ./src/Cli.ts#113 — **`conflicts` is now dead machinery**: `--sh` was the
      only row that ever declared it, and no row declares it now. The field, the
      `conflictViolation` walk at line 720, and its doc comment survive with
      zero callers. `deadcode` won't catch an unused optional interface field.
      Keep it as a deliberate extension point or delete it — but decide, rather
      than leave it.
- [ ] ./src/Cli.ts#1068 — `report` maps `SelectorUsageError` to exit 2. Verified
      live: `gtd next --json=nope` exits 2, stdout byte-empty, stderr carries
      the `{"state":"error",...}` envelope plus the plain message. That doubled
      shape matches what every other `--json` usage error already does, so it is
      consistent, not new.

## `BeatFields` optionals: `?:` becomes `| undefined`

Required so `selectPath` can tell a present-but-empty key (absent) from a key
that was never declared (unknown). `JSON.stringify` still drops
`undefined`-valued keys, so `gtd next --json`'s bytes and key order are
unchanged.

- [ ] ./src/Beat.ts#141 — every optional field gained a doc comment saying the
      key is dropped from the JSON when `undefined`. This is the mitigation for
      the real risk the architecture doc named: `label: string | undefined`
      reads as "always there, sometimes empty", which is the opposite of the
      wire truth. Nothing MECHANICAL enforces it — a future field added with
      `?:` is silently unselectable and no test fails. That is the accepted
      cost.
- [ ] ./src/Beat.ts#204 — `beatFields`' spread-conditionals become plain
      assignments. **The two behaviour-carrying gates survived**: `session`/
      `validate` are still forced to `undefined` unless the beat is
      dispatchable, and `system` is still `undefined` when it rendered to the
      empty string (an empty `--system-prompt ""` would silently delete the
      harness default). These are the one place this refactor could have changed
      behaviour and did not.

## Prose default for `gtd next` / `gtd land`

- [ ] ./src/Beat.ts#313 — `Run this script:` and
      ``The edit is already made — run `gtd land` to land it.`` are plain string
      constants prepended to the header block, not templates, so no render can
      throw here. `message`/`stalled` are byte-identical, and `prompt` is
      untouched because `renderBeatPlain`'s early return still fires above this.
- [ ] ./src/Beat.ts#53 — `renderLandPlain` names the commit subject and points
      at `gtd land --json=script | sh`, or prints the no-op note. `program.ts`
      now holds no output prose at all.
- [ ] ./src/Beat.ts#4 — `noopText`/`landProseText` moved OUT of
      `OutcomeScript.ts` into `Beat.ts`, but `Beat.ts` now imports
      `renderFormat` back FROM `OutcomeScript.ts` to build them. `noopText`'s
      own doc comment still says it is "the text a print-only script's
      `gtd_report_note` carries", and its other caller is exactly that
      (`program.ts:284` → `noteOutcome(noopText(...))`). Two one-line `printf`
      wrappers now sit in the document-render module and pull a new module edge
      along with them. Not wrong; just moved toward the wrong neighbour.

## Deleting `--sh`

`src/Sh.ts`/`Sh.test.ts`, `Beat.ts`'s four `--sh` exports, the `--sh` flag row,
`program.ts`'s `sh` parameter, and both corpus fixtures are gone.
`gtd next --sh` is now a bare unknown-option error, exit 2 — no removed-flag
message table, as decided.

- [ ] ./scripts/generate-shell-corpus.ts#27 — the beat/land `--sh` fixture
      sections deleted along with `addAssignmentOnly`. `lint:sh` confirms the
      corpus is back in sync at 37 files.
- [ ] ./tests/integration/features/command-surface.feature#127 — the 10-row
      `--sh` scope-error outline collapses to two unknown-option scenarios.
      Correct: `--sh` no longer has a scope to violate, and the property test
      covers the general rule.
- [ ] ./tests/integration/features/next-status-content-parity.feature#53 — the
      parity pin re-expressed against `--json=content` in the same package that
      broke it, exactly as the architecture doc required.
- [ ] ./tests/integration/features/json-selector.feature#46 — the scenario
      titled "byte-identical to a golden document" asserts five
      `stdout contains` substrings, not byte equality. The stated acceptance
      criterion was byte-identity; nothing in this change actually pins it.
      Either rename the scenario or pin the bytes — as written it promises more
      than it checks.

## The rewritten reference driver — two live risks

The driver and `Install.ts`'s `MINIMAL_DRIVER` are pinned equal and both pass
`driver-doc.feature`'s 21 live scenarios. Two things the tests cannot see:

- [ ] ./docs/driver.md#432 — **`gtd land --json=script | sh` swallows a
      refusal.** Verified: `gtd land --json=script` alone exits 1 on a refusal;
      piped into `sh` the pipeline exits 0, because the pipeline's status is
      `sh`'s and `sh` succeeded on empty input. The ONLY thing that stops the
      loop is the preceding `settled="$(gtd land --json=settled)"` on line 430,
      which is a simple command substitution and does abort under `set -e`
      (verified). The reference driver is therefore correct — but obligation 8
      in `./src/Install.ts#267` still says "never a bare `gtd land | sh`, which
      would hand an empty script to `sh` on a refusal instead of stopping
      first", which attributes the safety to using `--json=script` rather than
      to the ordering rule that actually provides it. A driver author who skips
      the `settled` read because they don't care about settling gets a loop that
      silently continues past every refusal.
- [ ] ./tests/integration/support/world.ts#425 — that exact hole is already in
      the harness: `runGtdLandJsonScriptPiped` is the bare pipe with no
      preceding read, and it dropped the old helper's `gtd_land_status` capture,
      so `gtd land`'s own exit code no longer reaches the assertion.
      `land.feature`'s `@live` scenario only asserts success, so nothing red
      today — but a future regression that turns a landing into a refusal passes
      this step.
- [ ] ./docs/driver.md#399 — **the `agent_turn` session fallback now re-renders
      the prompt instead of replaying it.**
      `agent_turn() { gtd next | claude ... }` is invoked twice
      (`--resume || --session-id`). The old driver captured `$gtd_content` once
      BEFORE the first attempt, so the fallback re-sent byte-identical input.
      Now, if the first attempt failed at the CLI level after the agent had
      already written files, the second attempt pipes a freshly rendered
      `gtd next` — a DIFFERENT prompt, embedding the partial diff the failed
      attempt produced. The `claude` shim in the two live fallback scenarios
      writes nothing before failing, so neither exercises this. Worth stating in
      the walkthrough at minimum.
- [ ] ./docs/driver.md#387 — a `prompt` beat now spawns 6 `gtd next` calls
      (`session.id`, `session.resume`, `model`, `system`, `validate`, `log`) on
      top of `kind`, `idle`, and the piped render. The architecture doc accepted
      this and mitigated the expensive one (piping plain `gtd next` for content
      instead of a seventh `--json=content` read). The cost is real and now
      visible in the test config below.

## Docs and test plumbing

- [ ] ./docs/cli.md#46 — the `next` help still says "in one of three encodings"
      where the three are now plain, `--json`, and `--json=<path>`. Defensible,
      but it read as plain/`--json`/`--sh` before and a reader carrying the old
      meaning will misparse it. Same text at `./src/Cli.ts#377` — the pinned
      block follows `renderHelp()`, so fix it in the table.
- [ ] ./docs/cli.md#269 — the "Accepted cost: a driver that pipes stdout into
      `jq`" note is deleted rather than reworded. The underlying fact (stdout is
      byte-empty on a failed run) survives in the paragraph above it, so nothing
      is lost.
- [ ] ./vitest.config.ts#52 — e2e-live's `stepTimeout` doubles 30s → 60s, and
      `./tests/integration/support/steps/driver-doc.steps.ts#127` doubles the
      driver's own `execFile` timeout to match. Both carry a comment naming the
      ~6x subprocess growth as the cause. This is the honest, documented price
      of one-value-per-invocation — but it also raises the ceiling on every
      OTHER live step, so a genuinely hung scenario now takes twice as long to
      fail.
- [ ] ./tests/integration/support/steps/repo-snapshot.steps.ts#112 — the
      `--sh`-field parity step deleted; its `--json` sibling below it survives
      and covers the same claim.
