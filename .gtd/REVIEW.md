# Review: f8df6e9

<!-- base: 5287887c541092b088a1e3f169ff5225001aff66 -->

## Silent failures never collapse

`npm test` collapsed two flag states whose failing task printed nothing of its
own: the signature held only turbo's cache line and npm's two `> ` script
echoes, which normalise to the same text in every state. Now the signature drops
that preamble; a signature with no real line left is empty, and an empty
signature is never collapsed, so the state prints in full.

- [ ] ./scripts/test-states.ts#65-67 — per-task counter of npm echo lines still
      to skip; position-based so a task's own `> ` output survives
- [ ] ./scripts/test-states.ts#75-98 — skips the cache line, the next two `> `
      lines, and blank lines; registers the task block even when all of it is
      boilerplate; returns `""` when no task kept a real line; prefixes each
      task's lines with a `<task>:` header so an extra silently failing task
      still changes the signature. **Blank lines no longer count toward the
      signature** — two logs differing only in blank lines now collapse;
      harmless. **The skip assumes npm prints exactly two echo lines** — an
      `npm --silent` task or a non-npm runner would lose its first two real `> `
      lines; neither is used here today.
- [ ] ./docs/development.md#27-33 — documents that a failing state with only
      turbo/npm preamble is always shown in full

## Tests

- [ ] ./tests/tooling/test-states.test.ts#210-237 — real-turbo setup extracted
      into `realRun(script)` so several scripts share it
- [ ] ./tests/tooling/test-states.test.ts#245-251 — against real turbo: a task
      that prints nothing yields an empty signature; a task printing `> quoted`
      keeps that line. Pins the two-echo assumption to turbo/npm's actual output
- [ ] ./tests/tooling/test-states.test.ts#309-341 — synthetic cases: empty for
      boilerplate-only under all three cache phrasings; `> ` kept after the
      echoes and after a real line; an extra silent task changes the signature;
      a real diagnostic survives and matches across differing hashes
