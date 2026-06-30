# Config schema validation & error surfacing (Group A)

Fix five related config bugs (#14, #16, #17, #21, #23). They all touch
`src/Config.ts` and share one feature file, so they are one task, applied
sequentially within this file.

## Files

- `src/Config.ts` (the only source file)
- `tests/integration/features/config.feature` (extend existing feature)
- `tests/integration/support/steps/config.steps.ts` (add new Given/Then steps
  only if a reusable one is missing — prefer existing ones)
- `README.md` (document the new validation rules + stderr/exit-1 semantics)

## Bugs to fix

### #14 — numeric bounds on `fixAttemptCap` / `reviewThreshold`

- Location: `src/Config.ts:70-71`.
- Currently `Schema.optional(Schema.Number)` accepts negative / zero / float.
- Replace with positive-integer constraints:
  - `fixAttemptCap` must be an **integer `>= 0`** (0 is legitimate — see #15 in
    Group D / package 04, where `cap=0` is a valid "no fix attempts" setting).
  - `reviewThreshold` must be an **integer `>= 1`**.
- Use `Schema.Int` composed with `Schema.greaterThanOrEqualTo(0)` /
  `greaterThanOrEqualTo(1)` (or equivalent `Schema.positive`/filter).

### #16 — non-object config silently ignored

- Location: `src/Config.ts:169`.
- The `isPlainObject(result.config)` guard in `loadMerged` drops a found config
  that decoded to `null` / array, with no warning.
- When `result` is non-empty but `result.config` is not a plain object, surface
  an error naming the file via `result.filepath` instead of silently skipping.

### #17 — config parse error doesn't name the offending file

- Location: `src/Config.ts:129-131` (`yamlLoader` / `jsonLoader`) and the
  `loadMerged` body around `:147`.
- Wrap each loader so a `YAMLParseError` / `SyntaxError` (JSON) is re-thrown
  with the `filepath` prefixed to the message (e.g.
  `Failed to parse <filepath>: <original message>`).
- Coordinate with #21: the same path-prefixed message must reach stderr.

### #21 — config parse errors go to stdout, not stderr

- Location: `src/Config.ts:147` — `loadMerged` uses `Effect.promise`, so a
  loader exception becomes an Effect **defect**. It escapes the typed-error
  channel and the `main.ts:95` `catchAll`, landing on stdout with a raw stack.
- Switch `loadMerged` from `Effect.promise` to `Effect.tryPromise` with a typed
  `Error` (catch → `new Error(...)`), so the failure flows through the `main.ts`
  `catchAll` to stderr with exit 1.
- This is coordinated with #17 (same path-prefixed message).

### #23 — schema validation error message is ~600 chars

- Location: `src/Config.ts:204-205`.
- An unknown / mistyped config key currently dumps the full stringified
  `Schema.Struct` type via `String(e.message ?? e)`.
- Use Effect Schema's `ArrayFormatter` or `TreeFormatter` (from
  `effect/ParseResult`) to render a short, readable message, or extract just the
  offending key + a brief reason. The final user-facing message must still start
  with `Invalid gtd config` (the existing "unknown config key is rejected"
  scenario asserts `stderr contains "Invalid gtd config"`).
- The numeric-bound failures from #14 must also produce a short, readable
  message through this same formatter path.

## Constraints / edge cases

- Do NOT break the existing config scenarios — `config.feature` already covers
  testCommand, model tiers/overrides, merge walk, lowered cap/threshold, and the
  unknown-key rejection. All must still pass.
- The `fixAttemptCap: 1` and `reviewThreshold: 1` scenarios already exist and
  must remain green under the new bounds (1 is valid for both).
- `cap=0` must remain a valid config value (Group D depends on this).
- Decode still uses `onExcessProperty: "error"` — keep that.

## Cucumber scenarios (add to `config.feature`)

Per AGENTS.md: composable generic `Given` steps, real config content shown in
scenario text, one commit per setup step. Reuse the existing
`Given a gtd config file at ".gtdrc" with:` step. Add scenarios:

- A negative `fixAttemptCap` is rejected (config shows `fixAttemptCap: -1`) →
  `Then it fails` and `stderr contains "Invalid gtd config"`.
- A float `fixAttemptCap` is rejected (`fixAttemptCap: 1.5`).
- A zero `reviewThreshold` is rejected (`reviewThreshold: 0`).
- `fixAttemptCap: 0` is accepted (config valid; gtd runs without a config error)
  — proves 0 is legal for the cap.
- A malformed YAML `.gtdrc` (e.g. `testCommand: [unclosed`) fails, and
  `stderr contains` the filename `.gtdrc` (covers #17 + #21 — error names the
  file AND lands on stderr with exit 1, not stdout).
- A `.gtdrc` whose top-level value is a YAML list / `null` fails with an error
  naming the file (#16).
- The schema-error message is concise: a scenario asserting
  `stderr does not contain` a long type-dump token (e.g. assert the message does
  not contain `Struct` or a substring unique to the full type dump),
  demonstrating #23.

If a needed `Then` step is missing (e.g. `stderr does not contain {string}`),
add it to `config.steps.ts`; keep it generic.

## Acceptance criteria

- [ ] `fixAttemptCap` rejects negative, float; accepts integer `>= 0` (incl. 0)
- [ ] `reviewThreshold` rejects `0`, negative, float; accepts integer `>= 1`
- [ ] Non-plain-object config (null / array) fails with an error naming the file
- [ ] YAML / JSON parse errors are re-thrown with the offending `filepath`
      prefixed
- [ ] Config parse errors reach **stderr** with exit 1 (not stdout); verified by
      `loadMerged` using `Effect.tryPromise` with a typed `Error`
- [ ] Schema validation error message is concise (no full Struct type dump),
      still prefixed `Invalid gtd config`
- [ ] New cucumber scenarios added to `config.feature` covering each bug above
- [ ] All pre-existing `config.feature` scenarios still pass
- [ ] README updated with the new config validation rules and stderr/exit-1
      semantics
- [ ] Full test suite is green
