/**
 * `gtd mermaid`: a pure emitter of the active workflow's SHAPE as Mermaid
 * `stateDiagram-v2` source — one node per state, the `[*] -->` initial-state
 * marker, one edge per declared `on` row (labeled with its raw pattern
 * string), `--> [*]` for every commit state (final, no outgoing edges), and
 * one `note right of` per rest naming its actor/content-kind/retry cap. No
 * git, no Effect, no template rendering: same purity discipline as
 * `PatternMachine.ts` — a plain function of an already-`validateDefinition`d
 * `WorkflowDefinition` (see `Config.ts`'s `toOperations`/`compileWorkflowConfig`
 * — every `WorkflowDefinition` this module ever sees has already been
 * validated, so an `on` target or `retry.otherwise` is trusted to name a
 * defined state rather than re-checked here).
 */

import {
  contentKindOf,
  initialStateOf,
  isCommitState,
  type StateDef,
  type WorkflowDefinition,
} from "./PatternMachine.js"

/**
 * Mermaid identifiers must avoid quotes/newlines inside a quoted label —
 * collapse both so the label stays on one line and the diagram stays
 * parseable even if a state name or `on` pattern happens to carry either.
 */
const escapeLabel = (text: string): string => text.replace(/"/g, "'").replace(/\r?\n/g, " ")

/**
 * A Mermaid-safe node id for one state name: every non-word character folds
 * to `_` (state names may carry hyphens — `todo-validating`,
 * `review-deciding` — which Mermaid's bare identifier grammar doesn't
 * guarantee), and a leading digit gets an `s_` prefix (Mermaid ids can't
 * start with one). The exact original name still reaches the diagram via
 * this alias's `state "<name>" as <alias>` declaration.
 */
const aliasFor = (name: string): string => {
  const folded = name.replace(/[^A-Za-z0-9_]/g, "_")
  return /^[0-9]/.test(folded) ? `s_${folded}` : folded
}

/** One rest's actor/content-kind/retry-cap summary, for a `note right of` line. */
const stateNote = (state: StateDef): string => {
  const parts = [state.actor, contentKindOf(state)].filter((p): p is string => p !== undefined)
  const retry =
    state.retry !== undefined ? [`retry ${state.retry.max}→${state.retry.otherwise}`] : []
  return [...parts, ...retry].join(" · ")
}

/**
 * Render `def`'s shape as Mermaid `stateDiagram-v2` source. One
 * `state "<name>" as <alias>` declaration per state up front (so every
 * transition/note below can reference the safe alias while the rendered
 * diagram still shows the exact declared name), then the initial-state
 * marker, then one edge per `on` row (declaration order — same "first match
 * wins" order the engine itself evaluates), then `<alias> --> [*]` for every
 * commit state, then one actor/content-kind/retry note per rest.
 */
export const renderMermaid = (def: WorkflowDefinition): string => {
  const names = Object.keys(def.states)
  const alias = new Map(names.map((name) => [name, aliasFor(name)] as const))

  const lines: string[] = ["stateDiagram-v2"]

  for (const name of names) {
    lines.push(`    state "${escapeLabel(name)}" as ${alias.get(name)}`)
  }

  lines.push(`    [*] --> ${alias.get(initialStateOf(def))}`)

  for (const name of names) {
    const state = def.states[name]!
    const from = alias.get(name)!
    if (isCommitState(state)) {
      lines.push(`    ${from} --> [*]`)
      continue
    }
    for (const [pattern, target] of state.on ?? []) {
      lines.push(`    ${from} --> ${alias.get(target)} : ${escapeLabel(pattern)}`)
    }
  }

  for (const name of names) {
    const state = def.states[name]!
    if (isCommitState(state)) continue
    lines.push(`    note right of ${alias.get(name)} : ${escapeLabel(stateNote(state))}`)
  }

  return lines.join("\n") + "\n"
}
