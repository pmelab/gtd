# 02 — Make `rollout` and `cleanup` startable here (chore)

## Requirements

Concern 2 (TECHNICAL): `gtd.config.ts` exports `rollout` and `cleanup` from
`@pmelab/gtd/workflows` so the later two processes can run on this branch. PATH
gtd is 27.6.0; both shipped in 27.2.0.

Concern 3 (PRODUCT): nothing built here. Later, on this branch:
`gtd --workflow rollout --var flag=judge_sonnet`, then
`gtd --workflow cleanup --var flag=judge_sonnet`. **One PR, merge commit or
rebase — never squash, or the flag/rollout/cleanup commits collapse into one and
the acceptance line fails.** **The flag never ships default-off in a release**;
rollout is simulated.

## Tasks

### 1. Export the workflows

Paths: `gtd.config.ts`

- [ ] Import `rollout as shippedRollout`, `cleanup as shippedCleanup` from
      `@pmelab/gtd/workflows`
- [ ] `export const rollout = shippedRollout()` and
      `export const cleanup = shippedCleanup()` — factory defaults, registry
      `src/flags/index.ts`
- [ ] Delete the "rollout and cleanup stay out until a release ships them"
      comment; header comment lists rollout and cleanup beside feature, review,
      fix
- [ ] Default export stays `feature`
- [ ] PATH gtd loads the config: `gtd --help` (or any read-only gtd command)
      exits 0 with no config-load error
- [ ] `npm run format:check` green on `gtd.config.ts`

### 2. Record the later runs (concern 3)

- [ ] Nothing built for rollout/cleanup in this process
- [ ] Rollout and cleanup run later on this branch as
      `gtd --workflow rollout --var flag=judge_sonnet` then
      `gtd --workflow cleanup --var flag=judge_sonnet`; one PR, merge commit or
      rebase, never squash
