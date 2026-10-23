# Quality

## AC-1 ignores floating point

_From lens correctness._

Should subtract round? The criterion does not say.

```ts
// - [ ] fix, inside a fence, is no box
```

- [x] fix

Round half up.

## add has no test

_From lens test-audit. The fixer left it unresolved._

- a list in the finding's body
- with two items

- [ ] fix

# Dropped as noise

## add could be a method

_From lens correctness. The judge called it noise (p=0.85)._

A class would read better.

- [ ] fix
