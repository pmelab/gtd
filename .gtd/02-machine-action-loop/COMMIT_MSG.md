refactor(gtd): make the no-agent action loop machine-directed

Turn the pure fold into a stepping machine that owns the no-agent action loop.
Add `MAX_NO_AGENT_HOPS`, `noAgentHops`/`lastAdvancedLeaf` context, and the
cap/stuck guards routing to escalate. No-agent leaves (cleanup, close-review,
code-changes) stop being terminal, emit an `EdgeAction`, and loop back to
replaying. Fold the test gate (`runTestGate`/`TEST_RESULT`, gated to execute
only) and review pre-render (`reviewPreRender`/`REVIEW_RECORDED`) into the
machine, retiring `selectPrompt` from the edge. `ResolveResult` gains
`edgeAction?`; `resolve(events)` stays a wrapper over the new `start`/`advance`
handle so existing unit tests keep compiling. Machine.test.ts and State.test.ts
updated in the same package to stay green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
