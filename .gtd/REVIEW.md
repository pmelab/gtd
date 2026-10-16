# Review: 95a5d5b

<!-- base: ff3655680b7720f1e80a4ed22743ac6d49d72536 -->

## Scenarios

The one change since base deletes a duplicate copy of a scenario. **Coverage
does not change:** the surviving copy matches the deleted one byte for byte.

- [ ] ./tests/integration/features/judge-run.feature#265-284 — Weakened: lost
      `Then it succeeds` (twice) and
      `And the last commit subject is "gtd(judge): review → conservative"`,
      **but only from the duplicate copy, so nothing is actually lost**. This
      surviving scenario still pins every one of those lines. With no
      `--provider` and `TYPESAFE_API_KEY` set, the judge answers through jev,
      not claude. The jev noul answers 0.9/0.1 land the conservative branch,
      while claude's two yes answers would have landed the confident one. No
      `.gtd/REQUIREMENTS.md` exists, so no requirement asked for the second
      copy.

## Duplicate scenario removal

The second copy of a duplicated scenario is deleted. Cucumber ran both copies
under the same name, so the suite ran the same check twice and its report showed
two entries with one name. **No step definitions, source, or docs changed.**

- [ ] ./tests/integration/features/judge-run.feature#284-286 — the 20-line
      second copy of "no --provider with TYPESAFE_API_KEY set answers through
      jev, not claude" used to sit here. Now `--model reaches claude's argv`
      follows the surviving copy directly. Weakened: this removal accounts for
      the lost `Then it succeeds` x2 and
      `And the last commit subject is "gtd(judge): review → conservative"`.
      **Each of those lines still runs in the surviving copy at 265-284.**
      `.gtd/REQUIREMENTS.md` does not exist, so nothing asked for them.
