# Plan: the pattern machine (gtd v3)

> Interview outcome (all decided with the user, 2026-07-22):
>
> 1. **Ground-up v3.** The current definition model (gates, guard functions,
>    actor kinds, interrupt/fallback ladders, counters-as-trailers, conflicts)
>    is DELETED. The engine shrinks to: states, change-pattern transitions, and
>    one content property per state. The shipped default workflow is re-authored
>    in the new vocabulary as a bundled config; the e2e suite is rewritten
>    around it; behavior changes where the old shape doesn't map.
> 2. **Commit format:** `gtd(<actor>): <state>` — every workflow commit records
>    the state being ENTERED and who authored the step. History is an attributed
>    state trace; resolution = read HEAD's state name.
> 3. **Scripts: the driver executes.** gtd only ever emits the rendered script
>    (`gtd next`); the outer loop or the built-in `gtd run` convenience executes
>    it and steps. The machine stays execution-free.
> 4. **Budgets:** one engine affordance only — a per-state retry limit that
>    redirects the transition to a named state when the limit is hit. Everything
>    else (verdict encoding, force-approve, content signals) moves out of the
>    engine into which files scripts/agents write or delete. `Gtd-Counters`
>    trailers die.
> 5. **Patterns:** contains-match over the pending diff, declaration order,
>    first match wins. Statuses `A` (added), `M` (modified), `D` (deleted), `*`
>    (any change kind), plus the special `C` (clean tree). Glob paths (`*`
>    within a segment, `**` across segments).
> 6. **No-match dirty step:** refusal — exit non-zero, name the state's declared
>    patterns, commit nothing.
> 7. **Squash = the `commit:` content kind** (revised 2026-07-22, replacing the
>    earlier `final: true` flag). A state whose content property is `commit:` is
>    the final state — no separate flag, no actor. Entering it performs, in one
>    execution: (a) render the `commit:` Eta template against the PENDING
>    working tree (`it.read(path)` reads files as they sit — the message file is
>    never committed first; a failed render refuses the step and touches
>    nothing), (b) soft-reset to the process's start parent and write ONE commit
>    with the rendered message, (c) discard all remaining uncommitted changes,
>    message file included. Squashing is optional (no `commit:` state = no
>    squash) and nothing about it is hardcoded: the message filename appears
>    only in user-authored patterns/templates, and the standard shape is an
>    ordinary prompt state (`squashing`) whose agent authors the message file,
>    with `"A COMMIT_MSG.md": done` routing to the commit state.
> 8. **Template variables** for script/prompt/message/commit (all Eta; inline or
>    a path relative to the config file, auto-inlined): `startCommit`,
>    `currentCommit`, `previousCommit`, `state`, `actor`, `processDiff`
>    (startCommit..HEAD + pending), `lastDiff` (the last transition's diff),
>    `read(path)` (working-tree file read, available in every content kind), and
>    `config` passthrough. No blessed config keys: there is no `testCommand` — a
>    check's command lives inline in its `script:` (or the referenced file).

## 1. The model

A workflow is a set of named **states**. Each state declares:

| Property                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor`                                       | A plain string: who is expected to act here. No kinds — every actor just creates modifications in the tree. `gtd step <actor>` authenticates against it. Commit states have NO actor — gtd itself performs them.                                                                                                                                                                                                                                          |
| `script` \| `prompt` \| `message` \| `commit` | Exactly one — the content kind. `script` — an executable the DRIVER runs (`gtd next` emits it rendered; `gtd run` executes + steps). `prompt` — instructions for an agent. `message` — text for a human (drivers halt here). `commit` — the squash-commit message template; having it makes the state FINAL (see decision 7). Inline string or a file path relative to the config file (auto-inlined). All are Eta templates over the variable set above. |
| `on`                                          | An ordered map of change patterns → next state. Evaluated at step time against the pending diff; first match wins; the step commits everything pending as `gtd(<actor>): <next-state>` — unless the target is a commit state, in which case the step performs the squash instead (decision 7). A commit state has no `on`: the process ends there.                                                                                                        |
| `initial: true`                               | Exactly one state: where an unrecognized HEAD (any non-`gtd(actor): state` subject, or a state name outside this workflow) resolves. THE entry point; replaces entry rules, the fallback ladder, and boundary handling.                                                                                                                                                                                                                                   |
| `retry`                                       | Optional: `{ max: <n>, otherwise: <state> }` — when a transition would enter this state for the (max+1)-th time within the current process, it enters `otherwise` instead, decided at write time and encoded in the committed label. Visit counting walks only the current process's commits (start → HEAD), so it stays bounded and resets naturally at entry/squash.                                                                                    |

Pattern grammar: `<status> <glob>` where status ∈ `A|M|D|*`, or the bare token
`C` (clean tree — the empty step as an explicit, opt-in event). Contains-match:
a pattern fires if any pending change matches it. `"* *"` is the catch-all for
any dirty tree.

Resolution stays δ-pure and gets simpler:
`next = f(HEAD's state name, pending diff pattern)` with exactly one impurity
left (the retry count's process-scoped walk). Turn-taking keeps only:
out-of-turn refusal (invoker ≠ state's actor), the no-match refusal, and the
clean-step no-op when no `C` event is declared.

## 2. What dies

- Actor kinds (`interactive`/`autonomous`/`scripted`) and every carve-out keyed
  on them (dirty-boundary entry turn, inert-clean-step defaults, draft
  validation).
- Gates, `TurnGate`, capture rules, turn rules, routing rules — replaced by `on`
  maps. The two-namespace grammar collapses to one subject form.
- Guard functions and the `WorkflowConfig` guard vocabulary (fact/all/any/
  counterAtLeast/…) — replaced by change patterns.
- Interrupt/fallback ladders, conflicts (illegal combinations), entry rules —
  replaced by the initial state + explicit `on` edges.
- `Gtd-Counters` trailers, stamps, forceApprove, fixAttemptCap/ reviewThreshold
  config keys — replaced by `retry` + script-owned logic.
- The content-inspection exceptions (FEEDBACK.md emptiness, checkbox-only
  REVIEW.md diffs, doc-structure validation): verdicts are now expressed by
  which file is written or deleted (`D FEEDBACK.md` = approve, `M FEEDBACK.md` =
  findings).
- The review checkout window (v3.0 drops it; may return later as a state flag —
  noted as a follow-up, not in scope).

## 3. What the CLI becomes

- `gtd step <actor>` — authenticate, match patterns, commit
  `gtd(<actor>): <next-state>` (with retry redirection at write time). A
  transition targeting a commit state performs the squash instead of a turn
  commit. Refusals: out-of-turn, no-match, failed `commit:` render.
- `gtd next [--json]` — emit the resolved state's rendered
  script/prompt/message; JSON carries
  `{state, actor, kind: script|prompt|message, content}` as the driver dispatch
  key. Resolution never rests AT a commit state (entering one ends the process),
  so `kind: commit` never appears here.
- `gtd run` — the built-in script driver: execute the emitted script verbatim,
  then `gtd step <actor>`.
- `gtd status` — state, actor, and which pattern each pending change matches.
- `bin/gtd-loop` / the loop skill dispatch on `kind`.

## 4. The bundled default workflow (re-authored)

Sketch (final shape decided during Phase 3): `idle` (initial; message;
`"* *" → grilling`… actually entry captures the dirty tree), `grilling` ⇄
`grilling-answer`, `architecting` ⇄ `architecting-answer`, `decompose`,
`building`, `checking` (script — the test command lives INLINE in the script, no
`testCommand` config key; `A FEEDBACK.md → fixing`, retry max 3 → `escalate`,
`C → reviewing`), `fixing`, `reviewing`, `await-review`
(`D REVIEW.md → squashing`, `M REVIEW.md → grilling`), `escalate`, `squashing`
(prompt: author the commit-message file; `A COMMIT_MSG.md → done`), `done`
(`commit: <%~ it.read("COMMIT_MSG.md") %>`). Health path becomes `idle`'s own
script + `A HEALTH.md` edge. Verdict changes vs today: agentic approval = DELETE
FEEDBACK.md; review approval = DELETE REVIEW.md; the check script owns its
attempt count only if we want output-dependent budgets (the engine `retry`
covers the standard case).

## 5. Phases (each lands green, committed, pushed)

1. **Engine core.** New `src/PatternMachine.ts` (or repurposed Machine.ts):
   state defs, pattern parser/matcher, resolve (HEAD state name → state;
   unrecognized → initial), step semantics (refusals, C-event, no-match), retry
   redirection, the commit-state squash action (render-then-squash-then-drop,
   refusal on render failure). New minimal `ResolvePayload` (pending changes as
   `{status, path}[]`, hashes, clean flag). Unit + property tests (δ: next =
   f(state, diff); totality; refusal invariants).
2. **Config + templates.** The `workflow:` key becomes the ONLY definition
   source (bundled default = a YAML asset compiled the same way): states, actor
   strings, script/prompt/message/commit (inline or file-relative, auto-inlined
   at load), `on` maps, validation (exactly one initial, exactly one content
   property, every target defined, retry.otherwise defined, commit states carry
   no actor and no `on`). Eta rendering with the agreed variable set, including
   the `read(path)` helper.
3. **Default workflow re-authoring + CLI.** Write the bundled default config;
   rewire program.ts (step/next/run/status), gtd-loop, loop skill; delete the
   old model (Workflow.ts rules, WorkflowConfig guard language, Subjects
   two-namespace grammar → one subject parser over the active state set;
   Events.ts flag/trailer plumbing).
4. **E2e rewrite.** New feature files pinning the engine semantics (patterns,
   refusals, retry, final squash, initial-state entry, driver protocol) +
   default-workflow journeys. Old features deleted or rewritten.
5. **Docs.** STATES.md replaced by the v3 model reference; configuration.md
   workflow section rewritten; upgrading doc gains the v3 note (old histories:
   all previous subjects are unrecognized → initial state, by design); AGENTS.md
   updated.

Sizing: phases 1–2 are the substance (new core + compiler); phase 3 is the big
deletion; phase 4 is broad but mechanical; phase 5 small.
