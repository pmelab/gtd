import { createRequire, isBuiltin } from "node:module"
import { homedir, tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { stripVTControlCharacters } from "node:util"
import { runInThisContext } from "node:vm"
import { gunzipSync, gzipSync } from "node:zlib"

// What the core needs of Node beyond the sync port: module loading, the
// user's directories, file URLs and gzip. Each is a Node fact with no in-memory twin.

export { createRequire, fileURLToPath, homedir, isBuiltin, stripVTControlCharacters, tmpdir }

export const gzip = (source: string): Uint8Array => gzipSync(source, { level: 9 })

export const gunzip = (bytes: Uint8Array): string => gunzipSync(bytes).toString("utf8")

/** Compiles `source` as a script in this realm, reporting errors against `filename`. */
export const compileScript = (source: string, filename: string): unknown =>
  runInThisContext(source, { filename })
