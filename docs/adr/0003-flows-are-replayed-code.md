# Flows are plain async code, replayed

A workflow's logic is an ordinary async function that awaits steps. gtd finds
where a process rests by running that function again over history, answering
each step from the next commit. We chose this over a declared state machine or
graph so that a workflow branches with ordinary code and is tested with ordinary
tools. The price is that flow code must be pure: anything it reads outside
history and the tree can make replay disagree with what happened.
