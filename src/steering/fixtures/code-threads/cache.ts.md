A TypeScript source with two code threads. It lives in markdown because gtd
scans every other file in a change for live threads.

```ts
// The cache key is the content hash.
export const cacheKey = (content: string): string =>
  // H: Why not the modification time? A checkout
  // could keep it stable.
  // A: A checkout rewrites every mtime.
  hash(content)

export const cacheDir = (root: string): string =>
  // H: Should this honour $XDG_CACHE_HOME?
  join(root, ".cache")
```
