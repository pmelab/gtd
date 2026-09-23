// ── Vocabulary types ─────────────────────────────────────────────────────────

// `Actor`/`StateName`/`ContentKind`/`StateMode` live in `src/wire/` (the
// wire's own vocabulary, `gtd next --json`'s `actor`/`state`/`mode` fields
// among them) and are re-exported here — see `src/wire/types.ts`'s doc
// comment for why the declarations moved.
export type { Actor, ContentKind, StateMode, StateName } from "./wire/index.js"
import type { Actor, StateMode, StateName } from "./wire/index.js"

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

/**
 * One `routes:` row: a declarative probability gate, not an expression
 * string. `question` names one of the judge state's own rendered question
 * ids; `is` the expected answer (a noul's yes/no, a choice's option, a
 * score's level); `minP` the probability floor that answer's own `p` must
 * clear (`>=`) to count as a match, `maxP` the probability CEILING it must
 * stay under (`<`) — both Eta templates (typically a workflow `var:`
 * reference), rendered the same way an `on:` pattern is: ALREADY-rendered by
 * the time the engine's `matchRoute` sees it, never re-rendered here. Either
 * bound alone is legal (a row with no `maxP` has no ceiling; one with no
 * `minP` has a floor of 0); `maxP` is what makes "yes, but not confidently"
 * expressible — the conjunction "all of N questions answered yes at p ≥ 0.90"
 * inverts to N escape-row PAIRS (one row for `is` != the expected answer, one
 * for the expected answer with `maxP` at the threshold) plus the catch-all.
 * A row carrying only `to` (every other field `undefined`) is the CATCH-ALL:
 * unconditional, matches regardless of any verdict, and legal only as the
 * LAST row of a state's `routes:` list — see `PatternMachine.ts`'s
 * `matchRoute`/`validateDefinition`.
 */
export interface RouteRow {
  readonly question?: string
  readonly is?: string
  readonly minP?: string
  readonly maxP?: string
  readonly to: StateName
}

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
  readonly judge: string
  readonly routes: readonly RouteRow[]
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

/**
 * `judge:`'s rendered output is not free text like `message`/`prompt` — it is
 * an Eta template whose render must produce the JSON document
 * `{ state, questions: [{ id, primitive, instructions, criteria }] }`. `state`
 * may only come from `it.read(...)`/the git helpers a `prompt` template
 * already uses (never an uncommitted gathering step). `questions` is part of
 * the RENDERED document, not a structured YAML field of its own — there is no
 * `questions:` key an author declares separately; it's written as ordinary
 * JSON text inside the same Eta template (the bundled `healthGate.judge`
 * writes its one question as a JSON literal right there), computed however
 * the template author likes, never parsed by the compiler. The shape is
 * still a plain string at the authoring level (same as `message`), so the
 * escape hatch exists only to carry this long-form contract as the schema's
 * `description`, the way `on`/`retry` carry theirs.
 */
const JUDGE_JSON_SCHEMA = {
  type: "string",
  description:
    "Eta template rendered ALONGSIDE this state's message: (content kind stays message — no sixth content kind). Must render to the JSON document { state, questions: [{ id, primitive, instructions, criteria }] }: `state` is evidence the template gathers only through it.read(...)/git helpers a prompt template already uses — never an uncommitted, freshly-gathered artifact. `questions` is part of the RENDERED document, not a separate structured YAML field — write it as ordinary JSON text inside this same template (a literal array, or computed however you like); gtd never parses it as YAML. `primitive` is one of noul (yes/no), choice, score. An unaware driver ignores this field and shows message: to a human; an aware driver pipes it to a judge model and answers with `gtd judge answer`. Requires a sibling `message:`.",
} as const

const ROUTES_JSON_SCHEMA = {
  type: "array",
  description:
    'Ordered list of judgment routing rows — a probability is not an "on" change pattern, so this is its own engine routing language. Each row is { question, is, minP, maxP, to }: question names one of this state\'s own judge: question ids, is the expected answer, minP the probability floor (>=) and maxP the probability ceiling (<) that answer\'s own p must clear (both Eta templates, typically a workflow var:; either alone is legal). First declared match wins, exactly like "on". The list MUST end with a catch-all row carrying only "to" — a list without one is a load error. A conjunction ("all of N questions answered yes at p >= threshold") is expressed by inversion: per question, one escape row for the wrong answer plus one for the right answer under maxP=threshold, routing to the conservative target, followed by the catch-all routing to the optimistic one. Requires a sibling `judge:`.',
  items: {
    type: "object",
    additionalProperties: false,
    required: ["to"],
    properties: {
      question: { type: "string", description: "One of this state's own judge: question ids." },
      is: { type: "string", description: "The expected answer for this row to match." },
      minP: {
        type: "string",
        description:
          "Probability floor (>=) the answer's own p must clear (an Eta template, typically a workflow var: reference).",
      },
      maxP: {
        type: "string",
        description:
          "Probability ceiling (<) the answer's own p must stay under (an Eta template, typically a workflow var: reference).",
      },
      to: { type: "string", description: "The target state name." },
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

  judge: {
    kind: "judge",
    surface: "def",
    authored: "state",
    requires: "message",
    rest: "rendered",
    viz: "field",
    jsonSchema: JUDGE_JSON_SCHEMA,
    doc: JUDGE_JSON_SCHEMA.description,
  },

  routes: {
    kind: "routes",
    surface: "def",
    authored: "state",
    requires: "judge",
    jsonSchema: ROUTES_JSON_SCHEMA,
    doc: ROUTES_JSON_SCHEMA.description,
  },

  /** A repo's debugging switch: records the verdict and routes as if no judgment existed — never a release stage every gate passes through. */
  shadow: {
    kind: "flag",
    surface: "def",
    authored: "state",
    requires: "judge",
    viz: "flag",
    doc: "When true, this state's judge: verdict is recorded (Gtd-Judge: trailer) but never consulted for routing — the state routes exactly as if judge: were absent. A debugging switch a repo turns on to diagnose a live threshold, not a release stage every gate passes through. Requires a sibling `judge:`.",
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
    doc: "The agent harness system prompt stamped onto every one of this machine's own `prompt` states — emitted verbatim in `gtd next --json` for the driver to pass to its agent CLI, never interpreted by gtd. Machine-level only: a machine's `prompt` states share one resumed session, and a system prompt must be identical across every call of it. A `./` or `../` value is inlined from the declaring config file's directory. A machine declaring this with no `prompt` state is a config error.",
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

  /**
   * An Eta template, like every other text field — a state names a workflow
   * `var:` a project repoints in `.gtdrc` or via `GTD_<NAME>`, the same route
   * `plannerModel` already takes. `requires: "prompt"` is the safety
   * boundary: a `script` state's content runs through bash, where a
   * concatenated preamble is a syntax error; a `message` state's content is
   * read by a human, who has no skills to load.
   */
  skills: {
    kind: "text",
    surface: "def",
    authored: "state",
    nonEmpty: true,
    requires: "prompt",
    rest: "rendered",
    viz: "field",
    doc: 'The skills this state\'s agent should load, as prose for its own harness — an Eta template (typically a workflow var: reference). A literal `skills: ""` is rejected at load (nonEmpty); a value that RENDERS blank is legal and means "no skills at this state this run" — the preamble is simply omitted. gtd never resolves, loads, or validates a skill name; it is concatenated into the prompt untouched, prepended via the `skillsPreamble` var (blank that var to switch the mechanism off repo-wide). Requires a sibling `prompt:`.',
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

  /** The engine never reads this — it's history-derived edge data. `isReviewBaseState` never treats a string value as the `true`/window-anchor form. */
  reviewBase: {
    kind: "flagOrTemplate",
    surface: "def",
    authored: "state",
    viz: "flag",
    doc: "true marks the state whose most-recent in-process commit anchors the review window's diff base; absent any, the base is the process start. A string is a different shape: an Eta template rendering a commitish that becomes the WHOLE PROCESS's fixed diff base when this state is entered manually via `gtd --entry <state> --base <commitish>` (see the `entry` property below).",
  },

  /** The pure engine never reads this — checked at the edge by the feedback-progress guard in `src/step/Guards.ts`. */
  requireProgress: {
    kind: "flag",
    surface: "def",
    authored: "state",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused if its only pending change is deleting the state's own `file:` — a work-free turn that discards its input without addressing it. A `NOTHING ACTIONABLE` sentinel file is exempt (a legitimately non-actionable round makes no code change). Requires a `file:`.",
  },

  /** The pure engine never reads this — checked at the edge by the answer-completeness guard in `src/step/Guards.ts`, and only when the state also declares `mode: qa`. */
  answerGate: {
    kind: "flag",
    surface: "def",
    authored: "state",
    requires: "file",
    viz: "flag",
    doc: "When true, a step at this state is refused unless every open question in its qa-mode `file:` is answered — exactly one checkbox ticked per question — except a wholly untouched working tree, which passes the gate; any other change, code included, still refuses on unanswered questions. Requires a `file:` and `mode: qa`.",
  },

  /**
   * The pure engine never reads this — checked at the edge by the
   * require-revert guard in `src/step/Guards.ts`, which re-establishes the
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
