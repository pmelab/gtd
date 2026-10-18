# 01 — Scope SDLC.md's flag-gated trailer line (chore)

Chore package: docs-only, declares no tests. Existing
`tests/tooling/sdlc-doc.test.ts` and `format:check` guard the file.

## Requirements

- **1. Settle the #355 trailer gap (PRODUCT):** scope #355's "trailers for every
  gate" acceptance to default-flag gates. Flag-gated gates (`seam.judge`, risk
  tier) leave trailers only when their flag is on; SDLC.md states this as a
  plain scope, not a known gap. #371 closes when this branch merges. Risk-tier
  gate stays never dogfooded — accepted, no tracking issue. Do not cite the #384
  naive-pass run as a `seam.judge` record.
- **2. Reword SDLC.md's #371 line (TECHNICAL):** rewrite `SDLC.md` lines 77-78
  as a scope statement naming `GTD_FLAG_NAIVE_PASS` / `GTD_FLAG_RISK_TIER`; drop
  `(#371)`; name no `src/*.ts` module; stay an oxfmt fixed point.
- **3. Close #371 from the merge:** squash message closes the issue.

## Tasks

### Task 1: Replace the #371 known-gap line

Paths: `SDLC.md`

Replace

```
**A default setup records no `seam.judge` judgment or `Gtd-Mark: risk-tier`
trailers (#371).**
```

with a bold scope statement, e.g.

```
**`seam.judge` judgments appear only with `GTD_FLAG_NAIVE_PASS` on, and
`Gtd-Mark: risk-tier` trailers only with `GTD_FLAG_RISK_TIER` and
`GTD_FLAG_NAIVE_PASS` on; a default setup records neither.**
```

- [ ] Old line (incl. `(#371)`) gone from `SDLC.md`
- [ ] New line names `GTD_FLAG_NAIVE_PASS` for `seam.judge` and both
      `GTD_FLAG_RISK_TIER` and `GTD_FLAG_NAIVE_PASS` for risk tier
- [ ] New line says a default setup records neither
- [ ] No `#371`, no `src/*.ts` name, no "known gap" wording
- [ ] No other file changes: README.md, flag defaults (`defaultOn`), repo config
      untouched
- [ ] `npx oxfmt --check SDLC.md` (or `npm run format:check`) passes
- [ ] `tests/tooling/sdlc-doc.test.ts` passes

### Task 2: Squash commit message

Paths: none (merge metadata)

- [ ] Type `docs:` per `docs/commits.md`, e.g.
      `docs(sdlc): scope flag-gated gate trailers to their flags`
- [ ] Not breaking: no `!`, no `BREAKING CHANGE` footer
- [ ] Body carries `Closes #371`
