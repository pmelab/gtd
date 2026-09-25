# Single-quote the bundled `each:` item interpolation, and document the rule

## Requirement

A package filename can execute shell code (Greptile P1, security).

`packages.scoping` and `packages.closing` in `src/workflows/unified.yaml` both
render `pkg="<%= it.item %>"`. `it.item` comes from the working-tree glob
`.gtd/packages/*.md`, unfiltered. Double quotes stop word-splitting; they do not
stop `$(...)`, a backtick, or `$var`. A file named
`.gtd/packages/01-$(touch marker).md` runs its own name.

Shell safety is the workflow author's job, not the engine's — so fix only these
two call sites and leave `each:` itself alone. No snapshot-time filtering, no
render-time quoting in `PatternTemplates.ts`.

Switch both to single quotes: `pkg='<%= it.item %>'`. Single quotes disable
`$(...)`, backticks and `$var` outright, and the only break-out character — a
literal `'` — can never reach the rendered script, because Eta's default
autoescape already turns it into `&#39;`. Verified against this repo's own Eta
instance: `.gtd/packages/01-$(touch marker)'x".md` renders as
`pkg='.gtd/packages/01-$(touch marker)&#39;x&quot;.md'`, inert.

Known limit of that fix, and it is acceptable: a package filename containing
`'`, `"` or `&` renders mangled into HTML entities, so `[ -f "$pkg" ]` misses it
and `closing`'s `rm -f "$pkg"` silently removes nothing. That mangling already
exists today under double quotes — single-quoting neither creates nor worsens
it, and no package file gtd itself writes has ever carried one of those
characters. Do not add a guard for it.

`docs/` must state the rule this answer settles: an `each:` item value is
untrusted text, and a `script:` that interpolates one is responsible for quoting
it. Per `AGENTS.md` that belongs in user-facing docs (what the driver protocol
and workflow authoring accept) — never a description of how the engine renders
it.

## Tasks

### Switch both bundled call sites to single quotes

Paths: `src/workflows/unified.yaml` (the `packages.scoping` and
`packages.closing` states, around lines 1710 and 1907).

- [ ] Both states render `pkg='<%= it.item %>'`
- [ ] `grep -n 'pkg="' src/workflows/unified.yaml` returns nothing
- [ ] `src/PatternTemplates.ts` is unchanged — no render-time quoting added
- [ ] No snapshot-time filtering of glob matches added anywhere
- [ ] No guard added for a filename containing `'`, `"` or `&`; the mangling
      limit stands as-is
- [ ] `npm test` passes, including `src/workflows/templates.test.ts`

### Document that an `each:` item value is untrusted text

Paths: `docs/configuration.md` (the `it.item` bullet, around line 214).

- [ ] The `it.item` bullet states that an item value is untrusted text and a
      `script:` interpolating one must quote it itself
- [ ] The wording tells a workflow author what to do; it names no `src/*.ts`
      module, internal function, or private type, and does not describe how the
      renderer escapes
- [ ] No `turbo.json` edit — `docs/**` is already declared in `test:unit`'s and
      both e2e tasks' `inputs`
- [ ] `npm test` passes, including `format:check` over the edited doc

### Scenario: a package filename carrying `$(...)` never executes

Paths: a cucumber feature under `tests/integration/features/`.

- [ ] A scenario creates a package file whose literal name contains
      `$(touch marker)`, written out in the scenario text — not hidden behind an
      abstract step name
- [ ] The scenario drives the bundled `packages` loop far enough to render the
      `scoping` (and `closing`) script
- [ ] The scenario asserts no `marker` file exists afterwards
- [ ] Setup uses composable, generic `Given` steps with real file content in the
      scenario text; step logic is inlined into step definitions, not chained
      through helpers
- [ ] The scenario fails when both call sites are reverted to
      `pkg="<%= it.item %>"`
- [ ] No new `npm test` task is added, so `turbo.json` is untouched and
      `tests/tooling/turbo.test.ts` still passes
