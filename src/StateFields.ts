// ── Vocabulary types ─────────────────────────────────────────────────────────

/** No closed vocabulary of "kinds" — any workflow-defined string. */
export type Actor = string

/** Defined by whatever keys `WorkflowDefinition.states` declares — not a closed vocabulary. */
export type StateName = string

/** The three content kinds a state can carry — exactly one per state. */
export type ContentKind = "script" | "prompt" | "message"

/** The name of a steering-file mode. Not a closed vocabulary: the valid set derives from the active definition (`BUILT_IN_MODES` plus whatever `modes:` declares). */
export type StateMode = string

/** `{ max, otherwise }` — redirect a transition once its target has been entered `max` times this process. */
export interface RetryDef {
  readonly max: number
  readonly otherwise: StateName
}

/**
 * One `on` row: a pattern paired with its target state, plus optional
 * `describe`/`action` strings emitted verbatim to a human-facing consumer —
 * both are INERT to the engine (never read by `step`/`matchesPattern`, never
 * Eta-rendered; the edge renders the pattern itself as a template before
 * handing it to the engine, but `describe`/`action` pass through untouched).
 * Kept as an ordered TUPLE, not an object, so declaration order survives a
 * config compiler rebuilding the object and two rows can't dedupe by sharing
 * a pattern string.
 */
export type OnEdge = readonly [
  pattern: string,
  target: StateName,
  describe?: string | undefined,
  action?: string,
]

// ── The field table ──────────────────────────────────────────────────────────

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
  /** Marks a text field whose value may be a `./`- or `../`-prefixed file reference, inlined from the declaring config file's directory. */
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
 * Every state property, in the order `KNOWN_STATE_KEYS`/`compileState` use —
 * this order is also the compile-time error sequencing.
 */
const STATE_FIELDS = {
  actor: {
    kind: "actor",
    surface: "def",
    authored: "state",
    viz: "field",
    doc: "Who acts at this state. Required on every state.",
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

  /** Not authored directly on a state anymore: the compiler stamps this from the owning machine's own `model:` onto every one of its `prompt` states. */
  model: {
    kind: "text",
    surface: "def",
    authored: "machine",
    nonEmpty: true,
    viz: "field",
    rest: "rendered",
    doc: 'Opaque harness hint stamped onto every one of this machine\'s own `prompt` states (e.g. "smart"), passed through `gtd next --json`/`gtd status --json`. The ONLY place a model may be declared — a state carrying its own `model:` is a config error. Never interpreted by gtd. A machine declaring this with no `prompt` state is a config error.',
  },

  system: {
    kind: "text",
    surface: "def",
    authored: "machine",
    nonEmpty: true,
    fileRef: true,
    rest: "rendered",
    viz: "field",
    doc: "The agent harness system prompt stamped onto every one of this machine's own `prompt` states — emitted verbatim in `gtd next --json`/`--sh` for the driver to pass to its agent CLI, never interpreted by gtd. Machine-level only: a machine's `prompt` states share one resumed session, and a system prompt must be identical across every call of it. A `./` or `../` value is inlined from the declaring config file's directory. A machine declaring this with no `prompt` state is a config error.",
  },

  /** The raw-state-name fallback lives in the consumer (driver/viewer), not here — gtd simply omits the field when unset. */
  label: {
    kind: "text",
    surface: "def",
    authored: "state",
    nonEmpty: true,
    rest: "rendered",
    doc: 'Opaque display name passed through `gtd next --json`/`gtd status --json` so a driver/viewer can show something nicer than the raw state name (e.g. "Running checks"). Never interpreted by gtd.',
  },

  /** Multiple states may (and, in the bundled default, do) share one `file:`. The engine never reads a path out of this string itself — only the LSP interprets it, to map rendered paths to `mode`. */
  file: {
    kind: "stateFile",
    surface: "def",
    authored: "state",
    nonEmpty: true,
    viz: "field",
    rest: "rendered",
    doc: 'The state\'s steering file: an Eta template naming the file a human/editor should look at while the machine rests here, RELATIVE to ".gtd/" — the compiler prepends that directory automatically. A ".." segment, an absolute path, or an already-prefixed ".gtd/" are rejected, not rewritten.',
  },

  /** Opaque, like `model`: the engine never branches on it — the edge (`src/SteeringMode.ts`) resolves it to a format/validate pair. `validateDefinition` only enforces that the name resolves, so a typo can't silently disable the gate. */
  mode: {
    kind: "mode",
    surface: "def",
    authored: "state",
    requires: "file",
    viz: "field",
    rest: "verbatim",
    doc: "The steering file's format: the name of a built-in mode (qa/review, validated in-process by gtd) or of a `modes:` entry. gtd formats and validates the file with that mode before capturing a turn out of this state, and the LSP dispatches live diagnostics on the built-in names. Requires a sibling `file:`.",
  },

  /** This module's pure functions never read this flag — the window is opened/closed entirely at the edge (`src/ReviewWindow.ts`). */
  reviewWindow: {
    kind: "flag",
    surface: "def",
    authored: "state",
    viz: "flag",
    doc: "When true, gtd opens a review checkout window while the machine rests here — HEAD/index are rewound to the review base so the whole base..HEAD diff surfaces as uncommitted changes in the editor.",
  },

  /** Like `reviewWindow`, the engine never reads this — it's history-derived edge data. `isReviewBaseState` never treats a string value as the `true`/window-anchor form. */
  reviewBase: {
    kind: "flagOrTemplate",
    surface: "def",
    authored: "state",
    viz: "flag",
    doc: "true marks the state whose most-recent in-process commit anchors the review window's diff base; absent any, the base is the process start. A string is a different shape: an Eta template rendering a commitish that becomes the WHOLE PROCESS's fixed diff base when this state is entered manually via `gtd --entry <state> --base <commitish>` (see the `entry` property below).",
  },

  /** The pure engine never reads this — checked at the edge by the feedback-progress guard in `src/StepGuards.ts`. */
  requireProgress: {
    kind: "flag",
    surface: "def",
    authored: "state",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused if its only pending change is deleting the state's own `file:` — a work-free turn that discards its input without addressing it. A `NOTHING ACTIONABLE` sentinel file is exempt (a legitimately non-actionable round makes no code change). Requires a `file:`.",
  },

  /** The pure engine never reads this — checked at the edge by the answer-completeness guard in `src/StepGuards.ts`, and only when the state also declares `mode: qa`. */
  answerGate: {
    kind: "flag",
    surface: "def",
    authored: "state",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused unless every open question in its qa-mode `file:` is answered — exactly one checkbox ticked per question. Requires a `file:` and `mode: qa`.",
  },

  /**
   * The pure engine never reads this — checked at the edge by the
   * require-revert guard in `src/StepGuards.ts`, which re-establishes the
   * fact from the tree itself rather than trusting the script's exit code (a
   * `git apply -R` that silently applies nothing must not be mistaken for a
   * real revert).
   */
  requireRevert: {
    kind: "flag",
    surface: "def",
    authored: "state",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused unless the paths the human's own review-round commit touched have actually been reverted out of the working tree — re-established from the tree itself, never from the script's own exit code. Requires a `file:`.",
  },

  /** Authoring-only: never lands on the compiled `StateDef` — `compileWorkflowConfig` reads the raw flag directly to build `entries.manual` instead. */
  entry: {
    kind: "flag",
    surface: "authoring-only",
    authored: "state",
    jsonSchema: ENTRY_JSON_SCHEMA,
    doc: ENTRY_JSON_SCHEMA.description,
  },
} as const satisfies Record<string, FieldSpec>

// ── Derived ──────────────────────────────────────────────────────────────────

/** The field table's own type — exported so a derivation site can build its own mapped type filtered by a `FieldSpec` property, the same way `StateDef` below filters by `surface`. */
export type StateFieldsTable = typeof STATE_FIELDS

type Fields = StateFieldsTable

type DefFieldName = {
  [K in keyof Fields]: Fields[K]["surface"] extends "def" ? K : never
}[keyof Fields]

/**
 * One state's declaration: every field whose `surface` is `"def"`. Exactly
 * one of `script`/`prompt`/`message` should be set — enforced by
 * `validateDefinition`, not the type, since a config compiler assembles these
 * from loosely-typed YAML.
 */
export type StateDef = {
  readonly [K in DefFieldName]?: FieldValue[Fields[K]["kind"]]
}

export const STATE_FIELD_ENTRIES: ReadonlyArray<[keyof Fields, FieldSpec]> = Object.entries(
  STATE_FIELDS,
) as ReadonlyArray<[keyof Fields, FieldSpec]>

/** The three content-kind field names, in declaration order — the "exactly one of" set `validateContentKind`/`compileContent` iterate. */
export const CONTENT_FIELDS: readonly string[] = STATE_FIELD_ENTRIES.filter(
  ([, spec]) => spec.kind === "content",
).map(([key]) => key)

/** Every machine-authored field, in table order — the machine tier's `CONTENT_FIELDS`. */
export const MACHINE_FIELD_ENTRIES: ReadonlyArray<[string, FieldSpec]> = STATE_FIELD_ENTRIES.filter(
  ([, spec]) => spec.authored === "machine",
)

/**
 * The generic per-field rules every derivation site walks the same way:
 * non-empty, requires a sibling field — only evaluated when `key` is
 * actually declared on `state`. A field's own bespoke checks (an `on`
 * pattern parsing, a `mode` name resolving, …) are the caller's concern.
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
  if (spec.requires !== undefined && raw[spec.requires] === undefined) {
    errors.push(`state "${name}": "${key}" requires "${spec.requires}"`)
  }
  return errors
}

export { STATE_FIELDS }
