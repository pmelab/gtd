# Design: state ↔ steering-file association (`file:` + `mode:`)

> Status: LANDED (2026-07-22). Goal: retain the v2 relationship between states
> and steering files — but as pure workflow CONFIGURATION that works for any
> state machine. Each state may declare one associated `file:` (an Eta template,
> so filenames live in `vars:` and are never repeated) and a `mode:` (`qa` |
> `review`) naming the file's FORMAT. The LSP stops hardcoding basenames: it
> reads the gtd config from the workspace (cwd/parent lookup, same cosmiconfig
> search the CLI uses), maps rendered file paths to modes, and regains the
> jump-to-relevant- file command — full v2 functionality, zero hardcoded
> workflow knowledge.

## 1. The two new state properties

| Property | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file:`  | Optional. THE steering file this state is about — the file a human/editor should look at while the machine rests here. An **Eta template** rendered with the standard `TemplateContext` (in practice `<%= it.vars.… %>`; the full context is available). Forbidden on commit states (never at rest), must render non-empty.                                                                                                                                                 |
| `mode:`  | Optional, requires `file:`. The file's FORMAT, from a closed, documented vocabulary: `qa` (the open-questions format — `## Open Questions`, `###` question, `Suggested default:`/`Answer:`) or `review` (the checkbox review format — `# Review:` header, `##` chunks, `- [ ]` pointers). Unknown values are a load error (typos must not silently disable editor support). The ENGINE never branches on it — like `model`, it is emitted data; only the LSP interprets it. |

Multiple states may (and in the default, do) share one file+mode — the mode
describes the file, the association is per state.

**Emission:** `gtd next --json` and `gtd status --json` gain optional `file`
(rendered) and `mode` fields, omitted when unset (exactly like `model`); plain
`gtd status` prints `File:`/`Mode:` lines when set. This gives drivers and
editors the jump target without speaking LSP, and gives e2e an assertion
surface.

**Engine/compiler touch points:** `StateDef` gains `file?`/`mode?`;
`validateDefinition` gains the rules above (non-empty strings, mode ∈ {qa,
review}, mode requires file, both forbidden on commit states, errors
aggregated); `PatternConfig` compiles the two keys (KNOWN_STATE_KEYS, string
checks); `Edge`/`program` render `file:` at rest exactly where `model` is
rendered (a render failure errors like a model render failure).

## 2. The bundled default gets the association

New `vars:` entries (single source for the filenames):

```yaml
vars:
  testCommand: npm test
  todoFile: .gtd/TODO.md
  reviewFile: .gtd/REVIEW.md
  feedbackFile: .gtd/FEEDBACK.md
```

Per-state mapping (12 states):

| States                                                              | `file:`                       | `mode:`                   |
| ------------------------------------------------------------------- | ----------------------------- | ------------------------- |
| `grilling`, `todo-validating`, `grilling-answer`, `building`        | `<%= it.vars.todoFile %>`     | `qa`                      |
| `reviewing`, `review-validating`, `await-review`, `review-deciding` | `<%= it.vars.reviewFile %>`   | `review`                  |
| `fixing`, `escalate`                                                | `<%= it.vars.feedbackFile %>` | — (plain text, no format) |
| `idle`, `checking`                                                  | —                             | —                         |

Prompts and scripts that already name these files switch to the vars
(`<%~ it.vars.todoFile %>` etc.) so each filename has ONE source of truth in
templates. **Known limitation, documented:** `on` pattern keys are NOT Eta
templates — the default's patterns keep literal `.gtd/…` paths, so repointing a
filename var (`.gtdrc`/`GTD_VAR_`) without also overriding the workflow's
patterns desyncs the machine. The vars are a DRY mechanism inside templates and
the state↔file association, not a rename switch. (Making pattern keys var-aware
at compile time is noted as possible future work.)

The advanced example (`docs/examples/advanced-workflow.md`) gains the same
`file:`/`mode:` annotations (it is the LSP-heavy flow), including
`architectureFile` for its architecting phases (also `qa`-format).

## 3. The LSP becomes config-driven

- **Config discovery:** the server locates the gtd config by the SAME
  cosmiconfig search the CLI uses, from the workspace root (initialize
  `workspaceFolders`/`rootUri`), falling back to the open document's directory
  walking upward. Reuse `ConfigService`'s loading/compiling — no second config
  code path. Config is (re)loaded lazily per request (it is small); no watcher
  needed for v1.
- **Path→mode dispatch:** compile the definition, render every state's `file:`
  (vars-layer context; the LSP process's env supplies `GTD_VAR_` overrides like
  any invocation), and build a map of absolute rendered paths → mode. Document
  features dispatch on that map: `qa` files get question symbols + parser-error
  diagnostics; `review` files get chunk/hunk symbols + check/uncheck code
  actions + diagnostics. Conflicting modes for one path: first declaring state
  wins, log a warning. **Fallback:** when NO config resolves (or a `.gtd` file
  isn't mapped), keep today's basename dispatch (`TODO.md` → qa, `REVIEW.md` →
  review) so the server still works standalone.
- **The jump command returns:** `gtd.openSteeringFile` — resolve the CURRENT
  state exactly like the CLI (config + git HEAD via the existing Edge helpers;
  this re-adds the git/config wiring the v2 server had), render its `file:`, and
  `ShowDocumentRequest` it; a state with no `file:` yields an informational
  message naming the state (v2 behavior). Registered as an executeCommand;
  documented for editor keybinding.

## 4. Change chart

| Area                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/PatternMachine.ts`          | `StateDef.file?/mode?` + validation rules (closed mode set).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/PatternConfig.ts`           | Compile `file`/`mode` keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/Edge.ts` / `src/program.ts` | Render `file:` at rest; `file`/`mode` in both `--json` payloads + plain `status` lines.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/Lsp.ts`                     | Config discovery, path→mode dispatch (with basename fallback), `gtd.openSteeringFile`.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/workflows/default.yaml`     | §2's vars + per-state `file:`/`mode:`; templates switch to filename vars.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Docs                             | STATES.md property table + §10; configuration.md (`file:`/`mode:` section + mode vocabulary + the pattern-literal limitation); cli.md JSON contracts; examples/advanced-workflow.md annotations; upgrading note (jump command is back, config-driven).                                                                                                                                                                                                                                     |
| Tests                            | Unit: validation (mode vocabulary, mode-requires-file, commit-state prohibition, aggregation), compile, `file:` render + failure path; LSP path→mode dispatch, fallback, openSteeringFile (pure helpers). E2e: `driver-json-status.feature` file/mode emission (present + omitted); `lsp.feature` @live — documentSymbol served for a CUSTOM-named qa file mapped via a real `.gtdrc` (proving config-driven dispatch), and the jump command returning the rendered path at a known state. |
| Live verification                | Scratch repo with a custom workflow whose `file:` uses a var: `gtd status` shows the rendered `File:`/`Mode:`; LSP smoke against the custom filename; default workflow spot-check (`grilling` → `File: .gtd/TODO.md`, `Mode: qa`).                                                                                                                                                                                                                                                         |

## 5. Out of scope

- Eta-rendering of `on` pattern keys (the rename-switch story) — future work,
  noted in §2.
- New LSP modes beyond `qa`/`review` — the vocabulary can grow with new formats;
  adding one means: parser (spec), validator recipe, LSP dispatch arm, docs.
