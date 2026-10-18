# 02 — Prune the done `15386cd` review note

Chore. Merged concern B (concern 5) of `.gtd/ARCHITECTURE.md`. Declares no
tests.

## Requirements

### 5. Prune the done review note from `.gtd/TODO.md`

- **The `15386cd` note is done**: `docs/driver.md` already offers
  `GTD_SHIP_MODE=commits` only for a merged or closed lower slice, names a
  renamed branch for the top, and describes the commits-mode retarget
- Delete the `## Deferred review notes (15386cd)` section
- **Keep `836985b`, `daed27f` and `eda53bb` sections verbatim** — the sketch's
  deletion of them was scratch, not intent
- No sketch paragraph remains to drop

## Tasks

### Task 1: Delete the `15386cd` section

Paths: `.gtd/TODO.md`

- [ ] `## Deferred review notes (15386cd)` heading and its note gone
- [ ] `836985b`, `daed27f`, `eda53bb` sections byte-identical to before
- [ ] File stays an oxfmt fixed point (`format:check` clean)
