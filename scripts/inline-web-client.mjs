import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import {
  SCRIPT_TAG_PATTERN,
  STYLE_TAG_PATTERN,
  inlineScript,
  inlineStyles,
} from "../src/ui/scriptTag.mjs"

/**
 * The pure core of the inline step — exported so `tests/tooling/` can drive
 * it with fake inputs instead of shelling out to a real `npm run build`.
 * `distWebAssetNames` is every file actually found under `dist/web/` at
 * inline time; `cssRaw` is `undefined` when `dist/web/main.css` doesn't
 * exist at all (a missing-file read and an empty-file read are both
 * failures, but distinct ones — see the two throws below).
 */
export const buildGeneratedHtml = (template, script, cssRaw, distWebAssetNames) => {
  if (!SCRIPT_TAG_PATTERN.test(template)) {
    throw new Error(
      "scripts/inline-web-client.mjs: src/web/index.html no longer has the expected " +
        '<script type="module" src="./main.js"></script> tag to inline into',
    )
  }
  if (!STYLE_TAG_PATTERN.test(template)) {
    throw new Error(
      "scripts/inline-web-client.mjs: src/web/index.html no longer has the expected " +
        '<link rel="stylesheet" href="./main.css" /> tag to inline into',
    )
  }

  // package 02's own blunt risk: the Tailwind build step emits
  // dist/web/main.css as a SEPARATE asset from main.js, and this script
  // previously never looked at anything but the script tag — an un-inlined
  // stylesheet would ship a served page that looks perfect in Storybook and
  // dead in the actual client. Fail loudly rather than silently drop it.
  if (cssRaw === undefined) {
    throw new Error(
      "scripts/inline-web-client.mjs: dist/web/main.css is missing — did the Tailwind CLI " +
        "build step run before this script?",
    )
  }
  if (cssRaw.trim().length === 0) {
    throw new Error("scripts/inline-web-client.mjs: dist/web/main.css is empty")
  }

  let html = inlineScript(template, script)
  html = inlineStyles(html, cssRaw)

  // Every file tsdown/Tailwind actually emitted under dist/web/ must have
  // been inlined above — an emitted asset this script doesn't know to fold
  // in is exactly the same silent-drop risk as main.css, just for whatever
  // comes next.
  const knownAssets = new Set(["main.js", "main.css"])
  const unaccounted = distWebAssetNames.filter((name) => !knownAssets.has(name))
  if (unaccounted.length > 0) {
    throw new Error(
      `scripts/inline-web-client.mjs: dist/web/ contains asset(s) this script never inlines: ${unaccounted.join(", ")}`,
    )
  }

  return html
}

// Runs between the two tsdown builds in `npm run build` (see package.json):
// the browser build already produced dist/web/main.js by the time this
// runs, and the Tailwind CLI step right after it has produced
// dist/web/main.css. Folds both into one self-contained HTML file, which the
// node build imports through its ".html" text loader as a string constant.
//
// Guarded behind this check so `tests/tooling/inline-web-client.test.ts` can
// import `buildGeneratedHtml` above without these real-filesystem reads
// running (and failing) as an import side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  const template = readFileSync("src/web/index.html", "utf8")
  const clientScript = readFileSync("dist/web/main.js", "utf8")
  let cssRaw
  try {
    cssRaw = readFileSync("dist/web/main.css", "utf8")
  } catch {
    cssRaw = undefined
  }
  const distWebAssetNames = readdirSync("dist/web")

  writeFileSync(
    "src/web/generated.html",
    buildGeneratedHtml(template, clientScript, cssRaw, distWebAssetNames),
  )
}
