# Install semantic-release dev dependencies

Add the semantic-release toolchain as dev dependencies so the release workflow
(landed in a later package) can run `npx semantic-release`.

Run:

```
npm install --save-dev semantic-release @semantic-release/git @semantic-release/github @semantic-release/exec
```

`@semantic-release/commit-analyzer` and `@semantic-release/release-notes-generator`
are bundled with the `semantic-release` core, so they do not need a separate
install even though `.releaserc.json` lists them explicitly.

Do NOT add `@semantic-release/npm` — this package is `private` and is not
published to a registry; the version bump is handled by `@semantic-release/exec`
instead.

## Acceptance criteria

- [ ] `semantic-release`, `@semantic-release/git`, `@semantic-release/github`,
      and `@semantic-release/exec` appear under `devDependencies` in
      `package.json`
- [ ] `package-lock.json` is updated to match (committed)
- [ ] `@semantic-release/npm` is NOT added
- [ ] `npm test` is green

## Files

- `/Users/pmelab/Code/gtd/gtd/package.json`
- `/Users/pmelab/Code/gtd/gtd/package-lock.json`
