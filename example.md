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
- A: launches decomposition agent, that generates work packages
- A: commits new work packages
- A: removes TODO.md and commits removal
- A: auto-invokes "gtd"
- A: sees available work packages and picks the first one
- A: launches a subagent for each task
- A: waits for all agents to complete
- A: commits current result
- A: runs the test command, which returns an error
- A: emits error output to ERRORS.md and commits it
- A: auto-invokes "gtd"
- A: sees ERRORS.md and invokes "fix" subagent
- A: waits for subagent to complete and commits result
- A: runs the test command, which returns successful
- A: auto-invokes "gtd"
