# Review: 0ef1c31

<!-- base: 8d5defb41ddbf4ec3927018eecf09a893653a028 -->

**This round closes the reverse gap from the last review: a commit footer under
a title with no `!` now fails. It also anchors the title's `!` match and states
the both-or-neither rule in both agent prompts.** No new risk found.
`tests/tooling/commits.test.ts` passes locally: **31/31**.

## PR check: both-or-neither for title and footer

**The title check now runs both ways.** A `!` title with no footer fails, as
before. **A footer with no `!` title now fails too.** The `!` match is a regex
anchored at the type prefix, so **a `!:` later in the title no longer counts as
breaking**.

- [ ] ./.github/workflows/commits.yml#36-46 — one
      `git log --no-merges --format=%B` over the range sets `carries`. The old
      per-commit loop is gone. `bang` is the bash version of
      `commitlint.config.mjs`'s `bangHeader` (`\w` spelled `[A-Za-z0-9_]`). The
      step uses GitHub's default shell, `bash -e` without pipefail, so `grep -q`
      closing the pipe early cannot flip `carries` off. **If anyone adds
      `shell: bash` (which turns on pipefail), a SIGPIPE from `git log` can
      silently drop a found footer.**
- [ ] ./tests/tooling/commits.test.ts#52-59 — `check` now wraps `checkTitle`
      with the fixed title `"feat: a title"`. `checkTitle` no longer adds a
      `feat: fine` commit when given no messages, so callers pass their own.
- [ ] ./tests/tooling/commits.test.ts#62-66 — the passing case includes a footer
      commit, so its title gains `!`. Without it the new reverse rule fails the
      case.
- [ ] ./tests/tooling/commits.test.ts#118-132 — existing cases are adapted: the
      title case now supplies its own commit, and the footer commit moves first
      in the list. Neither changes what the case asserts.
- [ ] ./tests/tooling/commits.test.ts#140-150 — two new cases: a footer under a
      plain title fails with "title has no", and `` `!:` `` in the middle of a
      title passes.

## Convention doc

**`docs/commits.md` states the reverse rule and that the 72-char limit applies
before GitHub's ` (#N)` suffix.**

- [ ] ./docs/commits.md#10-20 — prose only. The pinned string
      `at most 72 characters` is unchanged, so the doc-pin test still matches.

## Agent prompts state the rule

**Both closing-message prompts now require `!` and
`BREAKING CHANGE: <how to migrate>` together, and list the type set.** A new
test pins this.

- [ ] ./src/workflows/text.ts#867-878 — this replaces the old "`!` alone is not
      enough" note with "both or neither". It adds a subject-format bullet with
      the 9 types and the 72-char limit.
- [ ] ./claude/hooks/ship.ts#64-67 — squash prompt: a `!` subject needs the
      footer.
- [ ] ./claude/hooks/ship.ts#301-304 — PR prompt: a `!` title needs the footer
      line in the description. Line 304 now goes past the prompt's line width
      (cosmetic only).
- [ ] ./tests/tooling/commits.test.ts#161-170 — pins both prompt files to the
      config's `type-enum` and the literal footer placeholder. **The type check
      is weak: `toContain("ci")` / `"fix"` / `"test"` matches anywhere in large
      files, so dropping a type from the prompt prose would not fail it.** Only
      the footer string check has real power.

## Release bump cases and cache inputs

**More semantic-release cases, including a real GitHub squash body. The tooling
task cache now also keys on `package-lock.json`.**

- [ ] ./tests/tooling/commits.test.ts#238-240 — `fix` → patch, `docs` → no
      release, and a `(#12)` squash with a `* feat!:` body footer → 2.0.0. This
      proves the footer cuts a major from inside the squash body.
- [ ] ./turbo.json#86-88 — adds `package-lock.json` to the inputs, so a
      commitlint or semantic-release version bump no longer reuses a stale
      cached pass.
