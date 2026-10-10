# Commit messages

Every commit that reaches `main` is a squash commit, and semantic-release reads
its message to pick the next version. A missing or wrong `!` is permanent once
merged, so get it right when the squash message is written.

The PR check (`.github/workflows/commits.yml`, config `commitlint.config.mjs`)
lints every non-merge commit in a pull request, and the PR title (a multi-commit
PR squashes under it), against this convention. A leftover `gtd(...)` turn
commit fails it, so squash before landing. A `!` title also needs a commit in
the PR carrying the `BREAKING CHANGE:` footer — the squash body is only the
commit messages, so the title cannot supply it — and a commit footer needs a `!`
title, or the squash would cut a major under a plain subject.

## Subject

`type(area): summary` — at most 72 characters (before the ` (#N)` GitHub appends
to a squash subject), imperative mood ("add", not "added"), no trailing period.
`area` names a boundary or unit (`cli`, `replay`, `workflow`, …); it is optional
for repository-wide changes.

| Type       | Releases | Use for                                   |
| ---------- | -------- | ----------------------------------------- |
| `feat`     | minor    | a new user-facing capability              |
| `fix`      | patch    | a bug fix                                 |
| `perf`     | patch    | a performance improvement                 |
| `refactor` | —        | restructuring with no behaviour change    |
| `docs`     | —        | documentation only                        |
| `test`     | —        | tests only                                |
| `build`    | —        | build tooling, dependencies, lint config  |
| `ci`       | —        | GitHub workflows                          |
| `chore`    | —        | anything else that ships nothing to users |

No other type passes the check.

## Breaking changes

A breaking change puts `!` before the colon AND carries a footer that says how
to migrate:

```
feat(cli)!: rename --json to --format json

BREAKING CHANGE: replace `--json` with `--format json` in scripts.
```

Both or neither — the check rejects one without the other. Spell the footer
exactly `BREAKING CHANGE:`; semantic-release ignores `BREAKING-CHANGE:` and the
`!` alone, so either would merge a breaking change as a minor or no release.

Breaking includes a change to exit codes, `--json` output, the history format,
CLI flags, `.gtdrc` config keys, a bundled workflow step's full name, or the
exported API (`@pmelab/gtd/flows`, `@pmelab/gtd/workflow`).

## Body and trailers

The body explains why — motivation, decisions, trade-offs — not which files
changed. Keep the trailers: `Co-Authored-By`, `Claude-Session`, `Gtd-History`.
