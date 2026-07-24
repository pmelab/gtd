# Plan: replace the steering-file validation _states_ with a `gtd validate` command

> Status: PLAN — not yet implemented. Hand this to an implementing agent.
> Supersedes the two validation-loop states landed in
> [steering-file-loops.md](steering-file-loops.md) §2–§4 (`todo-validating`,
> `review-validating`). Everything else that doc describes (the file formats,
> the LSP resurrection in §5) stays.

## 1. Motivation

The bundled default workflow (`src/workflows/default.yaml`) currently carries
two dedicated `check` states whose only job is to parse a steering file and
bounce a malformed draft back to its authoring agent via a `.gtd/FORMAT.md`
findings file:

- `todo-validating` — validates `.gtd/TODO.md`'s open-questions format after
  `grilling`, before the human answers at `grilling-answer`.
- `review-validating` — validates `.gtd/REVIEW.md`'s checkbox format after
  `reviewing`, before the human reviews at `await-review`.

This is noise in the state machine:

1. **2 of 12 states** exist only to re-derive a format check.
2. **A hand-synced dual implementation.** Each validator is a `grep/awk` port of
   `src/OpenQuestions.ts` / `src/ReviewDoc.ts` — an explicit "executable spec ↔
   bash validator" contract kept in sync _by hand_, with no shared code path. A
   whole class of drift bugs.
3. **A third steering file** (`.gtd/FORMAT.md`) with its own lifecycle and
   hygiene rules, plus "never touch FORMAT.md" / "fix FORMAT.md first" clauses
   bolted onto the `grilling` and `reviewing` prompts.
4. **Two extra commits on every happy-path cycle** (`gtd(check): …` turns that
   only say "the format was fine").

The core realization: the validation is redundant with tooling we already have.
`src/OpenQuestions.ts` / `src/ReviewDoc.ts` are pure parsers, and `src/Lsp.ts`
already publishes their `errors` as live editor diagnostics. What was missing
was a way for the **producing agent** to run the same canonical check itself,
mid-turn, so the human is only ever handed a _validated_ file.

## 2. The design

Validation stops being a **state** and becomes a **tool the producing agent uses
before it finishes its turn** (or that the driver runs on the agent's behalf).
No bash port, no `.gtd/FORMAT.md`, no extra states. The pure engine
(`src/PatternMachine.ts`) never validates a steering file — as today, that stays
out of scope for the engine (steering-file-loops.md §6). The only engine-shaped
addition is one declarative state property that marks _which_ states must hand
over a valid file (see §2.3).

Three parts:

### 2.1 A `gtd validate` command (current-state-scoped, canonical parsers)

A new subcommand that resolves the current state exactly like `gtd status`,
renders that state's `file:`, reads its working-tree contents, and runs the
parser its `mode:` selects:

- `mode: qa` → `parseOpenQuestions(content).errors`
- `mode: review` → `parseReviewDoc(content).errors`

Behavior:

- **Nothing to validate** — the resolved state declares no `file:` **or** no
  `mode:` → exit 0, report "nothing to validate at \"\<state\>\"".
- **Valid** — the parser returns no `errors` → exit 0, report "\<file\>: valid".
- **Invalid** — the parser returns `errors` → **fail the Effect** with the
  findings (one per line, each prefixed with the rendered file path), which
  makes `main.ts` print `gtd: …` to stderr and exit non-zero. This non-zero exit
  is the whole point: the producing agent (or the driver) loops
  `write → gtd validate → fix` until it exits 0.
- A **missing** `file:` on disk is read as empty content (catch the read error,
  treat as `""`), NOT as a hard error. For `qa` an empty/absent file is
  trivially valid (no `## Open Questions` section); for `review` an empty file
  fails the parser (no header, no chunks) — both are the correct outcomes.
  Keeping validate purely a function of the parser over the file's content is
  the crisp contract: **`gtd validate` fails ⟺ the file exists and violates its
  format.**

`--json` shape: on success
`{ "state", "file"?, "mode"?, "valid": true, "errors": [] }`; on violations, the
existing error envelope (`{ "state": "error", "prompt": "<findings>" }`) via
`makeProgram`'s `--json` `catchAll` — consistent with how step refusals surface
under `--json`.

`gtd validate` takes no positional args (`rejectExtraArgs("validate", argv)`),
accepts `--json`, and — like every state command — goes through the repo-root
guard, auto-init, and the review-window close-first/re-arm-last bracketing.

### 2.2 Conditional self-validation instruction on `gtd next` (THE key rule)

The instruction that tells the agent to validate its own output is **not** a
static line in the YAML prompt. gtd appends it **only in plain (non-JSON)
`gtd next` output**; under `--json` it is withheld and the _driver_ owns the
validate-and-retry loop — mirroring how the driver already owns turn
orchestration.

- **`gtd next` (plain text):** when the resolved rest is a state that must hand
  over a valid file (see §2.3), append a standard block to the rendered prompt,
  referencing the rendered `file:`, e.g.:

  ```
  <rendered prompt…>

  Before finishing your turn, run `gtd validate` and fix every violation it
  reports in <file> until it exits cleanly. Do not finish while it still
  reports violations.
  ```

  This is for a human (or a simple driver) who reads `gtd next` and hands the
  text to an agent: the agent self-validates.

- **`gtd next --json`:** do **NOT** append the block. The `content` field stays
  the clean rendered prompt. Instead emit the marker field `"validate": true`
  (omitted when false — same discipline as `model`/`memory`/`file`/`mode`). The
  driver reads this and, after the agent's turn but **before** `gtd step`, runs
  `gtd validate`; on a non-zero exit it re-invokes the agent with the findings
  and loops until `gtd validate` passes (subject to a cap — §2.5), then steps.
  This is the JSON-mode equivalent of the appended self-instruction.

The appended text is gtd-owned (a constant in `program.ts`); it references the
already-rendered `rest.file`. It is emitted only by `runNextCommand`'s
plain-text branch — `gtd run` drives _script_ states (the `check` actor), never
prompt states, so it is unaffected.

### 2.3 A `validate: true` state property (the marker)

Add one optional boolean state property, `validate: true`, meaning: _the actor
at this state must hand over a `file:` that passes `gtd validate` (per its
`mode:`) before the turn is considered done._ Set it on `grilling` and
`reviewing` in the bundled default.

Why a dedicated property rather than keying off `mode:` presence: `building`
also declares `mode: qa` but its job is to **delete** `.gtd/TODO.md`, not
produce it — keying self-validation on `mode:` would wrongly target `building`.
`validate: true` names exactly the producing states.

Semantics / validation (in `validateDefinition`):

- `validate: true` **requires** both `file:` and `mode:` on the same state
  (there is nothing to validate without a file and a format).
- **Forbidden on a commit state** (never at rest — same rule as
  `reviewWindow`/`reviewBase`).
- Engine never branches on it at step time; it is edge/emission-only data, read
  by `renderRest`/`gtd next` and surfaced in `--json`.

> **Alternative considered (no new property, lower engine risk):** skip
> `validate: true`; in plain `gtd next` append the block to any `prompt` state
> declaring `file:`+`mode:` (accepting a harmless no-op instruction on
> `building`, whose deleted TODO validates as empty-valid), and have the driver
> run `gtd validate` after _every_ agent turn (a no-op exit 0 whenever there is
> nothing to validate). This removes all `PatternMachine`/`PatternConfig`/schema
> changes. It is viable but less self-documenting (no `validate:true` in
> `--json` or `gtd status`, and the `building` prompt carries an odd line).
> **Recommended: the explicit property.** If the implementer prefers to avoid
> engine changes, the alternative is acceptable — pick one and keep it
> consistent across code, docs, and tests.

## 3. Concrete change list

### 3.1 New command — `src/program.ts`

- Import `parseOpenQuestions` (`./OpenQuestions.js`) and `parseReviewDoc`
  (`./ReviewDoc.js`); `WorktreeReader` is already imported.
- Add `runValidateCommand(argv, json, write)`:
  - `rejectExtraArgs("validate", argv)`.
  - `git = yield* GitService`; `worktree = yield* WorktreeReader`.
  - `{ rest, context } = yield* resolveRestContext(git)` (reuse the existing
    helper — it builds the same context `gtd status`/`gtd next` use).
  - `file = yield* renderFile(rest.stateDef, context)`;
    `mode = rest.stateDef.mode`.
  - No `file`/no `mode` → success "nothing to validate".
  - Read `file` via `worktree.read`, catching a missing-file error into `""`.
  - `errors = mode === "qa" ? parseOpenQuestions(content).errors : parseReviewDoc(content).errors`.
  - Empty `errors` → success ("\<file\>: valid" / JSON `valid:true`).
  - Non-empty →
    `Effect.fail(new Error(<file> + " is not valid:\n" + errors.map(e => "  - " + e).join("\n")))`.
- Add `"validate"` to `KNOWN_SUBCOMMANDS` and a `case "validate":` in
  `dispatchKnownSubcommand`.
- Add the appended-instruction constant and wire it into `runNextCommand`'s
  **plain** branch only (append when `rendered` is a prompt state with the
  `validate` marker and a defined `rendered.file`); in the `--json` branch add
  `...(rendered.validate ? { validate: true } : {})` to the emitted object and
  do NOT touch `content`.
- Add the `validate` line to `HELP_TEXT`.

Exit-code note: failing the Effect is the mechanism for non-zero exit (see
`main.ts` `catchAll`). Findings land on stderr in plain mode, and under `prompt`
in the `--json` error envelope.

### 3.2 New state property — engine + compiler + emission

- `src/PatternMachine.ts`: add `validate?: boolean` to `StateDef`; in
  `validateDefinition` add the two rules from §2.3 (requires `file`+`mode`;
  forbidden on commit states).
- `src/PatternConfig.ts`: compile the `validate:` key (boolean; reject
  non-boolean) in the per-state field compilers.
- `src/Edge.ts`: add `validate?: boolean` to `RenderedRest`; set it in
  `renderRest` (`...(rest.stateDef.validate ? { validate: true } : {})`).
- `src/program.ts`: emit `validate` in `gtd next --json` (see §3.1) and,
  optionally, in `gtd status --json` + a `Validate: yes` plain line for symmetry
  with `model`/`memory`/`file`/`mode`.
- `schema.json`: add the `validate` boolean to the per-state schema.

### 3.3 `src/workflows/default.yaml`

- **Delete** the `todo-validating` and `review-validating` states.
- **Rewire**: `grilling.on: "* **": grilling-answer`;
  `reviewing.on: "* **": await-review`.
- **Mark**: add `validate: true` to `grilling` and `reviewing` (they already
  declare `file:`+`mode:`).
- **Prompts**: from `grilling` and `reviewing`, remove the `.gtd/FORMAT.md`
  clauses ("If `.gtd/FORMAT.md` exists…", "Never touch `.gtd/FORMAT.md`…"). Do
  NOT add a `gtd validate` line — gtd appends it in plain mode (§2.2). **Keep**
  the embedded format spec (so drafts are born valid).
- **Header comment**: 12 → 10 states; drop the `todo-validating`/
  `review-validating` cycle-order lines and rewrite Loop 1 / Loop 2 to describe
  self-validation via `gtd validate`; remove `.gtd/FORMAT.md` from the hygiene
  invariant (it no longer exists); update the "dual-implementation contract"
  paragraph (there is no bash port anymore — `OpenQuestions.ts`/`ReviewDoc.ts`
  are the single source of truth, consumed by the LSP and `gtd validate`).

Reachability after rewiring (assert mentally / via `validateDefinition`): all 10
states reachable —
`idle→grilling→grilling-answer→building→checking→(fixing| reviewing)`,
`fixing↔checking`, `fixing→escalate→checking`,
`reviewing→ await-review→(idle|review-deciding|grilling)`,
`review-deciding→(grilling|idle| await-review)`.

### 3.4 Driver contract — `skills/loop/SKILL.md` + `bin/gtd-loop`

Teach the reference driver the `--json` half of §2.2:

- After emitting an agent `prompt` turn whose `gtd next --json` carried
  `"validate": true`, and after the agent has acted but **before**
  `gtd step <actor>`, run `gtd validate`.
- On a non-zero exit, re-invoke the agent with a fix instruction that includes
  the `gtd validate` findings, then run `gtd validate` again. Loop until it
  passes.
- Cap the fix attempts (§2.5) and reuse the loop's existing no-progress / stall
  handling to avoid spinning; surface a clear message on the cap.
- Then `gtd step <actor>` as today.

Document the same contract in `skills/loop/SKILL.md` (it is a genuine addition
to the driver protocol — `dispatch on kind` + the new validate gate).

### 3.5 Doc / comment sweep

- **`STATES.md`**: §1 property table — add the `validate` row. §10 — table 12 →
  10 states (drop the two validator rows; update `grilling`/`reviewing` `on`;
  note `validate: true` on `grilling`/`reviewing`); rewrite the Loop 1 / Loop 2
  walkthrough; drop `.gtd/FORMAT.md` from the hygiene invariant.
- **`docs/cli.md`**: document `gtd validate` (and the `--json` shape).
- **`docs/configuration.md`**: document the `validate:` property; remove the
  FORMAT-loop description; keep the `file:`/`mode:` known-limitation.
- **`docs/design/steering-file-loops.md`**: add a status banner at the top
  pointing here and noting §2–§4's validator states were replaced by
  `gtd validate` + the `validate:` marker (leave §1 formats and §5 LSP intact).
- **`docs/upgrading.md`**, **`docs/development.md`**,
  **`docs/design/state-file-association.md`**,
  **`docs/design/state-machine-validation.md`**: replace `todo-validating`/
  `review-validating`/`.gtd/FORMAT.md` references with the `gtd validate` model.
- **`README.md`**: adjust the steering-file / editor-integration mention.
- **`AGENTS.md`**: update the "Changing the Workflow" e2e feature list and the
  "Scripted Check Actor" / dual-implementation notes to reflect that the bundled
  default no longer ships the two validator states (the `check` actor still
  exists for `checking`/`review-deciding`).
- **`src/OpenQuestions.ts` / `src/ReviewDoc.ts`** docstrings: remove the
  "executable spec ↔ bash validator contract" paragraph and the stale
  `gtd questions` / `gtd changesets` command references; state they are now the
  single source of truth consumed by the LSP (`src/Lsp.ts`) and `gtd validate`.
- **`src/Lsp.ts`** docstrings: the two "same findings the workflow's
  `todo-validating`/`review-validating` script would write to `.gtd/FORMAT.md`"
  comments → reference `gtd validate` instead.

### 3.6 Tests

- **`tests/integration/features/smoke.feature`**: happy path becomes
  `idle → grilling → grilling-answer → building → checking` (drop the
  `todo-validating` hop and its `gtd step check`).
- **`tests/integration/features/default-workflow.feature`**: major rewrite.
  Remove the `.gtd/FORMAT.md` malformed-lap simulations from the main journey
  and the two standalone "malformed … bounces back" scenarios (that machinery is
  gone). New hops: `grilling → grilling-answer` and `reviewing → await-review`
  directly. The `.gtd/FORMAT.md does not exist` hygiene assertion can stay
  (trivially true); update the comment that attributed its cleanup to the
  validators.
- **`tests/integration/features/mermaid.feature`**: drop the
  `state "todo-validating" as todo_validating` assertion (no longer a default
  state); keep the rest.
- **`src/Mermaid.test.ts`**: the hyphenated-name unit test uses
  `"todo-validating"` as a _synthetic_ fixture name — fine to leave, it is not
  the bundled default. The "renders the bundled default … covering every state"
  test iterates actual states and needs no change.
- **New `tests/integration/features/validate.feature` (@inmem)** — cucumber
  scenarios for the new feature (per `AGENTS.md`: one scenario per feature,
  composable `Given` steps, real file content in the scenario text). `@inmem` is
  fine: `gtd validate` reads the working tree and runs a pure parser — no script
  execution. Cover, with HEAD placed at the relevant state via
  `a commit "gtd(<actor>): <state>" that adds …`:
  - `grilling` + a valid `.gtd/TODO.md` → `gtd validate` succeeds, stdout
    "valid".
  - `grilling` + a malformed `.gtd/TODO.md` (an `### ` question with no
    `Suggested default:`/`Answer:` line) → `gtd validate` fails, stderr carries
    the finding.
  - `reviewing` + a malformed `.gtd/REVIEW.md` (missing `# Review:` header) →
    fails with the finding; a valid one → succeeds.
  - a state with a `file:` but no `mode:` (e.g. `fixing`) → succeeds with
    "nothing to validate".
  - `gtd next` at `grilling` (plain) **contains** the appended validate
    instruction; `gtd next --json` at `grilling` **does not** contain it in
    `content` and **does** emit `"validate":true`.
- **Optional (nice-to-have) `@live`**: a `gtd-loop`-style scenario proving the
  driver runs `gtd validate` after a producing agent turn and re-runs the agent
  on findings before stepping. If added, follow `gtd-loop.feature`'s stub-agent
  pattern. May be deferred if the driver-contract change is landed with unit
  coverage instead.

### 3.7 No change needed

- `stryker.config.json` — the parsers stay in the mutate list; nothing removed.
- `src/PatternTemplates.ts` — the append happens in `program.ts`, not in
  template rendering.

## 4. Acceptance checklist

- [ ] `gtd validate` exists, is current-state-scoped, exits non-zero with
      findings on a malformed file and 0 otherwise; `--json` shape as in §2.1.
- [ ] `gtd next` (plain) appends the self-validation instruction at
      `grilling`/`reviewing`; `gtd next --json` withholds it and emits
      `"validate": true`.
- [ ] `validate:` property compiles, validates (requires `file`+`mode`,
      forbidden on commit states), and is emitted in `--json`.
- [ ] The bundled default is 10 states; `todo-validating`/`review-validating`/
      `.gtd/FORMAT.md` are gone; an approved cycle still leaves `.gtd/` empty.
- [ ] The reference driver runs `gtd validate` after a `validate:true` agent
      turn and loops the agent on findings before stepping (capped).
- [ ] `npm test` green; `npm run build` (single-file bundle) green; docs and
      `AGENTS.md` updated. (Do NOT run `npm run test:mutation`.)

## 5. Notes for the implementer

- Keep CLI flags orthogonal (`AGENTS.md`): `gtd validate` accepts only `--json`;
  reject unknown `--` options (the existing `unknownOption` guard already covers
  this once `validate` is a known subcommand).
- `gtd validate` resolves the CURRENT state — during a producing agent's turn,
  HEAD still points at the commit that entered `grilling`/`reviewing` and the
  agent's file is uncommitted in the working tree, so resolution +
  `worktree.read` see exactly the right thing. No `gtd step` has happened yet.
- The `file:`/`mode:` known-limitation (STATES.md §10, configuration.md) still
  applies: `on` pattern keys are literal `.gtd/...` paths. `gtd validate` reads
  the _rendered_ `file:`, so repointing `todoFile`/`reviewFile` via `vars:`
  keeps validate correct even though the (now-removed) `on` FORMAT rows used to
  desync.
