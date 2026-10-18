# Review: 6b47a88

<!-- base: e1ffa35e4adb619cd0f976e7cbe395d3b03f0d72 -->

**Test only: the `turn = "fix"` default on `requireDeclaredTests` is now
pinned.** You overrode last round's note, so production code is unchanged and
nothing is breaking. Checked by mutation: flipping the default to `"build"`
fails both new cases. No risks found.

## Pin the fix-turn default

The `run` helper gains a `"default"` mode that calls the guard with two
arguments. The new test proves a two-argument call acts as the fix turn.

- [ ] ./src/workflows/feature/packages.test.ts#159-202 — `run`'s `turn` widened
      to `"build" | "fix" | "default"`, still defaulting to `"build"`;
      `"default"` makes a real two-argument call instead of passing `undefined`,
      which `run`'s own default would swallow. Existing callers unchanged.
- [ ] ./src/workflows/feature/packages.test.ts#315-322 — **a call without `turn`
      accepts a modified and an added `(unchanged)` test; the build turn refuses
      the same input in the same case**, so the test fails if the default ever
      flips.
