# Spec feedback — 01-remove-qr-code

Tasks 1 and 2 are met. One out-of-scope regression rides along.

## `tsdown.config.ts` — the `gtd` bundle stopped bundling its dependencies

The `qrcode-terminal` cleanup deleted the whole `deps` block from the `gtd`
config entry, not just the exception inside it. It was:

```ts
deps: {
  alwaysBundle: (id) => !id.includes("qrcode-terminal"),
},
```

`alwaysBundle` was the only thing forcing dependencies INTO the bundle. With
`deps` absent, tsdown falls back to its default — externalize every
`dependencies` entry — so `dist/gtd.bundle.mjs` is no longer self-contained.

Measured, same tree, only `tsdown.config.ts` swapped:

- old config: 11.78 MB, zero external dependency imports
- new config: 1.84 MB, external `import`s for `effect`, `@effect/platform`,
  `@effect/platform-node`, `@trpc/server`, `cosmiconfig`, `yaml`, `eta`,
  `mdast-util-*`, `micromark-extension-*`, `vscode-languageserver`,
  `vscode-languageserver-textdocument`

Nothing in the suite pins bundle self-containment, so `npm test` stays green and
the regression ships silently. The spec scoped this package to the QR code only;
it never asked for a packaging change.

Fix: keep the `deps` block on the `gtd` entry and drop only the exception —
`deps: { alwaysBundle: [/.*/] }`, matching the `web` entry directly above it.
Also restore the `web` entry's comment reference to the `gtd` config's
`alwaysBundle` (it was reworded to "no exceptions." when the block it pointed at
disappeared).
