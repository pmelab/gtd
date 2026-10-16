# 03 — File friction follow-ups as `track:dogfood` issues (chore)

## Requirements

Concern 4 (PRODUCT): this process keeps `flag_naive_pass=0` and
`flag_risk_tier=0`. **"Trailers for every gate" is only partly met: no
`seam.judge` and no `Gtd-Mark: risk-tier` trailers land.** Record that gap as a
friction follow-up, never a silent omission.

Concern 5 (PRODUCT): last package of this process files one `gh` issue per
friction point hit during this process, labelled `track:dogfood`, referencing
#355. Search open `track:dogfood` issues first; comment on a match instead of
filing a duplicate. They feed #356 (SDLC docs), which #355 blocks.

## Tasks

### 1. Search before filing

- [ ] `gh issue list --label track:dogfood --state open` run first; matches
      noted per friction point

### 2. Trailer-gap issue (concern 4)

- [ ] One issue (or comment on a matching open one) recording the missing
      `seam.judge` and `Gtd-Mark: risk-tier` trailers from running with
      `flag_naive_pass=0` and `flag_risk_tier=0`; labelled `track:dogfood`,
      references #355

### 3. Remaining friction points (concern 5)

- [ ] Every other friction point hit in this process filed as its own issue, or
      as a comment on a matching open `track:dogfood` issue
- [ ] Each new issue labelled `track:dogfood` and references #355
- [ ] No duplicate of an already-open `track:dogfood` issue created
