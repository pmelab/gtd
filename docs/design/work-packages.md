# Design: the builder / work-packages flow as pure workflow configuration

> Status: LANDED (2026-07-22) — Option A shipped in the bundled default workflow
> (`src/workflows/default.yaml`'s `picking` state; see
> [STATES.md §10](../../STATES.md#10-the-bundled-default-workflow)). The rest of
> this document is kept as the decision record: why Option A was chosen over
> B/C/D, and the process-per-task topology (§6) remains a documented,
> unimplemented recipe.
>
> Context (as originally written): v2 had an engine-level package loop
> (`hasPackages` / `packagesRemaining` guards, the `close-package` label,
> `removePackageDir`). v3 deleted all of it; the bundled default's `building`
> state used to implement the entire task set in ONE monolithic agent turn. This
> doc plans how to get the incremental task-by-task loop back **without the
> engine ever learning what a "package" is** — it stays a concern of the
> workflow configuration.

## 1. What the loop actually needs

The per-task cycle is: _pick the next task → implement it → check → (fix loop) →
close the task → if tasks remain, loop; else review_. Decomposed into v3
vocabulary:

| Need                              | Already expressible?                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task queue                        | Yes — files under a glob (e.g. `.gtd/tasks/NN-name.md`), written by `decompose`.                                                                                                                               |
| "Close a task"                    | Yes — the actor deletes the task file; the diff carries `D .gtd/tasks/…`.                                                                                                                                      |
| Per-task check + fix loop         | Yes — the existing `checking`/`fixing` shape, unchanged.                                                                                                                                                       |
| Feed ONE task into the prompt     | Mostly — a file naming the current task can be `it.read()` into the building prompt.                                                                                                                           |
| **The exit branch: "none left?"** | **No.** Patterns match the pending **diff**; deleting the _last_ task file produces the same diff shape as any other (`D .gtd/tasks/…`). Emptiness of a glob is a **tree** property, invisible to the grammar. |

So the whole design question is: who decides "the queue is empty", and how does
that decision become a diff the patterns can see? Everything below is an answer
to only that.

## 2. Option A — scripted arbiter state (pure config, deterministic) — RECOMMENDED

Apply the `checking` discipline to the queue itself: a `script` state whose only
job is to inspect the tree (which patterns can't) and leave a file-op verdict
(which patterns can). Mechanics in the script, semantics in the `on` map — no
trust in an agent, no engine change.

```yaml
decompose:
  actor: agent
  prompt: |
    … write ordered task files under .gtd/tasks/ …
  on:
    "* .gtd/tasks/**": picking

picking: # the deterministic queue arbiter
  actor: check
  script: |
    next=$(ls .gtd/tasks/*.md 2>/dev/null | head -n 1)
    if [ -n "$next" ]; then
      printf '%s' "$next" > .gtd/NEXT.md
    else
      rm -f .gtd/NEXT.md
    fi
  on:
    "D .gtd/NEXT.md": reviewing # queue just emptied — MUST precede the `*` row
    "* .gtd/NEXT.md": building # queue non-empty (A first time, M after)
    "C": reviewing # queue empty and NEXT.md never existed

building:
  actor: agent
  prompt: |
    Implement exactly ONE task: <%~ it.read(".gtd/NEXT.md") %> — read that
    file, do the work, delete the task file when done. Touch nothing else
    under .gtd/.
  on:
    "* **": checking

checking:
  # unchanged, except green loops back to the arbiter:
  on:
    "A .gtd/FEEDBACK.md": fixing
    "M .gtd/FEEDBACK.md": fixing
    "C": picking
```

Properties:

- **Deterministic.** The branch is a shell `ls`, not an agent's memory. Every
  verdict lands in the commit history as an ordinary `gtd(check): <state>` turn.
- **`NEXT.md` is both the verdict and the context** — the building prompt
  interpolates it, so each building turn sees exactly one task.
- The three `on` rows are total over the script's possible outcomes
  (write/overwrite, delete, no-op) — no refusal path.
- Cost: one extra state and one extra driver round-trip per task (same cost
  `checking` already pays; the loop already executes scripts via `gtd run`).

## 3. Option B — agent-encoded verdict (pure config, zero extra states)

The v3 verdict discipline says branch outcomes are encoded by _which files the
actor writes or deletes_ (`D FEEDBACK.md` = approve). Apply it here: `decompose`
also writes a marker `.gtd/tasks/OPEN`; the building/closing prompt instructs:
_implement the next task and delete its file; if it was the last one, also
delete `.gtd/tasks/OPEN`_. Declaration order does the rest:

```yaml
building:
  on:
    "D .gtd/tasks/OPEN": reviewing # declared first — wins when present
    "* **": checking
```

- Pro: no extra state, no script execution needed (works for drivers that only
  handle prompt/message states).
- Con: correctness rests on the agent honouring the marker protocol. The failure
  mode is soft (a forgotten marker just means one more "none left, delete the
  marker" turn), but the branch is not deterministic and never appears as a
  machine-authored verdict.

Documented as the zero-infrastructure variant; A is preferred wherever the
driver can run scripts.

## 4. Option C — generic engine helper: tree-predicate guards on patterns

The one candidate engine change, if the arbiter round-trip ever proves too
heavy. The grammar gains an optional **tree predicate** appended to a pattern:
`<event> & N <glob>` ("and no file matching glob exists in the tree after the
pending changes") / `& E <glob>` ("and at least one exists"):

```yaml
building:
  on:
    "D .gtd/tasks/** & N .gtd/tasks/**": reviewing # closed the LAST task
    "D .gtd/tasks/**": picking # closed a task, more remain
```

- Still fully agnostic: the engine learns _glob emptiness_, never "packages".
- δ-purity holds in the same sense as today: the decision is a function of (HEAD
  tree + pending diff); the tree listing is already available at the edge
  (`changedPaths` / `WorktreeReader`).
- The `&` form keeps rows **event-triggered** (a bare `N …` row that could fire
  on any unrelated diff would be a foot-gun); the predicate only guards.
- Cost: pattern parser/matcher/validation growth, resolve needs a tree listing,
  STATES.md §3 grows a second concept, property tests. Deliberately **deferred**
  — Option A covers the need with zero engine surface; this only pays for itself
  if arbiter states show up in every workflow and feel like boilerplate.

## 5. Option D — template enumeration helper: `it.ls(glob)`

Small, orthogonal, generic: add `ls(glob) → string[]` (sorted, working-tree)
next to `read(path)` in the template context.

- Lets Option A's script shrink to pure verdict-writing and lets prompts and
  messages show the queue ("Remaining tasks:\n<%=
  it.ls('.gtd/tasks/*.md').join('\n') %>") without shell gymnastics.
- Lets Option B's prompt state the ground truth instead of trusting agent memory
  ("these tasks remain: …; if this list has one entry, also delete the marker").
- No new decision power (templates render content, they don't route), so it
  cannot compromise the δ discipline.

## 6. A topology variant worth knowing: process-per-task

Nothing stops a workflow from making **each task its own process**: the per-task
cycle ends in its own `commit:` state, squashing just that task's work into one
commit; the squash boundary resolves back to the initial state, whose router (an
Option-A-style arbiter at or right after `initial`) picks the next task or falls
through to the review/idle path.

Why it's attractive:

- **Per-task commits** — history reads one commit per task instead of one per
  cycle.
- **Per-task budgets** — `retry` visit-counts are process-scoped, so today a
  10-task cycle POOLS `fixing`'s `max: 3` across all tasks; task-sized processes
  give each task its own cap. (This interaction exists regardless of which
  option is chosen and should be called out in docs.)
- Smaller diffs at review time.

Why it's not the default recommendation: the initial state doubles as the human
entry point, so the router shape is more intricate (the arbiter must distinguish
"mid-flight, tasks remain" from "fresh repo, wait for a human"), and cycle-level
review/squash semantics change meaningfully. A worked example belongs in
`docs/configuration.md` once the basic loop lands.

## 7. Recommendation

1. **Now (config-only, no engine change):** re-author the bundled default's
   builder segment as the Option-A loop
   (`decompose → picking ⇄ building ⇄ checking/fixing → reviewing`), with the
   `NEXT.md` arbiter script and the one-task building prompt. Document Option B
   in `docs/configuration.md` as the script-less variant.
2. **Now (one small generic helper):** add `it.ls(glob)` (Option D) — cheap,
   broadly useful, and it makes both A and B materially better.
3. **Deferred:** Option C (`& N/E <glob>` tree-predicate guards) — revisit only
   if arbiter boilerplate becomes a demonstrated pain across real workflows.
4. **Docs either way:** call out the retry-cap pooling interaction (§6) and the
   process-per-task topology as a recipe.
