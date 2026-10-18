## correctness: a silently failing task vanishes from the signature

`scripts/test-states.ts` `failureSignature` (lines 76-86) now drops a task's
cache line, echo lines, blank lines and turbo's `ERROR command … exited (N)`
line. A task that fails without printing anything of its own therefore adds
nothing to the signature, not even its name. Under `errors-only` a task block
appears only when that task failed, so its presence is the only evidence it
failed. With it gone, two states with different sets of failing tasks can get
the same signature:

- state A: `lint` fails with `real error`
- state B: `lint` fails the same way, and `typecheck` also fails silently

B's signature equals A's (checked:
`failureSignature(x, t) === failureSignature(x + y, t)` is `true`). So B is
reported as `FAIL (same failure as A)`, and `typecheck`'s failure in B never
shows. Before this change the normalised cache line kept `typecheck` in B's
signature. This breaks the change's own promise that a boilerplate-only failure
is "always shown in full, never collapsed": here it is collapsed into another
task's failure.

Fix: record every task that has a block, even one with no remaining lines (for
example a `typecheck:` marker entry in `byTask`). Return `""` only when every
recorded task kept zero lines. Add a test where a second state differs from the
first only by an extra boilerplate-only task, and assert it is not collapsed. No
current test fails if a task's block is dropped entirely.

## correctness (Nit): the fixed echo count of 2 assumes npm's exact preamble

`echoes.set(task, 2)` assumes every task's output opens with exactly two `> `
lines (npm's `> pkg@ script` / `> command`). That holds for today's `TASKS`,
since none has a `pre`/`post` script. If a task gains a `pre<task>` script, npm
prints four echo lines. The extra two then survive into the signature, a
boilerplate-only failure gets a non-empty signature, and it can be collapsed
again. If a runner prints fewer than two, the task's first real `> ` line is
eaten. Consider matching npm's own echo shape (`> <name>@<version> <script>`
followed by the command line) instead of counting. Or add a test that pins "no
TASKS entry has a pre/post script", so the assumption fails loudly.
