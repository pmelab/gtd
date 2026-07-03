# Review: eed5b7a

<!-- base: eed5b7a1b362e943085d9ae5a651229c5aef85a0 -->

## Add the squashing state to the machine

Introduces `squashing` as the 17th `GtdState` and its resolve rule: when the
working tree is clean, HEAD is `gtd: done`, `squashEnabled` is true, and a
`squashBase` is present, `resolve` returns an auto-advancing `squashing` result
with no edge action (the agent performs the reset/commit). Falls through to the
existing Clean/Idle branch otherwise. Adds
`squashBase`/`squashDiff`/`squashEnabled` to `ResolvePayload`, carries
`squashBase`/`squashDiff` through `ResolveContext` via `buildContext`, and
defaults `squashEnabled: false` in `DEFAULT_PAYLOAD`.

the commit itself should happen on the edge. the agent should only generate the
commit message

- [x] ./src/Machine.ts#38
- [x] ./src/Machine.ts#151
- [x] ./src/Machine.ts#221
- [x] ./src/Machine.ts#322
- [x] ./src/Machine.ts#337
- [x] ./src/Machine.ts#611

## Compute squash base and diff at the edge

`gatherEvents` now derives the squash inputs only when HEAD is `gtd: done` and
squash is enabled in config. It locates the cycle ending at HEAD (between the
previous `gtd: done` and the last one), finds that cycle's first
`gtd: grilling`, resolves its parent as the `squashBase`, and diffs from there
to HEAD. The base/diff are only emitted when the diff is non-empty, so an empty
cycle routes to Idle rather than squashing. `squashEnabled` is always set from
`config.squash`.

- [ ] ./src/Events.ts#559
- [ ] ./src/Events.ts#631

## Add the squash config flag

Adds `squash` (boolean, default `true`) to the config schema and
`ConfigOperations`, wiring it through `toOperations` so it can be opted out via
`.gtdrc`.

- [ ] ./src/Config.ts#46
- [ ] ./src/Config.ts#72
- [ ] ./src/Config.ts#83
- [ ] ./src/Config.ts#227

## Wire the squashing prompt

Registers `squashing.md` as the section for the new state, maps it to the
`clean` (planning) model tier, and appends the inlined full-process diff plus a
literal `Squash base:` line to the prompt when squashing. The new prompt
instructs a planning-model subagent to author one conventional-commits message
from the full diff, then run `git reset --soft <squashBase>` + `git commit`
unconditionally, mirroring the `clean.md` handoff pattern with an auto-advance
tail.

the commit message body should also contain any important decisions from
grilling sessions

- [ ] ./src/Prompt.ts#8
- [ ] ./src/Prompt.ts#50
- [ ] ./src/Prompt.ts#61
- [ ] ./src/Prompt.ts#216
- [ ] ./src/prompts/squashing.md#1

## Unit tests for the squashing path

Adds machine tests for the four squashing/idle branches and context passthrough;
edge tests covering the six squash-payload scenarios (full cycle, interleaved
non-gtd commit, second process, config opt-out, non-`gtd: done` HEAD,
already-squashed); config tests for the `squash` default/override; and prompt
tests for the section, model injection, inlined diff, base hash, and
auto-advance tail. Extends the property test allowance, `State.test.ts` state
list, and the `Perf`/`Events` fake configs to include the new state and flag.

- [ ] ./src/Machine.test.ts#191
- [ ] ./src/Machine.test.ts#620
- [ ] ./src/Events.test.ts#68
- [ ] ./src/Events.test.ts#717
- [ ] ./src/Config.test.ts#128
- [ ] ./src/Prompt.test.ts#84
- [ ] ./src/Prompt.test.ts#382
- [ ] ./src/Machine.property.test.ts#108
- [ ] ./src/Machine.property.test.ts#155
- [ ] ./src/State.test.ts#28
- [ ] ./src/State.test.ts#53
- [ ] ./src/Perf.test.ts#71

## Integration scenarios for squashing

Adds a `squashing.feature` with four scenarios (happy path, interleaved non-gtd
commit surfaced in the diff, config opt-out to Idle, and already-squashed
boundary yielding Idle) and updates `journeys.feature` so the post-`gtd: done`
runs now expect the Squashing prompt instead of Idle.

- [ ] ./tests/integration/features/squashing.feature#1
- [ ] ./tests/integration/features/journeys.feature#112
- [ ] ./tests/integration/features/journeys.feature#231

## Update docs and remove finished plan

Bumps the state count to 17 across README and STATES, documents the Squashing
state (conditions, actions, idempotency), the `Done → Squashing → Idle` flow,
and the `squash` config option; adds the flowchart edges. Deletes the completed
`TODO.md` feature plan.

- [ ] ./README.md#9
- [ ] ./README.md#57
- [ ] ./README.md#372
- [ ] ./README.md#411
- [ ] ./STATES.md#78
- [ ] ./STATES.md#409
- [ ] ./TODO.md#1
