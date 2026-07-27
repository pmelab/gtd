# Pluggable steering-file modes

> Status: IMPLEMENTED. The authoritative reference is
> [STATES.md §12](../../STATES.md) (the model) and
> [docs/configuration.md](../configuration.md#modes--pluggable-steering-file-modes)
> (the config surface); this doc is the design record. Builds on
> [steering-file-validation-command.md](steering-file-validation-command.md),
> which introduced `gtd validate` and the `gtd step` capture gate.

## 1. Motivation

`mode:` was a CLOSED vocabulary of two names — `qa` and `review` — each
hardwired to a parser gtd ships (`src/OpenQuestions.ts` / `src/ReviewDoc.ts`).
That is fine for the bundled default workflow, whose steering files ARE those
two formats, but it makes the rest of the machine's extensibility story stop
short: a workflow is data (states, actors, patterns, content, `vars:`) right up
to the moment it wants a state whose output is checkable in some other way — an
ADR, a JSON spec, an OpenAPI document, a translation catalogue. Such a state can
declare a `file:`, but not what "valid" means for it, so the format gate the
whole design leans on (a human gate is only ever handed a well-formed file)
simply doesn't exist for it.

Meanwhile gtd already knows how to let a workflow bring its own executable
behavior: the scripted check actor (`script:` content run verbatim through
`bash`, its outcome read back off the tree). Modes are the same shape of problem
and deserve the same answer — a shell command, not a code change in gtd.

## 2. The design

A **mode is a pair of shell commands over one file**: `format` (rewrite it in
place) and `validate` (exit 0, or exit non-zero with the findings on
stdout/stderr). Both optional; at least one required.

```yaml
workflow:
  modes:
    adr:
      format: "npx prettier --write <%= it.file %>"
      validate: "./scripts/check-adr.sh <%= it.file %>"
  states:
    drafting:
      actor: agent
      prompt: "Write the ADR."
      file: docs/adr/<%= it.vars.slug %>.md
      mode: adr
```

Five decisions:

### 2.1 Modes are workflow data, with a project layer over it

A `modes:` map sits beside `states:` and `vars:` INSIDE `workflow:`, compiling
onto `WorkflowDefinition.modes`: a mode exists to serve a state's `mode:`, and
states are workflow data, so a workflow that needs a custom mode carries its
own.

A top-level `.gtdrc` `modes:` key layers over that, per half (`mergeModes`),
exactly the way the top-level `vars:` key layers over the workflow's own
`vars:`. Without it, a project on the BUNDLED default workflow could not plug in
a formatter at all without copying every state into its `.gtdrc` — and since gtd
ships no formatter (§2.2), that is precisely the common case. The rc layer is
merged into the definition BEFORE `validateDefinition` runs
(`compileWorkflowConfig`'s `rcModes` argument), so a state may name a mode
either layer declares and the load-time name check (§2.3) stays a pure function
of one definition.

### 2.2 `qa` and `review` stay built in — as VALIDATORS, and only that

The two existing modes' parsers are also what `gtd lsp` publishes as live
diagnostics and what its document symbols and code actions are built on —
shelling out per keystroke over an unsaved buffer is a different (and much
worse) design. So gtd keeps them as its `BUILT_IN_MODES`, available in every
workflow without being declared.

Their FORMATTING half went the other way. gtd used to bundle prettier and expose
it as a `gtd format <file>` subcommand, which the built-in modes then called;
both are gone (the subcommand, and prettier as a runtime dependency — the
single-file bundle drops from ~15 MB to ~10 MB). A project brings its own
formatter and plugs it into whichever mode should use it. The two built-ins
therefore VALIDATE and nothing else, until a `modes:` entry gives them a
`format:`.

Which forces the resolution rule: the halves resolve INDEPENDENTLY, first layer
wins per half.
`modes: { qa: { format: "npx prettier --write <%= it.file %>" } }` adds
formatting to `qa` and keeps gtd's open-questions validation; declaring
`validate:` instead displaces the parser. (An earlier draft of this design had a
declared entry REPLACE a built-in wholesale — that cannot express "gtd's
validation plus my formatter", which is the common case.)

### 2.3 `mode:` stays load-time-validated, against a definition-derived set

`validateDefinition` no longer checks a hardcoded vocabulary; it checks
`knownModes(def)` — the built-ins plus the declared names — exactly the way the
commit grammar's closed actor set derives from `declaredActors`. A typo'd mode
must not silently disable both the capture gate and the editor's diagnostics, so
this stays an error at config-load time, and its message lists both sets.

### 2.4 Commands are Eta templates with `it.file`, executed at the edge

A command sees the resting state's full template context plus `it.file`, the
already-rendered steering-file path (`PatternTemplates.ModeCommandContext`) — so
a command can read `it.vars`, and a workflow whose `file:` is vars-parameterized
never has to repeat the path. Execution is `bash -c` from the repo root, output
captured (unlike `gtd run`'s scripted actor, whose output is for the human).

`./scripts/check-adr.sh` in a command is a COMMAND, never a `./`-relative file
reference the way a content string is — inlining it as template text would break
the obvious reading.

### 2.5 The pure engine still never validates anything

Everything above is an edge concern, in one new module, `src/SteeringMode.ts`
(resolution + execution) — the same shape as `src/ReviewWindow.ts`. The engine
carries `modes:` as inert data and validates its shape; `PatternMachine.step`
never sees a mode.

## 3. What changed

| Area                                    | Change                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/PatternMachine.ts`                 | `ModeDef`; `WorkflowDefinition.modes`; `StateMode` widened from `"qa" \| "review"` to `string`; `BuiltInMode`/`isBuiltInMode`/`knownModes`; `validateModes`; `validateMode` now definition-derived |
| `src/PatternConfig.ts`                  | `compileModesMap` + `mergeModes` (mirroring `compileVarsMap`), `modes` added to `KNOWN_TOP_KEYS`, `compileWorkflowConfig`'s `rcModes` argument                                                     |
| `src/Config.ts` / `src/ConfigSchema.ts` | the third blessed top-level key, `modes:` (`compileRcModes`), layered over the compiled workflow (or the bundled default) per half                                                                 |
| `src/Format.ts`, `gtd format <file>`    | DELETED, and `prettier` dropped from the runtime dependencies — formatting is a mode's own command now                                                                                             |
| `src/PatternTemplates.ts`               | `ModeCommandContext` (`TemplateContext` + `file`) and `renderModeCommand`                                                                                                                          |
| `src/SteeringMode.ts` (new)             | `resolveSteeringMode` (per half), `formatSteeringFile`, `validateSteeringFile`, `formatAndValidateSteeringFile`, `unknownModeMessage`                                                              |
| `src/program.ts`                        | `formatAndCheckSteeringFile` routes through the resolved mode (was: a hardcoded `qa`/`review` switch plus `formatFile`); `gtd validate` and the capture gate are otherwise unchanged               |
| `src/ConfigSchema.ts` / `schema.json`   | the `modes:` object; `mode:`'s `enum` dropped                                                                                                                                                      |
| `src/Lsp.ts`                            | docs only — a custom mode gets no live diagnostics/symbols/code actions (documented limitation)                                                                                                    |
| `src/workflows/default.yaml`            | unchanged — the bundled default keeps `qa`/`review`, which resolve to the built-in validators                                                                                                      |

One behavior change for existing users: steering files are no longer
auto-formatted, because gtd no longer has a formatter to do it with. Validation
is untouched. A project that wants the old behavior adds four lines to its
`.gtdrc` (the `modes: { qa: { format: … } }` snippet in
[configuration.md](../configuration.md#modes--pluggable-steering-file-modes)).

## 4. Known limitations

- **No live editor support for a custom mode.** `gtd lsp` dispatches on the
  built-in names only; a workflow-declared mode's file gets no diagnostics, no
  document symbols, no code actions. It is still formatted and validated by
  `gtd validate` and the `gtd step` gate.
- **Nothing is formatted out of the box.** The bundled default declares no
  `format:` command, so a fresh install validates but never rewrites. This was
  the deliberate alternative to shipping an `npx prettier` default, which would
  make every gate depend on prettier resolving in the user's project.
- **A command runs on the developer's machine, unsandboxed** — same trust model
  as a `script:` state: a `.gtdrc` is project code.
- **`gtd next`'s self-validation instruction** is appended for any `prompt` rest
  declaring `file:`+`mode:`, including a mode that declares only `format:`
  (where `gtd validate` can only ever pass). Harmless, and keeps the rule "a
  state that hands over a steering file tells its agent to check it".
