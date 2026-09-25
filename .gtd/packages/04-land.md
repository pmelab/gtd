# Document the `each:` entry restriction the loader now enforces

## Requirement A — the new load error must be documented where a workflow author reads

`PatternMachine` now refuses a workflow at LOAD time when a reachability root
resolves inside an `each:` reference's subtree. Two classes fail, with two
distinct messages:

- `entries.default "<state>" is inside an each: reference — a process may not start inside a loop`
- `entries.manual "<state>" is inside an each: reference — a process may not be entered inside a loop`

`docs/configuration.md` documents both halves of this — `entry: true` in the
state key list, and `each:` on a looping reference — and neither mentions the
restriction. The `entry: true` line is actively wrong as written: it promises
the state is "enterable via `gtd --entry <this state's qualified name>`", which
is no longer true inside a loop.

A previously-valid workflow now fails to load. An author who hits either message
needs the docs to tell them what to change, not only that something broke.

## Tasks

### State the restriction on both doc surfaces it touches

Paths: `docs/configuration.md`.

- [ ] The `entry: true` line in the state key list says a state inside an
      `each:` reference's subtree may not carry it
- [ ] The `each:` prose says a reachability root may not resolve inside the
      loop's subtree, naming both `entries.default` and `entries.manual`
- [ ] The prose tells an affected author the fix — move the root to a state
      outside the loop, or drop `entry: true` from the looped state
- [ ] No prose added here names a `src/*.ts` module, an internal function, or a
      private type

### Reflect the restriction in the README

Paths: `README.md`.

- [ ] Wherever the README describes entering a workflow or declaring a loop, it
      does not contradict the new restriction
- [ ] Any change stays user-facing — what the author writes and what the loader
      accepts, never how the check is implemented
