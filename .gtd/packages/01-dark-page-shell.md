# Dark page shell for the served web client

## Requirement

The phone client renders unstyled. There is no stylesheet, no `<style>` tag, and
no `.css` file anywhere in `src/web`; `src/web/index.html` sets nothing beyond
`charset`, the viewport meta, and a title. No `body` background, no text color,
no font stack, no `color-scheme`.

Components meanwhile hardcode dark-surface colors and expect a dark page under
them: `Refusal.tsx#124` (`#111` / `#3a2a00` with a `#333` border),
`NoteSheet.tsx#199` (`#111`), `Hunk.tsx#111` and `#119` (`#3a2a00`), and
`Highlight.ts`'s syntax palette (`#6a9955`, `#ce9178`, `#569cd6`), a dark-editor
token set. On a default white document with black text, those dark chips read as
broken paint, not as a theme.

**The theme is dark only.** This is a page shell and nothing more: a `body`
background, a text color, a font stack, and `color-scheme: dark` so form
controls and scrollbars follow. **Every hardcoded color already in the
components stays exactly as it is** — no component and no syntax palette is
touched.

**The delivery paths constrain the shape.** Both read exactly two files and
nothing else: `scripts/inline-web-client.mjs` reads `src/web/index.html` plus
`dist/web/main.js` and folds them into `src/web/generated.html`; `--dev`'s
`resolveClientHtml` (`Server.ts#204`, `#229`) reads the same two at startup. Any
`.css` the `tsdown --filter web` build emits alongside `main.js` is dropped on
the floor in production too. `src/ui/scriptTag.mjs`'s `SCRIPT_TAG_PATTERN` is
the single inline seam and matches a `<script type="module" src>` tag only — a
`<link rel="stylesheet">` has no handler, raises no error, and resolves to
nothing in the browser.

## Design

An inline `<style>` block in `src/web/index.html`'s `<head>`. Not a `.css` file,
not injection from `main.tsx`: a build-emitted stylesheet is dropped by both
delivery paths, and JS-injected styles paint after the first frame — a flash of
white on every phone load. **Inline `<style>` needs no change to either delivery
path, no change to `tsdown.config.ts`, and no new inline seam beside
`SCRIPT_TAG_PATTERN`.**

Error handling: **none, structurally.** The inline-script seam throws a named
error when its tag goes missing because the script is folded in from a separate
file at build time. A `<style>` block is part of the template itself — it cannot
go missing without the template going missing, which both paths already report.

## Tasks

### Add the page shell to `src/web/index.html`

Paths: `src/web/index.html`

- [ ] An inline `<style>` block sits in `<head>`, before the `<script>` tag
- [ ] `color-scheme: dark` is declared — **without it a phone in light mode
      paints white form controls and a white scrollbar over the dark page**
- [ ] `body` carries a dark `background` consistent with the `#111` already
      hardcoded in `Refusal.tsx#124` and `NoteSheet.tsx#199`
- [ ] `body` carries a light `color`
- [ ] `body` carries a system font stack (`-apple-system, …`), the phone
      client's target being iOS Safari
- [ ] `body` carries `margin: 0`, so the dark surface reaches the viewport edges
- [ ] No `.tsx` component file and no `Highlight.ts` color is changed by this
      task — `#111`, `#3a2a00`, `#333`, `#6a9955`, `#ce9178`, `#569cd6` are
      untouched
- [ ] `SCRIPT_TAG_PATTERN` still matches the template, so
      `scripts/inline-web-client.mjs` does not throw

### Pin the shell against both served sources

Paths: `src/ui/Server.test.ts`

- [ ] A test asserts a page background and a text color are present in the
      `generated.html` string `Server.ts#16` imports
- [ ] A test asserts the same against the `--dev` template read from
      `src/web/index.html`
- [ ] Both tests fail against the template as it stands today, before the shell
      is added
