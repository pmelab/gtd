# 05 — Upgrade note names 27.5.0 (chore)

**Concern 7 — chore, no tests.**

## Requirements

### 7. Upgrade note covers processes from 27.5.0 on

- **`docs/configuration.md` Upgrading note: "a `GTD_FLAG_NAIVE_PASS` process
  from 27.5.0 or later" replaces "from any 28.x release".**
- **PR 390 body's `BREAKING CHANGE:` footer says "from 27.5.0 or later" in place
  of "from 28.0.0".**

## Tasks

### Task 1: Docs

Paths: `docs/configuration.md`

- [ ] **Upgrading** migration (near "two migrations") reads "a
      `GTD_FLAG_NAIVE_PASS` process from 27.5.0 or later"; no other wording
      changed

### Task 2: PR body

- [ ] `gh pr edit 390` — `BREAKING CHANGE:` footer says "from 27.5.0 or later"
      in place of "from 28.0.0"; rest of the body unchanged
