# Land with a breaking-change footer and a clean Greptile re-review

## Requirement A — the release footer must carry the new breaking change

The load error that rejects a previously-valid workflow is a second breaking
change on top of the state re-homing (`packages.item.building` →
`packages.building`) the PR body already documents. semantic-release in this
repo reads a literal `BREAKING CHANGE` footer, not the `!` in the type; make
sure the landing commit carries one naming both breaks.

The load-error break has two classes to name: a workflow whose `entries.default`
names a state inside an `each:` subtree, and one whose `entries.manual` does.

## Requirement B — re-request Greptile after the fixes

Greptile's confidence score is 1/5 and its verdict reads "not safe to merge".
Its last-reviewed commit is `1cc43fad`. Nothing lands until it has re-reviewed
the fixed head.

The bar to land is a confidence score of 4/5 or better AND zero P1 findings. A
re-review that still reads "not safe to merge" blocks the land whatever the
severity of what remains; clearing the three P1s is necessary, not sufficient.

## Tasks

### Write the landing commit's breaking-change footer

Paths: the landing commit message; no source file.

- [ ] The commit message body ends with a literal `BREAKING CHANGE:` footer —
      the `!` in the type is not enough for this repo's semantic-release
- [ ] The footer names the state re-homing `packages.item.building` →
      `packages.building`
- [ ] The footer names the new load error, and names both of its classes: an
      `entries.default` state inside an `each:` subtree, and an `entries.manual`
      state inside one
- [ ] The footer tells an affected workflow author what to change, not only that
      something broke

### Re-request Greptile and hold the merge until it clears the bar

Paths: the pull request; no source file.

- [ ] The re-review is requested only after the final merge from `main`, so the
      reviewed head is the head that merges
- [ ] Greptile's re-review names the fixed head, not `1cc43fad`
- [ ] The re-review reports zero P1 findings
- [ ] The re-review's confidence score is 4/5 or better
- [ ] The re-review's verdict no longer reads "not safe to merge"
- [ ] The branch is not merged while any of the four conditions above is unmet,
      regardless of the severity of what remains
