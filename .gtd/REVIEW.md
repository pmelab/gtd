# Review: 76a936a

<!-- base: 9ccfb6ea90b83677edf0110db3de0f2a36bf2acb -->

Fixes #373: the declared-tests guard now names a sanctioned way out for each
refusal, the `(unchanged)` marker parses leniently, and a package with no
`## Tests` that only does out-of-tree work closes on `.gtd/SATISFIED.md`. **No
defects found**; the two touched unit files pass.

## Scenarios

- [ ] ./tests/integration/features/declared-tests.feature#192-208 — **deleting a
      test marked `(unchanged)` is refused with a "restore" instruction, and the
      refusal never says "satisfied"**
- [ ] ./tests/integration/features/declared-tests.feature#257-280 — **a package
      with no `## Tests` section lands its build on `.gtd/SATISFIED.md` alone**,
      then passes health check and closing into the quality reviews — no
      empty-attempt stall

## Lenient `(unchanged)` marker parsing

The marker used to need exactly one space and lowercase. Now any run of
spaces/tabs, any case, ending at whitespace or end of line, counts. CRLF and
lone CR normalise to LF first. The oxfmt-wrap rejoin uses `[ \t]`, not `\s`, so
it **never joins a marker across a blank line**.

- [ ] ./src/workflows/feature/packages.ts#22-43 — `TEST_LINE` captures the whole
      tail; `MARKER` decides `unchanged` `(unchanged)` glued to the backtick
      (`i.test.ts`) still reads as unmarked; a lowercase-only `unit|e2e` level
      stays strict (`Unit:` is ignored)
- [ ] ./src/workflows/feature/packages.test.ts#41-81 — pins tabs, multiple
      spaces, mixed case, no-space rejection, CRLF/CR equality and the
      blank-line gap

## Refusal sorts into write / restore / missing

The refusal headline drops "not satisfied — write them first" for "left unmet".
A **marked test the diff deleted** gets its own "restore them" group. An
unmarked deleted test stays under "write them", or under "missing" once
`SATISFIED.md` exists.

- [ ] ./src/workflows/feature/packages.ts#54-78 — new `deletedMarked` bucket;
      group order write → restore → missing
- [ ] ./src/workflows/feature/packages.test.ts#127-240 — `run` helper takes
      tree, extra changes and a `satisfied` flag; four new cases pin each
      bucket, the ordering, and the absence of "satisfied"

## Builder prompt: three flat SATISFIED.md rules

The one long paragraph becomes three bold-led cases: everything already met in
the tree, no `## Tests` with out-of-tree work (dedupe via `gh` first), and
everything else, which implements normally and **writes no `SATISFIED.md`**.

- [ ] ./src/workflows/shared/text.ts#418-429 — prompt reworded; the evidence
      kinds and the already-done check are unchanged
- [ ] ./src/workflows/shared/text.test.ts#1287-1302 — assertions follow the new
      wording and pin each of the three rules
