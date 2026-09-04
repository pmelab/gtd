import { readFileSync, writeFileSync } from "node:fs"

// Runs between the two tsdown builds in `npm run build` (see package.json):
// the browser build already produced dist/web/main.js by the time this runs.
// Folds it into one self-contained HTML file — the exact ".html" text-loader
// trick `src/Visualize.ts` already uses for its hand-written visualize.html —
// so the node build can import the whole client as a string constant.
const template = readFileSync("src/web/index.html", "utf8")
const clientScript = readFileSync("dist/web/main.js", "utf8")

const scriptTagPattern = /<script type="module" src="\.\/main\.js"><\/script>/
if (!scriptTagPattern.test(template)) {
  throw new Error(
    "scripts/inline-web-client.mjs: src/web/index.html no longer has the expected " +
      '<script type="module" src="./main.js"></script> tag to inline into',
  )
}

const inlined = template.replace(
  scriptTagPattern,
  `<script type="module">\n${clientScript}\n</script>`,
)

writeFileSync("src/web/generated.html", inlined)
