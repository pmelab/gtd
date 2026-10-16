# Satisfied

- Search before filing: `gh issue list --label track:dogfood --state open` run;
  no prior dogfood friction issues besides #355/#356.
- Trailer-gap issue: pmelab/gtd#371, labelled `track:dogfood`, references #355.
- Remaining friction points: pmelab/gtd#372 (rollout/cleanup config reds
  repo-config test; 1187-line FEEDBACK.md) and pmelab/gtd#373 (declared-tests
  guard on an unchanged test; non-code package stalls as empty), both labelled
  `track:dogfood`, referencing #355.
- No duplicates: each covers a distinct friction point.
