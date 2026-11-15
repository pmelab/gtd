import {
  isAdapterFailure,
  type Action,
  type ActionField,
  type ActionsAdapter,
  type ActionValues,
} from "../workspace/index.js"
import type { ContractCase } from "./index.js"

/** What the contract action got, as its own command saw it. */
export interface ActionSight {
  readonly note: string | undefined
  readonly title: string | undefined
  readonly mode: string | undefined
  readonly dry: boolean
}

/**
 * A worktree with one start action, `id`, whose fields are, in this order:
 * - `note`: text, required, help "What to note"
 * - `title`: text, optional
 * - `mode`: select of `fast` and `slow`, optional
 * - `dry`: flag, help "Change nothing"
 */
export interface ActionsFixture {
  readonly adapter: ActionsAdapter
  readonly worktree: string
  /** The contract action's id. */
  readonly id: string
  /** Runs `argv` in the worktree, without a shell, and reports what the action got. */
  readonly received: (argv: readonly string[]) => Promise<ActionSight>
  readonly dispose: () => Promise<void>
}

export interface ActionsHarness {
  readonly setup: () => Promise<ActionsFixture>
}

const fail = (message: string): never => {
  throw new Error(message)
}

const withFixture =
  (harness: ActionsHarness, body: (fixture: ActionsFixture) => Promise<void>) =>
  async (): Promise<void> => {
    const fixture = await harness.setup()
    try {
      await body(fixture)
    } finally {
      await fixture.dispose()
    }
  }

const EXPECTED_FIELDS: readonly ActionField[] = [
  { name: "note", type: "text", required: true, help: "What to note" },
  { name: "title", type: "text", required: false },
  { name: "mode", type: "select", required: false, choices: ["fast", "slow"] },
  { name: "dry", type: "flag", required: false, help: "Change nothing" },
]

const fieldShape = (field: ActionField): ActionField => ({
  name: field.name,
  type: field.type,
  required: field.required,
  ...(field.choices === undefined ? {} : { choices: [...field.choices] }),
  ...(field.help === undefined ? {} : { help: field.help }),
})

// Each one would change on its way through a shell, or be read as an option.
const HOSTILE_VALUES = [
  "two words",
  "$HOME",
  "$(touch pwned)",
  "it's",
  '"quoted"',
  "`id`",
  "a;b|c&",
  "--dry",
  "-x",
  "x=y",
  "*",
  "line\nbreak",
]

const sees = async (
  fixture: ActionsFixture,
  values: ActionValues,
  expected: ActionSight,
): Promise<void> => {
  const argv = await fixture.adapter.argv(fixture.worktree, fixture.id, values)
  if (argv.length === 0 || argv.some((a) => typeof a !== "string")) {
    fail(`argv() returned ${JSON.stringify(argv)}, not a command line`)
  }
  const sight = await fixture.received(argv)
  if (JSON.stringify(sight) !== JSON.stringify(expected)) {
    fail(
      `for ${JSON.stringify(values)} the action got ${JSON.stringify(sight)}, not ${JSON.stringify(expected)}`,
    )
  }
}

/** The cases every actions adapter passes, bundled or userland. */
export const actionsContract = (harness: ActionsHarness): readonly ContractCase[] => [
  {
    name: "list() reports the action with its fields",
    run: withFixture(harness, async (fixture) => {
      const actions = await fixture.adapter.list(fixture.worktree)
      const action: Action =
        actions.find((a) => a.id === fixture.id) ??
        fail(`list() has no action ${JSON.stringify(fixture.id)}`)
      if (action.status !== "idle") fail(`the start action is for ${JSON.stringify(action.status)}`)
      if (typeof action.label !== "string" || action.label === "") fail("the action has no label")
      const fields = action.fields.map(fieldShape)
      if (JSON.stringify(fields) !== JSON.stringify(EXPECTED_FIELDS)) {
        fail(`the fields are ${JSON.stringify(fields)}`)
      }
    }),
  },
  {
    name: "each value reaches the action unchanged, never through a shell",
    run: withFixture(harness, async (fixture) => {
      for (const value of HOSTILE_VALUES) {
        for (const name of ["note", "title"]) {
          const values = { note: "n", [name]: value, mode: "slow" }
          const expected = { note: "n", title: undefined, mode: "slow", dry: false }
          await sees(fixture, values, { ...expected, [name]: value }).catch(
            async (error: unknown) => {
              // An adapter may refuse a value that its tool would read as an
              // option, with an adapter error, but never change it.
              if (!value.startsWith("-")) throw error
              const refused = await fixture.adapter.argv(fixture.worktree, fixture.id, values).then(
                () => false,
                (failure: unknown) => isAdapterFailure(failure),
              )
              if (!refused) throw error
            },
          )
        }
      }
    }),
  },
  {
    name: "a flag that is on reaches the action, and empty fields stay empty",
    run: withFixture(harness, async (fixture) => {
      await sees(
        fixture,
        { note: "n", dry: true },
        { note: "n", title: undefined, mode: undefined, dry: true },
      )
      await sees(
        fixture,
        { note: "n" },
        { note: "n", title: undefined, mode: undefined, dry: false },
      )
    }),
  },
  {
    name: "argv() of an unknown action fails with the adapter error shape",
    run: withFixture(harness, async (fixture) => {
      const failure = await fixture.adapter.argv(fixture.worktree, "no-such-action", {}).then(
        () => fail("argv() of an unknown action resolved"),
        (error: unknown) => error,
      )
      if (!isAdapterFailure(failure)) {
        fail(`it failed with ${String(failure)}, not { adapter, op, message, detail }`)
      }
      const { adapter, op } = failure as { adapter: string; op: string }
      if (adapter !== "actions" || op !== "argv") {
        fail(`it failed as { adapter: "${adapter}", op: "${op}" }, not actions/argv`)
      }
    }),
  },
]
