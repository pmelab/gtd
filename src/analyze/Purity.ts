import type * as TS from "typescript"

// Flow code is replayed on every command, so anything whose answer can change
// between two replays of the same history — the clock, randomness, the
// environment, the filesystem, the network — is rejected there. A `run()` body
// and module top-level code (config load time) are exempt.

const IO_GLOBALS: ReadonlySet<string> = new Set([
  "Date",
  "process",
  "fetch",
  "require",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "XMLHttpRequest",
  "WebSocket",
  "performance",
  "crypto",
])

const IO_MODULES =
  /^(node:)?(fs|fs\/promises|child_process|http|https|net|dgram|dns|os|worker_threads|tls)$/

const importSpecifierOf = (ts: typeof TS, declaration: TS.Declaration): string | undefined => {
  let node: TS.Node | undefined = declaration
  while (node !== undefined && !ts.isImportDeclaration(node)) node = node.parent
  return node !== undefined && ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined
}

const isGlobal = (checker: TS.TypeChecker, node: TS.Identifier): boolean => {
  const declaration = checker.getSymbolAtLocation(node)?.declarations?.[0]
  return declaration === undefined || declaration.getSourceFile().isDeclarationFile
}

/** Why `node` is impure, or `undefined` when it is fine in flow code. */
export const impurityOf = (
  ts: typeof TS,
  checker: TS.TypeChecker,
  node: TS.Node,
): string | undefined => {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Math" &&
    node.name.text === "random" &&
    isGlobal(checker, node.expression)
  ) {
    return "Math.random is nondeterministic — flow code is replayed and must be pure"
  }
  if (!ts.isIdentifier(node)) return undefined
  if (IO_GLOBALS.has(node.text) && isGlobal(checker, node)) {
    return `${node.text} is IO or nondeterministic — flow code is replayed and must be pure; do it inside a run() body`
  }
  const declaration = checker.getSymbolAtLocation(node)?.declarations?.[0]
  const specifier = declaration === undefined ? undefined : importSpecifierOf(ts, declaration)
  return specifier !== undefined && IO_MODULES.test(specifier)
    ? `"${specifier}" is IO — flow code is replayed and must be pure; do it inside a run() body`
    : undefined
}
