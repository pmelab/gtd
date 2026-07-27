import { Schema } from "effect"

/**
 * v3's `.gtdrc` config shape: three blessed top-level keys — `workflow:` (the
 * whole machine definition, compiled by `./PatternConfig.js`), `vars:` (a
 * flat `name -> scalar` map, one of the three layers merged into every
 * template's `it.vars` — see `./Config.js`'s `toOperations` and
 * `./Edge.js`'s `resolveVars`), and `modes:` (steering-file modes layered over
 * the active workflow's own `modes:` and gtd's built-in validators, so a
 * project can plug its formatter into the BUNDLED default without re-declaring
 * the workflow). There are no other blessed config keys (see `./Config.js`'s
 * module docstring for why).
 *
 * All three keys decode as `Schema.Unknown`: the shape is validated structurally
 * by the workflow compiler (`src/PatternConfig.ts`), not by effect/schema —
 * the shape is deep and recursive, and the compiler's errors carry rule
 * coordinates a flat schema error cannot. The `jsonSchema` ANNOTATIONS below
 * exist for one consumer only: `scripts/generate-schema.ts`, which publishes
 * `schema.json` for editor-side autocompletion/validation
 * (yaml-language-server et al). They describe the same shape the compiler
 * enforces, minus the rules JSON Schema cannot express (exactly one content
 * kind per state, exactly one `initial: true` across the workflow, `on`/
 * `retry.otherwise` targets naming defined states, reachability) — the
 * compiler stays the source of truth; the annotation is the editor's first
 * net, never a second validator to keep behaviorally in sync. When the
 * compiler's accepted shape changes (a new state key, a new content kind),
 * update the annotation here alongside `src/PatternConfig.ts`'s
 * `KNOWN_STATE_KEYS`.
 *
 * Kept in its own module, separate from `./Config.js`, so `scripts/generate-
 * schema.ts` (run via `jiti`, a plain TS-via-Babel loader with no bundler-
 * style pluggable per-extension loaders) can import JUST the schema without
 * risking a transitive pull into the bundled workflow templates
 * (`./workflows/templates.js`, which imports `simple.yaml`/`advanced.yaml` as
 * raw text via tsdown's/vitest's `.yaml`-as-text loader — something `jiti` has
 * no equivalent for and doesn't need here): the schema shape never depends on
 * any workflow's content.
 */

/** The `vars:` shape (top-level AND inside `workflow:`): a flat name -> scalar map (`compileVarsMap` coerces every scalar to a string). */
const varsJsonSchema = {
  type: "object",
  description:
    "Flat name -> scalar map merged into every template's it.vars. Scalars are coerced to strings.",
  additionalProperties: { type: ["string", "number", "boolean"] },
} as const

/** The `modes:` shape (top-level AND inside `workflow:`): mode name -> its format/validate shell commands (`compileModesMap`). */
const modesJsonSchema = {
  type: "object",
  description:
    "Steering-file modes a state's mode: may name. Each entry declares at least one of format/validate: shell commands (Eta templates seeing it.file = the rendered steering-file path) gtd runs via bash. format rewrites the file in place; validate exits 0 when valid, non-zero with findings on stdout/stderr otherwise. The halves layer independently, so naming a built-in mode (qa/review) and declaring only format: adds formatting while keeping gtd's own validation. gtd ships no formatter — bring your own (prettier, dprint, a script).",
  additionalProperties: {
    type: "object",
    description: "One mode: at least one of format/validate.",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      format: {
        type: "string",
        description:
          "Shell command that rewrites the steering file in place before validation (Eta template; it.file is the file path). A non-zero exit is a hard error.",
      },
      validate: {
        type: "string",
        description:
          "Shell command that validates the steering file (Eta template; it.file is the file path). Exit 0 = valid; non-zero = invalid, with its output reported as the findings.",
      },
    },
  },
} as const

/** One state's shape — mirrors `PatternConfig.ts`'s `KNOWN_STATE_KEYS` and per-field compilers. */
const stateJsonSchema = {
  type: "object",
  description:
    "One workflow state. Declare exactly one content kind (script/prompt/message/commit). A commit state is final: no actor, no on.",
  additionalProperties: false,
  properties: {
    actor: {
      type: "string",
      description:
        "Who acts at this state. Required on every non-commit state; forbidden on a commit state.",
    },
    script: {
      type: "string",
      description:
        "Content kind: a shell script (Eta template). The loop driver executes it verbatim via bash, then steps this state's actor.",
    },
    prompt: {
      type: "string",
      description: "Content kind: an agent prompt (Eta template), emitted by `gtd next`.",
    },
    message: {
      type: "string",
      description: "Content kind: a human-facing message (Eta template), emitted by `gtd next`.",
    },
    commit: {
      type: "string",
      description:
        "Content kind: entering this state ends the process by squashing it into one commit with this message (Eta template). Final — no actor, no on.",
    },
    on: {
      type: "object",
      description:
        'Ordered map of change pattern -> target state. Patterns: "C" (clean tree) or "<A|M|D|*> <glob>" over the pending diff; first declared match wins. Every target must name a defined state, and every non-initial state must be reachable through these edges (or a retry.otherwise). A value is either the target state name (string) or a { to, describe } object whose describe is a human-readable sentence templates can surface as it.edges (e.g. in a human gate\'s message).',
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
            },
          },
        ],
      },
    },
    initial: {
      type: "boolean",
      description:
        "Exactly one state in the workflow must declare initial: true (and it must not be a commit state).",
    },
    retry: {
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
    },
    model: {
      type: "string",
      description:
        'Opaque harness hint passed through `gtd next --json`/`gtd status --json` (e.g. "smart"). Never interpreted by gtd. Forbidden on a commit state.',
    },
    memory: {
      type: "string",
      description:
        'Opaque memory-scope label passed through `gtd next --json`/`gtd status --json` (e.g. "plan"). A memory-aware driver retains an agent\'s memory across consecutive agent turns sharing this label and starts fresh when it changes. Never interpreted by gtd. Forbidden on a commit state.',
    },
    file: {
      type: "string",
      description:
        "The state's steering file: an Eta template naming the file a human/editor should look at while the machine rests here. Forbidden on a commit state.",
    },
    mode: {
      type: "string",
      description:
        "The steering file's format: the name of a built-in mode (qa/review, validated in-process by gtd) or of a `modes:` entry. gtd formats and validates the file with that mode before capturing a turn out of this state, and the LSP dispatches live diagnostics on the built-in names. Requires a sibling `file:`. Forbidden on a commit state.",
    },
    reviewWindow: {
      type: "boolean",
      description:
        "When true, gtd opens a review checkout window while the machine rests here — HEAD/index are rewound to the review base so the whole base..HEAD diff surfaces as uncommitted changes in the editor. Forbidden on a commit state.",
    },
    reviewBase: {
      type: "boolean",
      description:
        "Marks the state whose most-recent in-process commit anchors the review window's diff base; absent any, the base is the process start. Forbidden on a commit state.",
    },
    reviewEntry: {
      type: "boolean",
      description:
        "Marks the (at most one) state `gtd review <commitish>` enters to start a brand new process reviewing <commitish>..HEAD. Forbidden on a commit state and on the initial state.",
    },
  },
} as const

/** The whole `workflow:` value — see `PatternConfig.ts`'s module docstring for the authoritative schema. */
const workflowJsonSchema = {
  type: "object",
  description:
    "The whole machine definition: named states (plus the workflow's own vars: defaults and modes: steering-file modes). Compiled and validated by gtd at load time; content strings starting with ./ or ../ are file references inlined from the config file's directory (a modes: command never is — it is a shell command).",
  additionalProperties: false,
  required: ["states"],
  properties: {
    vars: varsJsonSchema,
    modes: modesJsonSchema,
    states: {
      type: "object",
      description: "The workflow's named states. At least one; exactly one with initial: true.",
      minProperties: 1,
      additionalProperties: stateJsonSchema,
    },
  },
} as const

export const ConfigSchema = Schema.Struct({
  workflow: Schema.optional(Schema.Unknown.annotations({ jsonSchema: workflowJsonSchema })),
  vars: Schema.optional(Schema.Unknown.annotations({ jsonSchema: varsJsonSchema })),
  modes: Schema.optional(Schema.Unknown.annotations({ jsonSchema: modesJsonSchema })),
})

export type DecodedConfig = Schema.Schema.Type<typeof ConfigSchema>
