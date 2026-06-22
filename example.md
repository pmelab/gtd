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
