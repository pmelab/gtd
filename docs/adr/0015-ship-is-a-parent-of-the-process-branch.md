# A ship is a parent of the process branch

A ship landing on the process branch `gtd/<b>` is a merge commit. Its first
parent is the process's previous commit. Its second parent is the ship on `<b>`.
The link between a process and its ships is then in the commit graph alone: no
trailer names the ship, and no local ref (`refs/gtd/shipped/*`) that a fresh
clone or a ref cleanup loses is needed. `<b>` still carries no trace of gtd (ADR
0011), and no commit is rewritten (ADR 0007). We chose this over keeping the
link in a `Gtd-Shipped` trailer and a ref.

## Consequences

- Replay still walks first-parent history. It reads a ship landing's second
  parent as the `ship()` step's value, so this needs history format 6. Older
  formats keep the trailer and the ref, and gtd still reads them there.
- `<b>` is an ancestor of `gtd/<b>` after a ship, so the merge base of the two
  branches is the last ship.
- Anything that walks `gtd/<b>` without `--first-parent` also reaches `<b>`'s
  history. A history ref pushed to `historyRemote` carries the ships and `<b>`'s
  earlier commits too.
