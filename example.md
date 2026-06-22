"U" marks actions by the user "A" marks expected actions by the agent

- U: creates a new "TODO.md"
- U: invokes "gtd"
- A: commits verbatim "TODO.md"
- A: launches grilling agent, fleshes out TODO.md and adds open question in the
  beginning
- A: commits updated TODO.md
- U: answers questions in TODO.md
- U: invokes "gtd"
- A: commits verbatim changes to "TODO.md"
- A: launches grilling agent that inspects changes, moves answered questions to
  bottom, adds new open questions to the top
- A: commits updated TODO.md
- U: answers remaining questions
- U: invokes "gtd"
- A: commits updated TODO.md
- A: launches grilling agent that inspects changes, move answered questsion to
  bottom. confirms that plan is complete.
- A: commits updated TODO.md
- A: auto-invokes "gtd"
- A: launches decomposition agent, that generates two work packages
- A: commits new work packages
- A: removes TODO.md and commits removal
- A: auto-invokes "gtd"
- A: sees available work packages and picks the first one
- A: launches a subagent for each task
- A: waits for all agents to complete
- A: commits current result
- A: auto-invokes "gtd"
- A: runs the test command, which returns an error
- A: emits error output to ERRORS.md and commits it
- A: auto-invokes "gtd"
- A: sees ERRORS.md and invokes "fix" subagent
- A: waits for subagent to complete and commits result
- A: runs the test command, which returns successful
- A: removes first work package files
- A: auto-invokes "gtd"
- A: sees available work packages and picks the second one
- A: launches a subagent for each task
- A: waits for all agents to complete
- A: commits current result
- A: auto-invokes "gtd"
- A: runs the test command, which returns successful
- A: removes second work package files
- A: auto-invokes "gtd"
- A: generates REVIEW.md
- A: commits REVIEW.md
- U: user works through REVIEW.md, but leaves 1 item unchecked
- U: leaves a note in REVIEW.md
- U: does a code fix in a source file
- U: leaves a TODO comment in a source file
- U: invokes "gtd"
- A: see's the unchecked REVIEW.md item and explains that the user has to check
  off everything
- U: checks off the remaining item
- U: invokes "gtd"
- A: commits all changes verbatim
- A: auto-invokes "gtd"
- A: sees there are humand code changes and runs the test command, which returns
  an error
- A: emits error output to ERRORS.md and commits it
- A: auto-invokes "gtd"
- A: sees ERRORS.md and invokes "fix" subagent
- A: waits for subagent to complete and commits result
- A: auto-invokes "gtd"
- A: runs the test command, which returns successful
- A: auto-invokes "gtd"
- A: sees TODO comments and notes in REVIEW.md and consolidates them into a new
  TODO.md
- A: commits TODO.md and removes TODO comments in code and REVIEW.md
- A: auto-invokes "gtd"
- A: launches grilling agent that inspects new TODO.md
- A: grilling agent has no open questions and deems the scope "simple"
- A: commits fleshed out and updated TODO.md
- A: auto-invokes "gtd"
- A: invokes a single implementation agent (no decompose, because simple)
- A: removes TODO.md
- A: commits changes
- A: auto-invokes "gtd"
- A: runs the test command, which returns successful
- A: generates new REVIEW.md covering changes since last REVIEW.md was removed
  and commits it
- U: reviews changes and checks all boxes in REVIEW.md
- U: invokes "gtd"
- A: removes REVIEW.md and commits removal
- A: informs the user that the process is concluded and the system is ready for
  a new TODO.md

PRINCIPLES:

1. process should be resumable at any point in the commit history
2. agent auto-invokes gtd to resume by itself as much as possible
3. all human input is captured in git history verbatim
