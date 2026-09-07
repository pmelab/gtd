# Spec feedback — 02 Worktree discovery and the fleet screen

Four concrete problems. Everything else in T1–T6 checks out.

## 1. A Broken row never invalidates — it is stale until the server restarts

`src/serve/Beat.ts`, `brokenResult` + `BeatCache.read`.

A Broken outcome caches a key of
`{headSha, filePath: undefined, fileMtime: undefined, logPath: undefined, logMtime: undefined}`.
The warm-path check then recomputes exactly those axes, gets `undefined` for the
three it skipped, and `sameKey` returns true — so the cached Broken row is
served forever until HEAD's sha moves.

Failure: a worktree refuses with `gtd: refused, dirty tree` (the very case
`Beat.test.ts` scripts). The user runs `git checkout .`, fixing it. HEAD did not
move, so every later fleet request — pull-to-refresh included — keeps serving
the Broken row for the life of the `gtd serve` process. Worse for a worktree
whose `headSha` itself resolves to `undefined` (a `.git` gtd cannot read): every
key axis is `undefined`, so that entry can never invalidate at all, by any
means.

`liveHeadSha`'s doc comment states the opposite of what the code does: "Returns
`undefined` on any read failure — the cache then treats that axis as always
'changed', forcing a fresh cold read rather than serving a stale one."
`undefined === undefined` is a cache HIT. Either the comment or the behaviour
has to change; the comment describes the behaviour T3's own risk paragraph
assumes.

## 2. `docs/configuration.md` documents `roots` as additive; the code replaces

`src/serve/Server.ts:294` is `roots: config?.roots ?? [cwd.root]` — a configured
`roots` REPLACES the invoking directory. `docs/configuration.md` says roots are
"repo roots the server exposes through the web/phone client, **beyond the
invoking directory**", which reads as additive. `docs/cli.md`'s serve row ("for
the roots declared under serve: in config (default: this repo)") reads as
replacing.

Failure: a user configures `serve.roots: ["/repos/others"]`, opens the fleet
screen from their own checkout, and the repo they are standing in is not listed.
Package 02 is the first consumer of `roots`, so the ambiguity is this package's
to settle — pick one behaviour and make both docs say it.

## 3. Valid JSON that is not a beat becomes a blank ok row, not Broken

`src/serve/Beat.ts`, `okResult`: `kind: fields.kind as FleetKind` and
`actor: fields.actor as Actor` are unchecked casts, and `label` falls back
through `String(fields.state ?? "")` to `""`.

The requirement's Broken bucket is "spawn failed, unsupported version,
**unparseable beat**" — only `JSON.parse` throwing is treated as unparseable
today. A `gtd` on the worktree's `$PATH` whose `package.json` the version check
cannot see (`readLocalGtdVersionAt` only looks at
`node_modules/@pmelab/gtd/package.json`, so a linked/workspace install returns
`undefined` and is waved through) emits a different envelope: it parses, and the
row renders with an empty label, an `undefined` kind and an `undefined` actor,
silently bucketed by `bucketOf` rather than shown as Broken. Validate the fields
the row projects and treat a missing/unknown `kind` or `actor` as Broken.

## 4. T3's "and no other's" is not actually covered

`src/serve/Beat.test.ts`, "a new commit invalidates that worktree's entry and no
other's": it builds two SEPARATE `BeatCache` instances over two separate fake
dep sets, so nothing about cross-entry isolation inside one cache is exercised —
two independent caches cannot invalidate each other by construction. The same
file's "one Broken worktree does not affect another read from the same cache"
makes a claim its body contradicts: it too uses two caches, not one.

Both belong on a single `BeatCache` with per-path fakes: read A and B, move only
A's sha, assert A re-spawns and B does not.
