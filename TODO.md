# Extract the duplicated suite-check script in `unified.yaml`

## Problem

`src/workflows/unified.yaml` carries the SAME "run the suite → FEEDBACK.md" bash
script in **5 source copies**, differing only in a 2-line header comment:

- `submachines.makeGreen.states.check.script` (the shared health check — expands
  to `checking` + `adv-checking`)
- `use[start].with.checkScript` (simple-flow green-baseline gate)
- `use[adv-start].with.checkScript` (advanced-flow gate)
- `use[review-start].with.checkScript` (`gtd review` gate)
- `states.fix-check.script` (`gtd fix` entry)

Every copy's body (from `feedback="..."` down) is byte-identical; only the
`# gtd check turn — run the suite ...` comment varies ("before starting new
work" / "before reviewing" / "to find what needs fixing" / etc.). Changing the
check logic today means editing 5 places in lockstep.

## Approach: one YAML anchor, aliased everywhere

The whole file is parsed with `yaml`'s `parse` (see `templates.ts`
`parseYaml(UNIFIED_WORKFLOW)`), which resolves `&anchor`/`*alias` natively into
byte-identical string values. Anchors are a pure parser feature — the compiled
`WorkflowDefinition` never sees them, `expandSubmachines`/`renderInitConfig`
(which `JSON.stringify`s the parsed tree) simply see the resolved+duplicated
strings. So this keeps everything **inline** (no `./` file refs, bundle-safe)
and needs **zero engine change** — confirmed by spike: an anchored `|` block
scalar aliased twice yields `a === b` true and round-trips through
`JSON.stringify`.

**Decision — anchor at first use, not a dedicated top-level `scripts:` block.**
A `scripts:`/`anchors:` top-level key would trip `compileWorkflowConfig`'s
`unknown top-level key(s)` check (`KNOWN_TOP_KEYS` = `vars`/`states`/`modes`,
after `submachines`/`use` are stripped), forcing an engine + validation + docs
change for cosmetics. Anchoring on the first real use (`makeGreen.states.check`)
costs nothing and needs no new grammar.

**Decision — unify the header comment to one canonical text.** YAML aliases
reproduce a whole node; you cannot share a body but keep 5 different comments.
`makeGreen`'s existing comment is already generic and correct for all 5 sites
(it punts the meaning to each state's own `on` rules, which genuinely differ):

```
# gtd check turn — run the suite; a red run records .gtd/FEEDBACK.md, a
# green run cleans it up. The `on` rules decide what that means.
```

The per-site nuance ("before starting new work", etc.) already lives in each
state's `label:` and human-gate `message:`, so nothing is lost.

**Decision — drop the now-constant `checkScript` param from `assertGreen`.**
Once all three `assertGreen` uses would pass the identical aliased script,
`checkScript` stops earning its keep. Inline `*suiteCheck` directly into
`assertGreen.states.check.script` and delete the `checkScript` param + all three
`with.checkScript:` blocks (~24 lines each). `makeGreen` keeps the anchor;
`assertGreen.check` and `fix-check` become one-line aliases.

## Steps

1. **`src/workflows/unified.yaml`**
   - On `submachines.makeGreen.states.check.script`, add the anchor:
     `script: &suiteCheck |`, keeping makeGreen's current comment as the
     canonical text. Add a one-line note above it that this is the shared
     suite-check aliased by `assertGreen` and `fix-check`.
   - `submachines.assertGreen`: remove `checkScript` from `params:`; change
     `states.check.script: $checkScript` → `script: *suiteCheck`.
   - Delete the `checkScript:` entry from all three `assertGreen` invocations in
     `use:` (`start`, `adv-start`, `review-start`).
   - `states.fix-check.script:` → `*suiteCheck` (replace its inline block).
   - Anchor ordering is satisfied: `makeGreen` precedes `assertGreen`, `use:`,
     and `states:` in the document, so every alias resolves.

2. **`src/workflows/unified.flat.yaml`** (the frozen golden reference —
   `golden.test.ts` deep-equals the two compiled definitions, so both must
   produce the identical script text). Update the header comment of all **6**
   concrete check-suite scripts to the canonical text so they match: the four
   currently-divergent ones at the `start-check`, `adv-start-check`,
   `review-start-check`, and `fix-check` states (the two `makeGreen`-derived
   `checking`/`adv-checking` copies already carry it). Bodies are already
   identical — comment-only edits.

3. **Verify** with `npm test` (runs `format:check`, `typecheck`, `lint`,
   `test:unit`, `test:e2e`). The load-bearing checks:
   - `src/workflows/golden.test.ts` — proves sub-machine form still compiles
     byte-identically to the flat reference (fails loudly if step 2's flat edits
     don't exactly mirror step 1).
   - `src/workflows/templates.test.ts` — `renderInitConfig` still materializes a
     `workflow:` object; `defaultWorkflowDefinition` unchanged.
   - `test:e2e` — the `Given the workflow` features run the materialized config;
     shape (states/labels/`on`/kinds) is unchanged, so they stay green.

## Scope decisions (deliberately out)

- **`review-deciding` / `picking` / `closing` scripts** stay inline — each is
  single-use, so anchoring only relocates, never dedups.
- **The `it.edges.forEach` "What each change does next" message footer** (in
  `idle`, `escalate`, `blocked`, `plan-review`, the two `answer` messages) is
  repeated Eta, but it's `message:` content wrapped differently per state, not a
  `script:`, and can't be aliased piecemeal. Out of scope for "extract scripts".
- **No `STATES.md` §10 change.** Its table describes states by
  label/kind/`on`-edges (all unchanged); it never quotes script comment text.
  Verify the "inline test wrapper" prose still reads correctly — expected yes.
- **No engine, `docs/`, or `skills/loop/SKILL.md` change** — behavior, config
  surface, and the driver contract are all untouched.

## Net effect

~90 lines of duplicated bash removed from `unified.yaml`; the suite-check logic
lives in exactly one place, changed once. No behavioral change (golden test is
the proof).
