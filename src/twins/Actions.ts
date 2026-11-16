import { AdapterError, type Action, type ActionsAdapter } from "../workspace/index.js"
import type { ActionsHarness } from "../workspace-testkit/index.js"

export interface InMemoryActions {
  readonly adapter: ActionsAdapter
  /** Every worktree offers these actions from now on. */
  readonly offer: (actions: readonly Action[]) => void
}

/**
 * The actions adapter's twin. An action's argv is its id, then each value in
 * field order: a flag that is on as `--<name>`, any other as `--<name>=<value>`.
 */
export const inMemoryActions = (initial: readonly Action[] = []): InMemoryActions => {
  let offered = initial
  return {
    adapter: {
      list: async () => offered,
      argv: async (_worktree, id, values) => {
        const action = offered.find((a) => a.id === id)
        if (action === undefined) {
          throw new AdapterError({ adapter: "actions", op: "argv", message: `no action ${id}` })
        }
        return [
          id,
          ...action.fields.flatMap(({ name }) => {
            const value = values[name]
            if (value === undefined) return []
            return value === true ? [`--${name}`] : [`--${name}=${value}`]
          }),
        ]
      },
    },
    offer: (actions) => void (offered = actions),
  }
}

/** The contract kit's harness for the twin: it reads its own argv back. */
export const inMemoryActionsHarness: ActionsHarness = {
  setup: async () => {
    const twin = inMemoryActions([
      {
        id: "start:contract",
        label: "Contract",
        status: "idle",
        fields: [
          { name: "note", type: "text", required: true, help: "What to note" },
          { name: "title", type: "text", required: false },
          { name: "mode", type: "select", required: false, choices: ["fast", "slow"] },
          { name: "dry", type: "flag", required: false, help: "Change nothing" },
        ],
      },
    ])
    return {
      adapter: twin.adapter,
      worktree: "/workspace/demo",
      id: "start:contract",
      received: async (argv) => {
        const given = new Map<string, string | true>()
        for (const arg of argv.slice(1)) {
          const [, name, value] = /^--([^=]+)(?:=([\s\S]*))?$/.exec(arg) ?? []
          if (name !== undefined) given.set(name, value ?? true)
        }
        const text = (name: string): string | undefined => {
          const value = given.get(name)
          return typeof value === "string" ? value : undefined
        }
        return {
          note: text("note"),
          title: text("title"),
          mode: text("mode"),
          dry: given.get("dry") === true,
        }
      },
      dispose: async () => {},
    }
  },
}
