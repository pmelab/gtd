# gtd is agent agnostic

gtd works with every agent that a driver can run. No beat field, step option,
trailer or history format names an agent product or depends on the behaviour of
one agent. `model` is an opaque string that gtd passes through. The session id
is a UUID that an agent can use to resume a conversation or ignore. The system
prompt and the skill list are plain text that the driver maps onto what its
agent supports. We chose this over a first-class integration with one agent, so
that a team can change agents without changing workflows or histories.

## Consequences

- Bundled helpers, such as the `llm` answerer of `gtd judge run` and the
  reference driver in the driver guide, can default to one agent. They are
  drivers (ADR 0001), not the contract, and a user can replace them.
