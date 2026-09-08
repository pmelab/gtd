# Spec feedback — 02 One worktree, one step, one exit

The previous round's six problems are all fixed: the Beat import test now mocks
`existsSync` to false and has a companion test proving the mock isn't a no-op;
`handOff`'s fallback timer is `clearTimeout`ed on `finish`; `CLOSE_PATH` gives
the bare-close path a real exit 0 and the lifecycle scenario asserts it;
`SafePath.ts#resolveWithinRoot` contains `filePath`/`path` in
`Write.ts`/`ReadSteeringFile.ts`/`Diff.ts`; the `driveRefusal`/`already-driving`
client residue is gone; the comments naming deleted modules are gone.
`typecheck`, `deadcode`, `npm test` and `format:check` are green. One problem
remains.

## 1. `resolveFleet` is a dead door in the story/test provider

`src/web/testing/TrpcTestProvider.tsx:55,59,67` still declares a
`resolveFleet?: () => unknown` prop and maps it onto a `fleet` procedure path
that `Router.ts` no longer registers — `fleet` was deleted by this package. Zero
consumers pass it: `grep -rn resolveFleet src/` matches only this file.

Its own JSDoc at `:46-48` asserts the opposite — "a story can render a real
tRPC-backed container (`Fleet`, `Review`, …)" names a component that no longer
exists, and "every existing consumer already uses it" is false for all zero of
them. A reader trusting that comment looks for `Fleet.tsx`.

This is Requirement B's "delete rather than keep dormant — the same code with an
unused door", and it is invisible to `fallow` because an unused React prop is
not an unused export. Drop the prop, the `resolveFleet !== undefined` branch in
the `mockLink(...)` call, and rewrite the JSDoc paragraph to describe only
`resolvers`.
