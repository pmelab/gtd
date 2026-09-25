# The `entries.default` half is documented on the wrong key — the machine selector, not the root machine's `entry:`

`docs/configuration.md:106` appends the restriction to the top-level
`entry: default: <machine name>`:

> `default: <machine name> # which machine is the ROOT instance — a load error if it resolves to a state inside an `each:` reference's subtree, …`

and the new prose block (`docs/configuration.md:172-178`) repeats it as "the
top-level `entry.default`".

That key names a MACHINE. It never resolves to a state. The state that
`entries.default` is validated against comes from the ROOT MACHINE's own
`entry: <local or ref key>` — `docs/configuration.md:110` — which is untouched
and still reads as if any ref key were legal. An author who writes
`machines.unified.entry: packages.item.building`, hits
`entries.default "packages.item.building" is inside an each: reference — a process may not start inside a loop`,
and opens the docs is pointed at a key whose value (`unified`) is not what they
must change.

The same file says so itself at `docs/configuration.md:184`: the top-level
`entry:` and a state's own `entry: true` "are the same word at two different
levels, by design". The change attaches a state-level error to the
machine-selector level.

Fails these `Tasks` bullets:

- "The `each:` prose says a reachability root may not resolve inside the loop's
  subtree, naming both `entries.default` and `entries.manual`"
- "The prose tells an affected author the fix" — the stated fix ("move the root
  to a state outside the loop") is correct, but it is not attached to the key
  that carries the root.

Also: the docs spell it `entry.default`, while the emitted message says
`entries.default`. An author grepping the docs for the message text they were
handed gets zero hits (`grep -rn "entries.default" docs/` → nothing).

# The `entry: true` line still promises `--entry` works on a looped state, contradicting itself in the same sentence

`docs/configuration.md:139` now reads:

> `entry: true # optional — an EXTRA reachability root (`entries.manual`), enterable via `gtd
> --entry <this state's qualified
> name>`— NOT a precondition for`--entry`(any declared state is a valid target); a load error on a state inside an`each:` reference's subtree — a loop has no unqualified item to enter`

The restriction was appended; the two claims it invalidates were left standing:

- "enterable via `gtd --entry <this state's qualified name>`"
- "(any declared state is a valid target)"

Both are now false for a state inside an `each:` subtree. `gtd --entry` resolves
its legal targets through `manualEntryStates` (`src/step/planEntry.ts:93`),
which is `enterableStates` minus every state in an `each:` subtree — those base
names are withheld from the refusal's offered list too. So a looped state is
neither enterable nor a valid `--entry` target.

The package spec called this out under `Requirement A`: "The `entry: true` line
is actively wrong as written: it promises the state is 'enterable via
`gtd --entry <this state's qualified name>`', which is no longer true inside a
loop." Appending the error did not repair the promise; the line now asserts both
sides at once.
