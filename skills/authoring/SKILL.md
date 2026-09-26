---
name: authoring
description: >-
  Write or edit a gtd workflow (the repository's `gtd.config.ts`). Use when the
  user asks to create a custom gtd workflow, customize or change their
  workflow's shape, add/remove/rename a step, add a gate/phase/review step,
  change what an agent is prompted to do, adjust fix caps, models, or steering
  files, or otherwise change the flow gtd runs.
---

# Authoring a gtd workflow

A gtd workflow is **plain async TypeScript**: a `gtd.config.ts` at the
repository root default-exports `workflow(flow, { vars, summary, base })` from
`@pmelab/gtd/flows`. The **flow** is one async function that awaits **steps**.
Every step is a commit; gtd finds where a process rests by **replaying** the
flow over the episode's commits, so the git history IS the state and nothing is
stored anywhere else.

Your job is to produce or edit that module so it loads cleanly and does what the
user wants. Driving a workflow once it exists is a separate concern — that is
what a driver does.

**Trust:** gtd evaluates `gtd.config.ts` on every command that resolves workflow
state (`gtd next` and `gtd lsp` included). It is code the user's repository
runs; write it with the same care as a build script.

## Golden rule: start from the bundled default, edit incrementally

Do **not** write a workflow from a blank page unless the user wants something
tiny. gtd ships one known-good workflow and runs it when no `gtd.config.ts` is
found. Its source ships in the npm package:

```bash
# local install: node_modules/@pmelab/gtd/src/workflows/
# global install:
ls "$(npm root -g)/@pmelab/gtd/src/workflows/"
# unified.ts — the flow; text.ts — its prompts, messages and scripts; vars.ts — its variable defaults
```

To customize it, copy those three files into the repository — `unified.ts` as
`gtd.config.ts`, the other two beside it (e.g. under `gtd/`) — and rewrite the
imports: `"../flows/index.js"` becomes `"@pmelab/gtd/flows"`, and the relative
imports point at the copied files with a `.ts` extension
(`import * as t from "./gtd/text.ts"`). Then edit.

There is no `extends`/merge: the innermost `gtd.config.ts` walking up from the
current directory is the whole workflow. If one already exists, read it and edit
it in place.

Prefer the **fragments** `@pmelab/gtd/flows` exports over re-implementing them —
`green`, `healthy`, `escalation`, `entryGate`, `questionGate`, `designLoop`,
`specReview`, `packageQueue`, `qualityLap`, `reviewTail`, `noMatch`. Each takes
its texts, caps and callbacks as arguments and never reads `vars`. Their step
names are versioned API; `docs/configuration.md` lists them.

Make one small change, **verify it loads** (see "Verify"), then make the next. A
workflow that fails to load breaks every gtd command in the repository.

## The step API

| Call                                     | Actor   | Rest content | Resolves to                                               |
| ---------------------------------------- | ------- | ------------ | --------------------------------------------------------- |
| `agent(name, prompt, opts?)`             | `agent` | `prompt`     | `void`, once an agent turn landed                         |
| `human(name, opts?)`                     | `human` | `message`    | `void`, once a person landed                              |
| `run(name, body, opts?)`                 | `check` | `script`     | `void`, once the run's tree landed                        |
| `judge(name, question, evidence, opts?)` | `judge` | `message`    | the answer string, or `undefined`                         |
| `judge(name, [q, …], evidence, opts?)`   | `judge` | `message`    | `{ [id]: { answer, p } }` for answers that cleared `minP` |
| `restart(name)`                          | —       | —            | never: ends the episode from any depth                    |

- `run` body: a POSIX `sh` string the driver runs verbatim, or a callback
  `async ({ sh, fs }) => …` that `gtd exec` runs (the beat is a one-line script
  calling `gtd exec`). A throwing callback makes `gtd exec` exit 1; the tree it
  left still lands. **A run's outcome is what it leaves in the tree** — read it
  back with the helpers.
- `judge` questions are
  `{ id, primitive: "noul" | "choice" | "score", instructions, criteria }`. A
  `noul` reads back as `"yes"`/`"no"`. Landing with no verdict gives `undefined`
  — make `undefined` take the conservative branch.
- A person or a driver sees a rest as one of the five content kinds `capture` (a
  dirty tree at a human step), `message`, `script`, `prompt`, `stalled`. Every
  step you add must fit one of them; there is no sixth.

Options (all optional): `label`, `file` (a `.gtd/` path), `mode` (needs `file`;
`qa`, `review`, or a `.gtdrc` `modes:` name), `message` (human/judge), `model`,
`system`, `skills` (agent), `allowEmpty` (agent), `acceptClean` (human),
`requireProgress`, `answerGate`, `requireRevert`, `reviewBase`, `minP` (judge).

Helpers — pure reads of the commit replay stands on (the tree the last step
left, never the live working tree): `exists`, `read`, `glob`,
`changed(glob?)`/`added`/`modified`/`deleted` (what the last step's commit
touched), `sections(path)` (`## ` headings), `tail(path, share)` (bounded by the
`judgeBudgetBytes` var), `history.previous(path, { since })`, `vars`, `refs`
(`start`, `head`, `reviewBase`, `processBase`).

Composition: `scope(prefix, fn)` prefixes step names (`build.fix`) and sets
their **memory scope** (one scope = one agent conversation = one model/system —
mixing personas inside a scope fails the process);
`persona({ model, system }, fn)` sets defaults for agent steps inside;
`refuse(message)` refuses the pending landing; `stepName(name)` returns the
scoped name.

## Names, commits and history

- The step name is the `<to>` in `gtd(<actor>): <from> → <to>`, and every
  landing carries `Gtd-Step: <name>#<n>`. It is also the memory scope key (up to
  the last dot). Rename a step and every process resting on it diverges.
- An episode ends when the flow returns or calls `restart()`; the next starts at
  the flow's first step on an ordinary start — that step is where a finished
  process waits (the bundled one is `human("idle", …)`).
- `gtd --entry <name>` starts a process with the flow's `{ entry }` argument set
  to `<name>` (`undefined` on an ordinary start). Branch on it, and `refuse()`
  names you don't accept; a flow that never reads `entry` accepts none.
  `base: (entry, vars) => commitish | undefined` in the options fixes an entered
  process's diff base. `--var <name>=<value>` only overrides names the
  workflow's `vars` or `.gtdrc` `vars:` declare.

## Landing rules you are designing for

- **Agent turn changed something** → the step completes.
- **Agent turn changed nothing** → an **attempt**: an empty commit, the process
  stays; the next dispatch is a **stall**. Pass `allowEmpty: true` when "nothing
  to change" is a legitimate result (a reviewer approving by writing nothing).
- **Human landing changed nothing** → a no-op, the gate keeps waiting — unless
  `acceptClean: true`, which makes "change nothing" mean "accept as-is".
- **Run landed a clean tree** → the step completes; if replay comes straight
  back to the same step, the landing is **settled** (the driver stops).
- **Nothing the flow branches on explains the turn** → call `refuse(message)`
  (or the `noMatch` fragment): nothing lands, `gtd land` exits 1.

Branch on what the step left, not on who acted:

```ts
await run(
  "check",
  `${vars.testCommand} > .gtd/FEEDBACK.md 2>&1 && rm -f .gtd/FEEDBACK.md`,
)
if (exists(".gtd/FEEDBACK.md")) {
  await agent("fix", "Fix what .gtd/FEEDBACK.md reports, then delete it.", {
    file: ".gtd/FEEDBACK.md",
  })
}
```

Keep `.gtd/` clean across processes: a steering file should be deleted by the
step that consumes it. A workflow that accumulates files in `.gtd/` is almost
certainly a bug.

## Rules for flow code

Flow code is replayed on every command, so it must reach the same steps every
time it sees the same history. `run()` bodies and module top-level code are
exempt. gtd does not read the source ahead of time: breaking a rule shows up
when replay runs, as an error or, for nondeterminism, as a divergence later.

- No IO or nondeterminism in flow code — no clock, randomness, environment,
  network or filesystem. Read the tree through the helpers; do IO inside a
  `run()` body.
- Await only a step, `scope()`, `persona()`, or a function that steps. Anything
  else fails with `the flow awaited something that is not a step`.
- One call site per step name — wrap a reused helper in two different
  `scope()`s.
- No `try`/`catch` around a step: `restart()` and refusals travel as exceptions.
- Only the options a step accepts; an unknown key fails naming the step.
- The default export is a `workflow(...)` call whose flow reaches a step on an
  ordinary start; every `mode` must exist.

## Verify (after every change)

1. **`gtd next`** — loads the workflow (printing every load error at once) and
   shows the resolved rest: step, actor, label, file. It never mutates, so run
   it as often as you like.
2. **A scratch repository** with at least one commit — make the change a step
   expects, run `gtd land --json=script | sh`, then `gtd next` to see where it
   went. A flow is code, so walking it is the only way to see its branches.

`gtd validate` is NOT for this — it validates a **steering file**, not the
workflow.

## Worked example: add an approval gate before building

In the bundled default, `planAndBuild` runs the design phase, the architecture
pass (which writes `.gtd/packages/`), then builds the packages. Add a human
sign-off between the two:

```ts
const planAndBuild = async (): Promise<void> => {
  for (;;) {
    await design()
    await architecturePass()
    await human("approve-plan", {
      message:
        "The packages under .gtd/packages/ are ready. Edit them to adjust the plan, or change nothing — then run `gtd land` to start building.",
      label: "Approve the plan",
      acceptClean: true,
    })
    await packages()
    if ((await buildTail(false)) === "signoff") return
    await reUnwind()
  }
}
```

`acceptClean: true` is what makes an untouched landing approve; without it the
gate would wait for an edit. `approve-plan` sits in the `root` scope and is a
new, unique name. Verify: `gtd next` loads without errors, and in a scratch
repository a landing at `architecture.decompose` (or `architecture-promote`) now
leads to `approve-plan`, and an untouched landing there to `packages.picking`.

## No migration

A process's commits only make sense to the workflow that made them. If the
workflow changes under an in-flight process so its history no longer replays to
the steps its commits name, gtd refuses with a divergence error telling you to
run `gtd abandon`. Tell the user to finish or `gtd abandon` any in-flight
process before switching to the edited workflow.

## Notes

- This skill is versioned in the gtd repository, not auto-installed. When gtd is
  upgraded, re-copy it from the new version's `skills/authoring/SKILL.md`.
- Where this file and the code disagree, the code wins: the step API's own doc
  comments in `@pmelab/gtd/flows`, and the bundled workflow under
  `src/workflows/`.
