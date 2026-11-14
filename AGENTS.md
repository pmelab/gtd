## Documentation

**The code is the source of truth. Documentation exists only to tell a USER
something the code cannot**: how to install and run gtd, and what its commands,
flags, config keys and driver protocol accept.

Never write — and never keep — documentation that describes how gtd is BUILT.
When you find one, DELETE it rather than update it. Prose in `docs/`,
`README.md` or this file must not name a `src/*.ts` module, an internal
function, or a private type. A non-obvious constraint belongs in a TEST, or in a
short comment at the code it constrains.

Two exceptions:

- `GLOSSARY.md` is the domain language, including the words to avoid. Read it
  before naming anything, and keep architecture out of it.
- `docs/adr/` records THAT a hard-to-reverse decision was made and WHY. Read the
  ADRs before reversing one of those decisions.

Some docs are executed or pinned by tests (`*-doc.feature`, the help output in
`docs/cli.md`). When one of those tests fails, the doc it reads changed.

## Commit messages

Squash commits, PR titles and gtd's closing message follow
[docs/commits.md](docs/commits.md). Whether a change is breaking (`!`) is
decided by the tiers in [COMPATIBILITY.md](COMPATIBILITY.md).

## Testing

- Never run `npm run test:mutation` on your own initiative. It takes 10+ minutes
  and is a deliberate user action.
- Never run a process in the background when you need its output (a test run, an
  eval, a build). Run it in the foreground and wait.
- Each new feature gets cucumber scenarios tagged `@inmem`. `@live` is only for
  what a real process alone shows — a signal's exit status, a real shell, the
  bundled binary's wiring — never for logic. See ADR 0008.
- Given steps are small, generic and composable, and show the actual file
  content in the scenario text. Put setup logic in the step definition, not in
  chained helpers.
- `npm test` caches each task by the files it reads. A task that reads
  repository files only through git must declare them in its `input`, or it
  caches a stale green.

## Manual testing

To test a change by hand, follow the `run-gtd` project skill,
[.claude/skills/run-gtd/SKILL.md](.claude/skills/run-gtd/SKILL.md), rules first.

## Comments

Keep a comment only where it explains an important decision or unclear code, and
keep it as short as the fact allows. Delete restatements of the code, history,
and any "what" without a "why". Machine-read lines (lint pragmas,
`shellcheck disable=`, shebangs) stay.
