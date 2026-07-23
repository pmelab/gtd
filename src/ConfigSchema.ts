import { Schema } from "effect"

/**
 * v3's `.gtdrc` config shape: two blessed top-level keys — `workflow:` (the
 * whole machine definition, compiled by `./PatternConfig.js`) and `vars:` (a
 * flat `name -> scalar` map, one of the three layers merged into every
 * template's `it.vars` — see `./Config.js`'s `toOperations` and
 * `./Edge.js`'s `resolveVars`). There are no other blessed config keys (see
 * `./Config.js`'s module docstring for why).
 *
 * Both keys decode as `Schema.Unknown`: the shape is validated structurally
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
 * pulling in `./Config.js`'s chain to `./workflows/default.js` — which
 * imports `default.yaml` as raw text via tsdown's/vitest's `.yaml`-as-text
 * loader, something `jiti` has no equivalent for and doesn't need here: the
 * schema shape never depends on the bundled default workflow's content.
 */

/** The `vars:` shape (top-level AND inside `workflow:`): a flat name -> scalar map (`compileVarsMap` coerces every scalar to a string). */
const varsJsonSchema = {
  type: "object",
  description:
    "Flat name -> scalar map merged into every template's it.vars. Scalars are coerced to strings.",
  additionalProperties: { type: ["string", "number", "boolean"] },
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
        "Content kind: a shell script (Eta template). `gtd run` executes it verbatim via bash, then steps this state's actor.",
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
        'Ordered map of change pattern -> target state. Patterns: "C" (clean tree) or "<A|M|D|*> <glob>" over the pending diff; first declared match wins. Every target must name a defined state, and every non-initial state must be reachable through these edges (or a retry.otherwise).',
      additionalProperties: { type: "string" },
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
      enum: ["qa", "review"],
      description:
        "The steering file's format, dispatched on by the LSP. Requires a sibling `file:`. Forbidden on a commit state.",
    },
  },
} as const

/** The whole `workflow:` value — see `PatternConfig.ts`'s module docstring for the authoritative schema. */
const workflowJsonSchema = {
  type: "object",
  description:
    "The whole machine definition: named states (plus the workflow's own vars: defaults). Compiled and validated by gtd at load time; content strings starting with ./ or ../ are file references inlined from the config file's directory.",
  additionalProperties: false,
  required: ["states"],
  properties: {
    vars: varsJsonSchema,
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
})

export type DecodedConfig = Schema.Schema.Type<typeof ConfigSchema>
