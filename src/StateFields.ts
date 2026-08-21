/**
 * The state-field table — the single place a state property is declared
 * (issue #158, phase 1). Before this module, one property was declared in
 * eight separate enumerations across five files (the `StateDef` interface,
 * `KNOWN_STATE_KEYS`, per-field validators, per-field compilers, the editor
 * JSON schema, and the visualizer's flag/tooltip maps) — adding `answerGate`
 * touched seven of them and missed the editor schema for ten commits,
 * shipping a schema that rejected valid configs. `STATE_FIELDS` is now the
 * one table every one of those sites derives from: adding a property is one
 * entry here plus its behaviour.
 *
 * A zero-import leaf: `const` data plus total functions, no IO, no Effect —
 * checked by `StateFields.test.ts` (it regexes this file's own source for an
 * `import` statement). This is the root of the import graph;
 * `src/PatternMachine.ts` gains exactly one import edge onto this module and
 * loses no purity property — it stays pure (no git, no filesystem, no
 * Effect), it just no longer OWNS the field vocabulary itself.
 *
 * The vocabulary types (`Actor`, `StateName`, `ContentKind`, `StateMode`,
 * `OnEdge`, `RetryDef`) live here too, so there is no type-only import cycle
 * with `PatternMachine.ts` — which re-exports all of them (plus `StateDef`
 * and `isCommitState`) so every existing `from "./PatternMachine.js"` import
 * keeps working unchanged.
 */

// ── Vocabulary types ─────────────────────────────────────────────────────────

/** Who acts at a state — a plain string, no closed vocabulary of "kinds". */
export type Actor = string

/** A state name — a plain string, defined by whatever keys `WorkflowDefinition.states` declares. */
export type StateName = string

/** The four content kinds a state can carry — exactly one per state. */
export type ContentKind = "script" | "prompt" | "message" | "commit"

/**
 * The NAME of a steering-file mode — see the `mode` field below. NOT a closed
 * vocabulary: the valid set derives from the active definition (`PatternMachine.ts`'s
 * `BUILT_IN_MODES` plus whatever `modes:` declares — see `knownModes`), exactly
 * the way `declaredActors` derives the commit grammar's actor set.
 */
export type StateMode = string

/** `{ max, otherwise }` — redirect a transition once its target has been entered `max` times this process. */
export interface RetryDef {
  readonly max: number
  readonly otherwise: StateName
}

/**
 * One `on` row: a raw pattern string paired with its target state, plus an
 * OPTIONAL human-readable `describe` — a plain sentence a `message:` template
 * can surface at a rest to tell a human which change routes where (see
 * `PatternTemplates.TemplateContext.edges`). Kept as an ordered TUPLE (not an
 * object key) so declaration order survives regardless of how a definition is
 * built — object key order is an incidental JS guarantee that a config
 * compiler (YAML, merged definitions) could easily break by rebuilding an
 * object; a tuple array cannot silently reorder or dedupe two rows that happen
 * to share a pattern string.
 *
 * `describe` is INERT to the engine — `step`/`resolveState`/`matchesPattern`
 * never read it, and it is NEVER Eta-rendered. The pattern
 * key itself is different: the pure engine only ever sees a
 * plain string here too, but the edge (`src/Edge.ts`'s `renderOnEdges`)
 * renders it as an Eta template against `it.vars` BEFORE handing it to
 * `step`/`matchesPattern` — so a workflow author writes
 * `"A <%= it.vars.feedbackFile %>"` and the engine still only ever matches a
 * literal string. `describe` exists only to be emitted verbatim so the
 * driving loop / a `message:` template can present it to a human.
 *
 * `action` is a fourth, OPTIONAL slot with the exact same discipline as
 * `describe`: an imperative label (e.g. `"Accept plan"`) that is INERT to the
 * engine — never read by `step`/`resolveState`/`matchesPattern`, and NEVER
 * Eta-rendered. It exists only to be emitted verbatim to a consumer (a CLI
 * message, `gtd status --json`, a visualization) — none of which are wired up
 * yet; this type is pure plumbing. Because this is a positional tuple and not
 * an object, an edge that wants an `action` but no `describe` must still pass
 * an explicit placeholder in slot 3 (e.g. `undefined`) to reach slot 4.
 */
export type OnEdge = readonly [
  pattern: string,
  target: StateName,
  describe?: string | undefined,
  action?: string,
]

// ── The field table ──────────────────────────────────────────────────────────

/** The value shape for each `FieldKind`. */
export interface FieldValue {
  readonly actor: Actor
  readonly content: string
  readonly text: string
  readonly stateFile: string
  readonly mode: StateMode
  readonly flag: boolean
  readonly flagOrTemplate: true | string
  readonly edges: readonly OnEdge[]
  readonly retry: RetryDef
}

export type FieldKind = keyof FieldValue

/** One state property's declared behaviour — everything the derivation sites need to compile, validate, schema, and present it. */
export interface FieldSpec {
  readonly kind: FieldKind
  /** "def" lands on the compiled `StateDef`; "authoring-only" is validated then discarded (`entry:`). */
  readonly surface: "def" | "authoring-only"
  /** "machine" = stamped by the owning machine; a state-level declaration is a migration error. "state" = authored directly on a state. */
  readonly authored: "state" | "machine"
  /** → `state "<name>": a commit state cannot declare "<key>"` */
  readonly commit?: "forbidden"
  /** → `state "<name>": "<key>" must be a non-empty string` */
  readonly nonEmpty?: true
  /** Names another field this one requires be set → `state "<name>": "<key>" requires "<requires>"` */
  readonly requires?: string
  /** How the visualizer presents this field: a key/value field, or a boolean-style flag chip. Absent when the visualizer doesn't surface it (e.g. `entry`, which is derived from `entries.manual` instead). */
  readonly viz?: "field" | "flag"
  /** How `Edge.ts`'s `renderRest` carries this field onto `RenderedRest`: `"rendered"` (Eta-rendered, then omitted if unset) or `"verbatim"` (passed through as-is). Absent for fields `renderRest` doesn't carry (content, `on`, `retry`, `entry`). */
  readonly rest?: "verbatim" | "rendered"
  /** The editor schema's `description` AND the visualizer tooltip text. */
  readonly doc: string
  /** Escape hatch for a property whose JSON Schema is structurally nested (`on`, `retry`) or otherwise doesn't fit `{ ...JSON_TYPE[kind], description: doc }` (`entry`'s `const: true`). */
  readonly jsonSchema?: object
  /** Marks a text field whose value may be a `./`- or `../`-prefixed file reference, inlined from the declaring config file's directory (package 02's concern — this module only carries the flag). */
  readonly fileRef?: true
}

const ON_JSON_SCHEMA = {
  type: "object",
  description:
    'Ordered map of change pattern -> target state. Patterns: "C" (clean tree) or "<A|M|D|*> <glob>" over the pending diff; first declared match wins. Every target must name a defined state, and every non-initial state must be reachable through these edges (or a retry.otherwise). A value is either the target state name (string) or a { to, describe, action } object whose describe/action are human-readable strings templates can surface as it.edges (e.g. in a human gate\'s message).',
  additionalProperties: {
    oneOf: [
      { type: "string", description: "The target state name." },
      {
        type: "object",
        additionalProperties: false,
        required: ["to"],
        properties: {
          to: { type: "string", description: "The target state name." },
          describe: {
            type: "string",
            description:
              "Human-readable sentence describing where this change routes; surfaced verbatim (never Eta-rendered) to templates as it.edges[].describe.",
          },
          action: {
            type: "string",
            description:
              'Imperative label for this edge (e.g. "Accept plan"); surfaced verbatim (never Eta-rendered) to templates/tooling as it.edges[].action.',
          },
        },
      },
    ],
  },
} as const

const RETRY_JSON_SCHEMA = {
  type: "object",
  description:
    "Redirect transitions INTO this state once it has been entered `max` times in the current process.",
  additionalProperties: false,
  required: ["max", "otherwise"],
  properties: {
    max: {
      type: "integer",
      minimum: 0,
      description: "Entries allowed this process before redirecting.",
    },
    otherwise: {
      type: "string",
      description: "Defined state to redirect to once over the cap.",
    },
  },
} as const

const ENTRY_JSON_SCHEMA = {
  const: true,
  description:
    "Marks this state as an extra manual entry point (WorkflowEntries.manual), enterable via `gtd --entry <state>`. Not to be confused with the top-level `entry:` key naming the root machine (entry.default) — same name, different level, by design.",
} as const

/**
 * Every state property, in exactly the order `KNOWN_STATE_KEYS`/`compileState`
 * have always used — load-bearing: it is also today's compile-time error
 * sequencing, which stays byte-identical for it.
 */
const STATE_FIELDS = {
  actor: {
    kind: "actor",
    surface: "def",
    authored: "state",
    viz: "field",
    doc: "Who acts at this state. Required on every non-commit state; forbidden on a commit state.",
  },

  script: {
    kind: "content",
    surface: "def",
    authored: "state",
    doc: "Content kind: a shell script (Eta template). The loop driver executes it verbatim via bash, then steps this state's actor.",
  },
  prompt: {
    kind: "content",
    surface: "def",
    authored: "state",
    doc: "Content kind: an agent prompt (Eta template), emitted by `gtd next`.",
  },
  message: {
    kind: "content",
    surface: "def",
    authored: "state",
    doc: "Content kind: a human-facing message (Eta template), emitted by `gtd next`.",
  },
  commit: {
    kind: "content",
    surface: "def",
    authored: "state",
    doc: "Content kind: entering this state ends the process by squashing it into one commit with this message (Eta template). Final — no actor, no on.",
  },

  on: {
    kind: "edges",
    surface: "def",
    authored: "state",
    jsonSchema: ON_JSON_SCHEMA,
    doc: ON_JSON_SCHEMA.description,
  },

  retry: {
    kind: "retry",
    surface: "def",
    authored: "state",
    viz: "field",
    jsonSchema: RETRY_JSON_SCHEMA,
    doc: RETRY_JSON_SCHEMA.description,
  },

  /**
   * An OPAQUE harness hint — gtd never interprets this string, it only
   * passes it through verbatim (`gtd next --json`/`gtd status --json`) so
   * the driving loop can map it onto whatever models its agent harness
   * provides (e.g. `"smart"`, `"fast"`, or a concrete model id). Unset means
   * "use the harness's default". Plays no role in engine decisions — `step`
   * and `resolveState` never read it. Forbidden on a commit state (never at
   * rest, emits nothing — see `validateDefinition`). No longer authored
   * directly on a state: the compiler (`src/PatternConfig.ts`, over
   * `src/Machines.ts`'s flattening pass) STAMPS this field from the state's
   * owning machine's own `model:` declaration, onto every one of that
   * machine's emitted states whose content kind is `prompt` — a state itself
   * never declares `model:` directly anymore.
   */
  model: {
    kind: "text",
    surface: "def",
    authored: "machine",
    nonEmpty: true,
    commit: "forbidden",
    viz: "field",
    rest: "rendered",
    doc: 'Opaque harness hint stamped onto every one of this machine\'s own `prompt` states (e.g. "smart"), passed through `gtd next --json`/`gtd status --json`. The ONLY place a model may be declared — a state carrying its own `model:` is a config error. Never interpreted by gtd. A machine declaring this with no `prompt` state is a config error.',
  },

  system: {
    kind: "text",
    surface: "def",
    authored: "machine",
    nonEmpty: true,
    commit: "forbidden",
    fileRef: true,
    rest: "rendered",
    viz: "field",
    doc: "The agent harness system prompt stamped onto every one of this machine's own `prompt` states — emitted verbatim in `gtd next --json`/`--sh` for the driver to pass to its agent CLI, never interpreted by gtd. Machine-level only: a machine's `prompt` states share one resumed session, and a system prompt must be identical across every call of it. A `./` or `../` value is inlined from the declaring config file's directory. A machine declaring this with no `prompt` state is a config error.",
  },

  /**
   * An OPAQUE, human-readable display NAME for the state — gtd never
   * interprets this string, it only passes it through verbatim (`gtd next
   * --json`/`gtd status --json`) so a driving loop or viewer can show
   * something nicer than the raw state name. There is no comparison
   * semantics here — it is just a label. Unset means "show the raw state
   * name" — that fallback lives in the CONSUMER (a driver/viewer), not in
   * gtd itself, which simply omits the field. Rendered as an Eta template
   * through the same `it.vars`-carrying context as `model`/content (a plain
   * string with no Eta tags passes through unchanged). Plays no role in
   * engine decisions — `step` and `resolveState` never read it. Forbidden on
   * a commit state (never at rest, emits nothing — see `validateDefinition`),
   * same rule family as `model`.
   */
  label: {
    kind: "text",
    surface: "def",
    authored: "state",
    nonEmpty: true,
    commit: "forbidden",
    rest: "rendered",
    doc: 'Opaque display name passed through `gtd next --json`/`gtd status --json` so a driver/viewer can show something nicer than the raw state name (e.g. "Running checks"). Never interpreted by gtd. Forbidden on a commit state.',
  },

  /**
   * Optional — THE steering file this state is about: the file a human/
   * editor should look at while the machine rests here. An Eta template
   * (rendered through the same `it.vars`-carrying context as content and
   * `model`) that must render non-empty. Names a path RELATIVE to `.gtd/` —
   * the compiler prepends the directory (see `PatternConfig.ts`'s `stateFile`
   * compiler); a `..` segment, an absolute path, or an already-prefixed
   * `.gtd/...` declaration are all load-time errors, never silently
   * rewritten. Forbidden on a commit state (never at rest — see
   * `validateDefinition`). Multiple states may share one `file:` (and, in the
   * bundled default, do). The engine never reads a path out of this string
   * itself — only the LSP (`src/Lsp.ts`) interprets it, to map rendered paths
   * to `mode`.
   */
  file: {
    kind: "stateFile",
    surface: "def",
    authored: "state",
    nonEmpty: true,
    commit: "forbidden",
    viz: "field",
    rest: "rendered",
    doc: 'The state\'s steering file: an Eta template naming the file a human/editor should look at while the machine rests here, RELATIVE to ".gtd/" — the compiler prepends that directory automatically. A ".." segment, an absolute path, or an already-prefixed ".gtd/" are rejected, not rewritten. Forbidden on a commit state.',
  },

  /**
   * Optional, requires `file:`. The associated file's FORMAT — the NAME of a
   * mode, either one of the two built-ins (`qa` | `review`, see
   * `PatternMachine.ts`'s `BUILT_IN_MODES`) or one the workflow declares in
   * `modes:` (see `ModeDef`). Like `model`, this is opaque, emitted data: the
   * ENGINE never branches on it, `step` and `resolveState` never read it —
   * the edge (`src/SteeringMode.ts`) resolves it to a format/validate pair,
   * and the LSP dispatches its live diagnostics on the built-in names. The
   * only rule `validateDefinition` enforces is that the name RESOLVES (a
   * typo must not silently disable the gate). Forbidden on a commit state
   * (see `validateDefinition`).
   */
  mode: {
    kind: "mode",
    surface: "def",
    authored: "state",
    commit: "forbidden",
    requires: "file",
    viz: "field",
    rest: "verbatim",
    doc: "The steering file's format: the name of a built-in mode (qa/review, validated in-process by gtd) or of a `modes:` entry. gtd formats and validates the file with that mode before capturing a turn out of this state, and the LSP dispatches live diagnostics on the built-in names. Requires a sibling `file:`. Forbidden on a commit state.",
  },

  /**
   * Optional. When `true`, gtd opens a "review checkout window" while a
   * process RESTS at this state: HEAD and the index are temporarily rewound to
   * the review base (see `reviewBase`) with the working tree untouched, so the
   * whole `base..HEAD` diff surfaces as ordinary uncommitted changes in any
   * editor's standard git integration. The window is closed (HEAD/index
   * restored) the moment the process rests anywhere else. This module's PURE
   * functions never read it — `resolveState`/`step` are oblivious; the window
   * is opened/closed entirely at the edge (`src/ReviewWindow.ts`), keyed on
   * this flag of the resolved rest. Forbidden on a commit state (never at
   * rest — see `validateDefinition`).
   */
  reviewWindow: {
    kind: "flag",
    surface: "def",
    authored: "state",
    commit: "forbidden",
    viz: "flag",
    doc: "When true, gtd opens a review checkout window while the machine rests here — HEAD/index are rewound to the review base so the whole base..HEAD diff surfaces as uncommitted changes in the editor. Forbidden on a commit state.",
  },

  /**
   * Optional. `true` marks a state whose most-recent in-process turn commit is
   * the BASE of the review window's diff (`base..HEAD`) — everything committed
   * after entering this state surfaces as pending while the window is open.
   * When no in-process commit entered a `reviewBase` state, the window falls
   * back to the process start (see `src/ReviewWindow.ts`). Like `reviewWindow`
   * the ENGINE never reads it — it is history-derived edge data.
   *
   * A STRING is a different shape entirely: an Eta template rendering a
   * commitish. Entering that state fixes the WHOLE PROCESS's diff base to the
   * rendered value (not a window anchor) — this is how a manual entry (e.g.
   * `gtd --entry review --base <commitish>`) pins what the rest
   * of the process diffs against. Rendering the template happens at the edge,
   * not here — this module only carries the raw string and, per
   * `isReviewBaseState`, a string value is NEVER treated as the `true`/
   * window-anchor form.
   *
   * Forbidden on a commit state (see `validateDefinition`).
   */
  reviewBase: {
    kind: "flagOrTemplate",
    surface: "def",
    authored: "state",
    commit: "forbidden",
    viz: "flag",
    doc: "true marks the state whose most-recent in-process commit anchors the review window's diff base; absent any, the base is the process start. A string is a different shape: an Eta template rendering a commitish that becomes the WHOLE PROCESS's fixed diff base when this state is entered manually via `gtd --entry <state> --base <commitish>` (see the `entry` property below). Forbidden on a commit state.",
  },

  /**
   * Optional. When `true`, a step at this state is REFUSED if its only pending
   * change is deleting the state's own `file:` — a work-free turn that discards
   * its input without addressing it (the "review feedback captured then
   * silently deleted" bug). Like the review window and sign-off gate, the PURE
   * engine never reads it: the check lives at the edge
   * (the feedback-progress guard in `src/StepGuards.ts`), which also exempts a
   * `NOTHING ACTIONABLE` sentinel file (a legitimately non-actionable feedback
   * round that makes no code change). Requires a `file:`; forbidden on a commit
   * state (never at rest — see `validateDefinition`).
   */
  requireProgress: {
    kind: "flag",
    surface: "def",
    authored: "state",
    commit: "forbidden",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused if its only pending change is deleting the state's own `file:` — a work-free turn that discards its input without addressing it. A `NOTHING ACTIONABLE` sentinel file is exempt (a legitimately non-actionable round makes no code change). Requires a `file:`. Forbidden on a commit state.",
  },

  /**
   * Optional. When `true`, a step at this state is REFUSED unless every OPEN
   * question in its `qa`-mode `file:` is answered — EXACTLY ONE checkbox ticked
   * per question (and, when the ticked one is the trailing free-text slot, its
   * text is non-empty). This is what makes the bundled template's answer gates
   * (`design.gate.answer`/`architecture.gate.answer`) require a decision on
   * every question before looping back or advancing. Like the review sign-off gate,
   * the PURE engine never reads it: the check lives at the edge
   * (the answer-completeness guard in `src/StepGuards.ts`, over
   * `src/OpenQuestions.ts`), and only acts when the state also declares
   * `mode: qa`. Requires a `file:`; forbidden on a commit state (never at
   * rest — see `validateDefinition`).
   */
  answerGate: {
    kind: "flag",
    surface: "def",
    authored: "state",
    commit: "forbidden",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused unless every open question in its qa-mode `file:` is answered — exactly one checkbox ticked per question. Requires a `file:` and `mode: qa`. Forbidden on a commit state.",
  },

  /**
   * Optional. When `true`, a step at this state is REFUSED unless the paths
   * the human's own review-round commit touched have actually been reverted
   * out of the working tree — a `git apply -R` that silently applied nothing
   * (atomic without `--reject`/`-3`, so a failed patch leaves the tree
   * byte-for-byte unchanged) must not be mistaken for the note-only round its
   * `C` row also serves. Like the other guarded flags, the PURE engine never
   * reads it: the check lives at the edge (the require-revert guard in
   * `src/StepGuards.ts`), which re-establishes the fact from the tree itself
   * rather than trusting any signal the script left behind — idempotent, so a
   * script-revert, a hand-revert, or nothing-to-revert all answer alike.
   * Requires a `file:` (the state's own steering file, exempted by exact path
   * from the paths the guard considers residue); forbidden on a commit state
   * (never at rest — see `validateDefinition`).
   */
  requireRevert: {
    kind: "flag",
    surface: "def",
    authored: "state",
    commit: "forbidden",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused unless the paths the human's own review-round commit touched have actually been reverted out of the working tree — re-established from the tree itself, never from the script's own exit code. Requires a `file:`. Forbidden on a commit state.",
  },

  /**
   * Authoring-only: an EXTRA reachability root (`WorkflowEntries.manual`),
   * enterable via `gtd --entry <this state's qualified name>`.
   * Never lands on the compiled `StateDef` — `compileState` validates its
   * shape but discards the result; `compileWorkflowConfig` reads the RAW
   * `entry: true` flag directly off each qualified state to build
   * `entries.manual` instead (see `PatternConfig.ts`).
   */
  entry: {
    kind: "flag",
    surface: "authoring-only",
    authored: "state",
    jsonSchema: ENTRY_JSON_SCHEMA,
    doc: ENTRY_JSON_SCHEMA.description,
  },
} as const satisfies Record<string, FieldSpec>

// ── Derived ──────────────────────────────────────────────────────────────────

/** The field table's own type — exported so a derivation site (e.g. `Visualize.ts`'s `VizFieldName`) can build its own mapped type filtered by a `FieldSpec` property (there, `viz`) the same way `StateDef`, below, filters by `surface`. */
export type StateFieldsTable = typeof STATE_FIELDS

type Fields = StateFieldsTable

type DefFieldName = {
  [K in keyof Fields]: Fields[K]["surface"] extends "def" ? K : never
}[keyof Fields]

/**
 * One state's declaration, derived from `STATE_FIELDS`: every field whose
 * `surface` is `"def"`. Exactly one of `script`/`prompt`/`message`/`commit`
 * should be set (enforced by `validateDefinition`, not by the type — a config
 * compiler assembles these from loosely-typed YAML). A `commit` state is
 * FINAL: it carries no `actor` and no `on` (entering it ends the process; see
 * `StepDecision`'s `"squash"` kind).
 */
export type StateDef = {
  readonly [K in DefFieldName]?: FieldValue[Fields[K]["kind"]]
}

/** `Object.entries(STATE_FIELDS)`, typed so callers keep each entry's own `FieldSpec` shape. */
export const STATE_FIELD_ENTRIES: ReadonlyArray<[keyof Fields, FieldSpec]> = Object.entries(
  STATE_FIELDS,
) as ReadonlyArray<[keyof Fields, FieldSpec]>

/** The four content-kind field names, in declaration order — the "exactly one of" set `validateContentKind`/`compileContent` iterate. */
export const CONTENT_FIELDS: readonly string[] = STATE_FIELD_ENTRIES.filter(
  ([, spec]) => spec.kind === "content",
).map(([key]) => key)

/** Every machine-authored field, in table order — the machine tier's `CONTENT_FIELDS`. */
export const MACHINE_FIELD_ENTRIES: ReadonlyArray<[string, FieldSpec]> = STATE_FIELD_ENTRIES.filter(
  ([, spec]) => spec.authored === "machine",
)

/** True when a state is a commit (final, squash) state. */
export const isCommitState = (state: StateDef): boolean => state.commit !== undefined

/**
 * The generic per-field rules every derivation site walks the same way:
 * non-empty (when `nonEmpty`), forbidden on a commit state (when
 * `commit: "forbidden"`), and requires a sibling field (when `requires`
 * names one) — in that order, matching the order the checkers this replaces
 * always ran in. Only evaluated when `key` is actually declared on `state`;
 * an absent field breaks no rule. The field's own BESPOKE checks (an `on`
 * pattern parsing, a `mode` name resolving, a `reviewBase` template being
 * non-blank, …) are the caller's concern — this only ever emits the three
 * generic messages above.
 */
export const validateFieldRules = (
  name: string,
  state: StateDef,
  key: string,
  spec: FieldSpec,
): string[] => {
  const raw = state as unknown as Record<string, unknown>
  const value = raw[key]
  if (value === undefined) return []

  const errors: string[] = []
  if (spec.nonEmpty === true && value === "") {
    errors.push(`state "${name}": "${key}" must be a non-empty string`)
  }
  if (spec.commit === "forbidden" && isCommitState(state)) {
    errors.push(`state "${name}": a commit state cannot declare "${key}"`)
  }
  if (spec.requires !== undefined && raw[spec.requires] === undefined) {
    errors.push(`state "${name}": "${key}" requires "${spec.requires}"`)
  }
  return errors
}

export { STATE_FIELDS }
