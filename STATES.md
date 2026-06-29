# Repository states and development phases

The current state of the GTD system reads the current filesystem and derives a
state and therefore the next agent prompt. Each action leaves code in
uncommitted states, and the next invocation of `gtd` will commit and proceed.
Some states are tagged as `auto-advance` and emit a prompt suffix that instructs
the agent to emit a prompt suffix that instructs the llm to run `gtd` itself
again.

`gtd` temporarily writes and commits steering files:

- **TODO.md:** the current plan
- **REVIEW.md:** a guided review document for humans with file pointers that
  spans a certain commit diff
- **FEEDBACK.md:** error output from test commands, feedback from agentic
  reviews
- **.gtd:** directory of ordered work packages and parallelizable subtasks

So the high level procedure is:

1. determine current state based on filesystem, diff status and last commit
   message
2. execute actions (deterministic)
3. print next instruction prompt for agent

## States

### Transport

**Conditions:** the last commit was `gtd: transport`

**Actions:**

- do a mixed reset of the last commit and re-evaluate the state
- directly re-start the gtd process

**Prompt:** none

### Clean

**Conditions:**

- no steering files exist
- no pending changes in the repository

**Actions:**

- determine base commit for review: if the last commit is on the repository
  default branch, search for the last commit that _deleted_ the REVIEW.md

**Prompt:**

- instruct agent to create `REVIEW.md` for the changes since the calculated
  commit

### New Feature

**Conditions:**

- no REVIEW.md or .gtd directory
- but code changes and/or a new `TODO.md`

**Actions:**

- extract current diff
- commit current changes verbatim `gtd: new task`
- revert last commit `gtd: cleanup`

**Prompt:**

- invoke grilling agent to treat the whole extracted diff as requirements input
  - TODO.md content
  - code comments
  - code changes (suggestions)

### Grilling

**Conditions:**

- `TODO.md` exists and is modified, has remaining question markers or other
  files have been modified

**Actions:**

- commit current changes verbatim `gtd: grilling`

**Prompt:**

- continue grilling. incorporate whole diff as feedback/additions to TODO.md and
  remind developer to answer all questions.

### Grilled (auto-advance)

**Conditions:** `TODO.md` exsits, is _not_ modified or has no more remaining
question markers. no other code changes

**Actions:**

- commit current changes (if any) verbatim `gtd: grilled`
- prompt:

**Prompt:**

- start decomposition (planning) and create `.gtd` directory with packages and
  tasks

### Planning (auto-advance)

**Conditions:** files in `.gtd` directory added or modified

**Actions:**

- commit changes verbatim `gtd: planning`

### Building (auto-advance)

**Conditions:**

- files in `.gtd` exist and are clean or a package directory has been deleted
- if deleted, at least one more package exists
- no code changes

**Actions:**

- commit deletion of package file with `gtd: package done`
- pick first/next package

**Prompt:**

- subagent buiding tasks of first package in parallel

### Testing (auto-advance)

**Conditions:**

- files in `.gtd` exist and are clean
- there _are_ code changes
- **no** FEEDBACK.md or ERRORS.md

**Actions:**

- walk back git history and count the number of `gtd: errors` in the current
  test/fix loop
- commit changes `gtd: building`
- run the test command
- if exit != 0, print output into FEEDBACK.md and commit as `gtd: errors`
- if exit == 0, just proceed

**Prompt:**

- if number of loop iterations over threshold, escalate
- otherwise just prompt to re-invoke

### Fixing (auto-advance)

**Conditions:**

- FEEDBACK.md exists

**Actions:**

- if `FEEDBACK.md` is dirty, commit as `gtd: feedback`
- commit code changes as `gtd: fixing`
- delete FEEDBACK.md

**Prompt:**

- fixer agent with error/feedback output

### Agentic Review (auto-advance)

**Conditions:**

- files in `.gtd` exist and are clean
- there are **no** code changes
- **no** FEEDBACK.md

**Actions:**

- walk back git history and count the number of `gtd: feedback` in the current
  review/fix loop
- find the commit hash of the last commit that was not `gtd: building` or
  `gtd: feedback`

**Prompt:**

- if number of loop iterations over threshold, just proceed
- instruct agent to do a review of the aggregated changes of the preceeding
  batch of `gtd: building` and `gtd: feedback` commits
- if there is feedback, write it into `FEEDBACK.md`, otherwise do nothing

### Close package (auto-advance)

**Conditions:**

- files in `.gtd` exist and are clean
- there are **no** code changes
- **no** FEEDBACK.md

**Actions:**

- delete first package in `.gtd` from filesystem

**Prompt:**

- just proceed with next iteration

### Human Review (auto-advance)

**Conditions:**

- package directory has been deleted
- no more packages left

**Actions:**

- commit deletion of package file with `gtd: package done`

**Prompt:**

- just proceed, should lead to **Clean** and invoke creation of `REVIEW.md`

### Await Review

**Conditions:**

- uncommitted REVIEW.md

**Actions:**

- commit REVIEW.md as `gtd: awaiting review`

**Prompt:**

- tell user to review changes based on REVIEW.md

### Accept Review (auto-advance)

**Conditions:**

- REVIEW.md exists
- there are changes in the repo

**Actions:**

- extract changeset
- revert code changes
- remove REVIEW.md
- commit as `gtd: cleanup`

**Prompt:**

- synthesize changeset (diff in REVIEW.md, code comments and change suggestions)
  into a new TODO.md

### Done

**Conditions:**

- REVIEW.md exists
- there are no more changes to the repo

**Actions:**

- remove REVIEW.md
- commit removal as `gtd: done`
