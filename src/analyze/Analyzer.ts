import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import type * as TS from "typescript"
import type { Diagnostic } from "../workflow/index.js"
import { GraphBuilder, type GraphEdge, type GraphNode } from "./Builder.js"
import { Resolver, type Env } from "./Resolver.js"

// The graph is read off the AST, never off a replay: a step → step edge exists
// wherever a path through the flow's control flow could take it. Edge labels
// are the source text of the conditions along that path — a description, not
// a proof, so an infeasible edge (two contradictory conditions) is kept.

export interface EntryGraph {
  readonly name: string
  readonly edges: readonly { readonly to: string; readonly label: string }[]
}

export interface FlowGraph {
  readonly entries: readonly EntryGraph[]
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

export interface AnalyzeInput {
  /** The module whose default export is the `workflow(...)` call. */
  readonly entryFile: string
  /** The directory holding the flows runtime — `@pmelab/gtd/flows` resolves to its `index.ts`. */
  readonly flowsDir: string
  /** Source overrides by absolute path, for a config that exists only in memory. */
  readonly sources?: Readonly<Record<string, string>>
}

export interface AnalyzeResult {
  readonly graph: FlowGraph
  readonly diagnostics: readonly Diagnostic[]
}

// Loaded on first use: most commands never analyze anything.
let tsModule: typeof TS | undefined
const loadTypeScript = (): typeof TS => {
  tsModule ??= createRequire(import.meta.url)("typescript") as typeof TS
  return tsModule
}

const findWorkflowCall = (
  resolver: Resolver,
  builder: GraphBuilder,
  source: TS.SourceFile,
): { readonly call: TS.CallExpression; readonly env: Env } | undefined => {
  const ts = resolver.ts
  const exported = source.statements.find(
    (s): s is TS.ExportAssignment => ts.isExportAssignment(s) && s.isExportEquals !== true,
  )
  if (exported === undefined) {
    builder.report(source, "the config must default-export a workflow(...) call")
    return undefined
  }
  let expression: TS.Expression = exported.expression
  let env: Env = new Map()
  for (let depth = 0; depth < 8; depth++) {
    if (
      ts.isCallExpression(expression) &&
      resolver.runtimeName(expression.expression) === "workflow"
    ) {
      return { call: expression, env }
    }
    const bound = resolver.bindingOf(expression, env)
    if (bound === undefined) break
    expression = bound.node
    env = bound.env
  }
  builder.report(exported, "the default export must be a workflow(...) call")
  return undefined
}

/** An entry's flow expression: the property's value, or the `flow` of an `{ flow, base }` object. */
const flowOf = (
  ts: typeof TS,
  property: TS.ObjectLiteralElementLike,
): TS.Expression | undefined => {
  const value = ts.isPropertyAssignment(property)
    ? property.initializer
    : ts.isShorthandPropertyAssignment(property)
      ? property.name
      : undefined
  if (value === undefined || !ts.isObjectLiteralExpression(value)) return value
  const inner = value.properties.find(
    (p): p is TS.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === "flow",
  )
  return inner?.initializer
}

const buildEntries = (
  resolver: Resolver,
  builder: GraphBuilder,
  call: TS.CallExpression,
  env: Env,
): EntryGraph[] => {
  const ts = resolver.ts
  const arg = call.arguments[0]
  const literal = arg === undefined ? undefined : resolver.objectLiteral(arg, env)
  if (literal === undefined) {
    builder.report(arg ?? call, "workflow() takes an object literal mapping entry names to flows")
    return []
  }
  const entries: EntryGraph[] = []
  for (const property of literal.properties) {
    const name = property.name === undefined ? undefined : resolver.propertyName(property.name)
    const flow = flowOf(ts, property)
    const callable = flow === undefined ? undefined : resolver.callableOf(flow, env)
    if (name === undefined || callable === undefined) {
      builder.report(property, "every workflow() entry needs a literal name and a flow function")
      continue
    }
    const start = builder.newNode(-1)
    builder.connectToEnd(builder.inlineEntry(callable.fn, callable.env, property, start))
    entries.push({ name, edges: builder.collapseFrom(start) })
  }
  return entries
}

const makeHost = (
  ts: typeof TS,
  options: TS.CompilerOptions,
  sources: Readonly<Record<string, string>>,
): TS.CompilerHost => {
  const host = ts.createCompilerHost(options, true)
  const virtualDirs = new Set<string>()
  for (const path of Object.keys(sources)) {
    for (
      let dir = dirname(path);
      !virtualDirs.has(dir) && dirname(dir) !== dir;
      dir = dirname(dir)
    ) {
      virtualDirs.add(dir)
    }
  }
  const read = (fileName: string): string | undefined => {
    const absolute = resolve(fileName)
    if (Object.hasOwn(sources, absolute)) return sources[absolute]
    try {
      return readFileSync(absolute, "utf8")
    } catch {
      return undefined
    }
  }
  return {
    ...host,
    fileExists: (fileName) => read(fileName) !== undefined,
    directoryExists: (dir) =>
      virtualDirs.has(resolve(dir)) || (host.directoryExists?.(dir) ?? false),
    realpath: (path) =>
      Object.hasOwn(sources, resolve(path)) ? path : (host.realpath?.(path) ?? path),
    readFile: read,
    getSourceFile: (fileName, languageVersion) => {
      const text = read(fileName)
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersion, true)
    },
  }
}

const syntaxDiagnostics = (
  ts: typeof TS,
  program: TS.Program,
  source: TS.SourceFile,
): Diagnostic[] =>
  program.getSyntacticDiagnostics(source).map((d) => {
    const { line, character } = source.getLineAndCharacterOfPosition(d.start ?? 0)
    return {
      severity: "error",
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      path: [],
      origin: source.fileName,
      line: line + 1,
      column: character + 1,
    }
  })

/** Analyze a workflow module: its step graph, and every construct that keeps it from compiling. */
export const analyzeWorkflow = (input: AnalyzeInput): AnalyzeResult => {
  const ts = loadTypeScript()
  const flowsDir = resolve(input.flowsDir)
  const sources: Record<string, string> = {}
  for (const [path, text] of Object.entries(input.sources ?? {})) sources[resolve(path)] = text
  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    allowJs: true,
    noEmit: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
    paths: { "@pmelab/gtd/flows": [join(flowsDir, "index.ts")] },
  }
  const entryFile = resolve(input.entryFile)
  const program = ts.createProgram({
    rootNames: [entryFile],
    options,
    host: makeHost(ts, options, sources),
  })
  const resolver = new Resolver(ts, program.getTypeChecker(), join(flowsDir, "runtime.ts"))
  const builder = new GraphBuilder(resolver)
  const source = program.getSourceFile(entryFile)
  if (source === undefined) {
    return {
      graph: { entries: [], nodes: [], edges: [] },
      diagnostics: [
        {
          severity: "error",
          message: "cannot read the workflow module",
          path: [],
          origin: entryFile,
        },
      ],
    }
  }
  builder.diagnostics.push(...syntaxDiagnostics(ts, program, source))
  const found = findWorkflowCall(resolver, builder, source)
  const entries = found === undefined ? [] : buildEntries(resolver, builder, found.call, found.env)
  return {
    graph: { entries, nodes: builder.steps, edges: builder.stepEdges() },
    diagnostics: builder.diagnostics,
  }
}
