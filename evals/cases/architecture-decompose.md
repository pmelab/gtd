# `architecture.decompose` ships no eval case

Every other prompt state gets a two-sided case built on one check every grader
leans on: "only the contracted artifact changed." `architecture.decompose` has
no single contracted artifact — it writes a variable-sized set of package files
under `.gtd/packages/`, one per settled concern, and a correct turn's file count
depends entirely on how many concerns the upstream plan settled on. There is
nothing fixed to compare "only this changed" against, so the structural check
every other case's grader runs has no target here.

This file is inert: `evals/promptfooconfig.yaml` lists its `tests:` one by one
and never globs this directory, and no code path reads `.md` files under
`evals/cases/`.
