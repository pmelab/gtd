# gtd

A CLI tool for AI-assisted get-things-done workflows.

## Development

### Pre-commit hook

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — no manual setup needed.

The hook runs [lint-staged](https://github.com/lint-staged/lint-staged) with
[Prettier](https://prettier.io/), formatting every staged file before each
commit:

```
prettier --ignore-unknown --write
```

This mirrors the `format:check` step enforced in CI (`prettier --check .`),
keeping committed code consistently formatted without requiring a separate
manual format pass.
