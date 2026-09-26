import type * as TS from "typescript"
import type { Diagnostic } from "../workflow/index.js"
import { impurityOf } from "./Purity.js"
import type { Binding, Callable, Env, Resolver } from "./Resolver.js"

export type NodeKind = "agent" | "human" | "run" | "judge" | "restart"

export interface GraphNode {
  /** The scoped step name — the node id. */
  readonly name: string
  readonly kind: NodeKind
  /** Everything before the last `.`: the memory scope, and the viewer's cluster. */
  readonly scope: string
  /** Option values the analyzer could read as constants. */
  readonly options: Readonly<Record<string, string | number | boolean>>
  /** The step's content argument (prompt, body, message): its value when constant, its source text otherwise. */
  readonly content?: string
  readonly file: string
  readonly line: number
}

/** `to === END` is the end of the episode. */
export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly label: string
}

const END = "$end"

const STEP_KINDS: ReadonlySet<string> = new Set(["agent", "human", "run", "judge", "restart"])
const STEPPING_RUNTIME: ReadonlySet<string> = new Set([...STEP_KINDS, "refuse", "scope", "persona"])
/** The argument index of each step's options object, and of its content. */
const OPTIONS_ARG: Readonly<Record<string, number>> = { agent: 2, human: 1, run: 2, judge: 3 }
const CONTENT_ARG: Readonly<Record<string, number>> = { agent: 1, run: 1 }

const STEERING_OPTIONS = [
  "file",
  "mode",
  "requireProgress",
  "answerGate",
  "requireRevert",
  "reviewBase",
  "label",
]
/** Option keys each step accepts — the runtime's option types, which jiti never type-checks. */
const KNOWN_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  agent: new Set([...STEERING_OPTIONS, "model", "system", "skills", "allowEmpty"]),
  human: new Set([...STEERING_OPTIONS, "message", "acceptClean"]),
  run: new Set(STEERING_OPTIONS),
  judge: new Set([...STEERING_OPTIONS, "message", "minP"]),
}
// Keys an older workflow format accepted, with what replaced them.
const RETIRED_OPTIONS: Readonly<Record<string, string>> = {
  memory:
    "a step's memory scope is computed from its scope() prefix, so the memory option no longer exists",
}

interface Pending {
  readonly from: number
  readonly conds: readonly string[]
}

export type Frontier = readonly Pending[]

interface LoopContext {
  readonly label: string | undefined
  readonly breaks: Pending[]
  readonly continues: Pending[]
}

type MutableEnv = Map<TS.Symbol, Binding>

type Handler<N extends TS.Node> = (node: N, frontier: Frontier, env: MutableEnv) => Frontier

const JUNCTION = -1

const AWAIT_MESSAGE =
  "flow code may await only a step, scope(), persona(), or a function that steps"

/**
 * Builds a control-flow graph of step nodes and junctions by walking flow
 * code structurally, inlining every flow function and callback at its call
 * site, then collapses the junctions into labelled step → step edges.
 */
export class GraphBuilder {
  private readonly ts: typeof TS
  private readonly resolver: Resolver
  readonly diagnostics: Diagnostic[] = []
  private readonly cfgNodes: number[] = []
  private readonly cfgEdges: {
    readonly from: number
    readonly to: number
    readonly conds: readonly string[]
  }[] = []
  readonly steps: GraphNode[] = []
  private readonly stepIndex = new Map<string, number>()
  private readonly stepSite = new Map<string, string>()
  private readonly scopes: string[] = []
  private readonly loops: LoopContext[] = []
  private readonly returns: Pending[][] = []
  private readonly inlining: Callable[] = []
  private readonly sites: string[] = []
  private readonly endNode: number
  private readonly statementHandlers: ReadonlyMap<TS.SyntaxKind, Handler<TS.Node>>

  constructor(resolver: Resolver) {
    this.ts = resolver.ts
    this.resolver = resolver
    this.endNode = this.newNode(JUNCTION)
    const k = this.ts.SyntaxKind
    const loop: Handler<TS.Node> = (node, f, env) =>
      this.loop(node as TS.IterationStatement, f, env, undefined)
    this.statementHandlers = new Map<TS.SyntaxKind, Handler<TS.Node>>([
      [k.Block, (node, f, env) => this.block((node as TS.Block).statements, f, env)],
      [
        k.ExpressionStatement,
        (node, f, env) => this.expression((node as TS.ExpressionStatement).expression, f, env),
      ],
      [k.VariableStatement, (node, f, env) => this.variables(node as TS.VariableStatement, f, env)],
      [k.IfStatement, (node, f, env) => this.ifStatement(node as TS.IfStatement, f, env)],
      [k.WhileStatement, loop],
      [k.ForStatement, loop],
      [k.DoStatement, loop],
      [k.ForOfStatement, loop],
      [k.ForInStatement, loop],
      [k.LabeledStatement, (node, f, env) => this.labeled(node as TS.LabeledStatement, f, env)],
      [k.BreakStatement, (node, f) => this.jump(node as TS.BreakStatement, f, "breaks")],
      [k.ContinueStatement, (node, f) => this.jump(node as TS.ContinueStatement, f, "continues")],
      [
        k.ReturnStatement,
        (node, f, env) => this.returnStatement(node as TS.ReturnStatement, f, env),
      ],
      [k.ThrowStatement, (node, f, env) => this.throwStatement(node as TS.ThrowStatement, f, env)],
      [
        k.SwitchStatement,
        (node, f, env) => this.switchStatement(node as TS.SwitchStatement, f, env),
      ],
      [k.TryStatement, (node, f, env) => this.tryStatement(node as TS.TryStatement, f, env)],
    ])
  }

  // ── Graph primitives ──────────────────────────────────────────────────────

  newNode(step: number): number {
    this.cfgNodes.push(step)
    return this.cfgNodes.length - 1
  }

  connect(frontier: Frontier, to: number): void {
    for (const p of frontier) this.cfgEdges.push({ from: p.from, to, conds: p.conds })
  }

  connectToEnd(frontier: Frontier): void {
    this.connect(frontier, this.endNode)
  }

  private withCond(frontier: Frontier, cond: string): Frontier {
    return frontier.map((p) => ({ from: p.from, conds: [...p.conds, cond] }))
  }

  /** The two ways out of a condition — only one when it is a constant. */
  private split(
    frontier: Frontier,
    condition: TS.Expression,
    env: Env,
  ): { whenTrue: Frontier; whenFalse: Frontier } {
    const value = this.resolver.constant(condition, env)
    if (typeof value === "boolean") {
      return value ? { whenTrue: frontier, whenFalse: [] } : { whenTrue: [], whenFalse: frontier }
    }
    const text = condition.getText()
    return {
      whenTrue: this.withCond(frontier, text),
      whenFalse: this.withCond(frontier, `!(${text})`),
    }
  }

  private readonly reported = new Set<string>()

  report(node: TS.Node, message: string): void {
    const source = node.getSourceFile()
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart())
    const key = `${source.fileName}:${node.getStart()}:${message}`
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.diagnostics.push({
      severity: "error",
      message,
      path: [],
      origin: source.fileName,
      line: line + 1,
      column: character + 1,
    })
  }

  private checkIo(node: TS.Node): void {
    const problem = impurityOf(this.ts, this.resolver.checker, node)
    if (problem !== undefined) this.report(node, problem)
  }

  private scanIo(node: TS.Node): void {
    this.checkIo(node)
    this.ts.forEachChild(node, (child) => this.scanIo(child))
  }

  // ── Static reachability ───────────────────────────────────────────────────

  /**
   * Whether running `node` could reach a step. Conservative where it must
   * guess: an awaited call it cannot resolve counts as stepping.
   */
  private mayStep(node: TS.Node, env: Env, visiting: readonly Callable[]): boolean {
    const ts = this.ts
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      return false
    }
    if (ts.isCallExpression(node) && this.callMaySteps(node, env, visiting)) return true
    return (
      ts.forEachChild(node, (child) => this.mayStep(child, env, visiting) || undefined) ?? false
    )
  }

  private callMaySteps(node: TS.CallExpression, env: Env, visiting: readonly Callable[]): boolean {
    const runtime = this.resolver.runtimeName(node.expression)
    if (runtime !== undefined) return STEPPING_RUNTIME.has(runtime)
    const callable = this.resolver.callableOf(node.expression, env)
    if (callable === undefined) return this.ts.isAwaitExpression(node.parent)
    if (visiting.includes(callable.fn) || callable.fn.body === undefined) return false
    const bound = this.bindParameters(callable.fn, node.arguments, callable.env, env)
    return this.mayStep(callable.fn.body, bound, [...visiting, callable.fn])
  }

  /** Whether a statement can neither step nor leave its enclosing function or loop. */
  private isInert(node: TS.Node, env: Env, ownLoop = false): boolean {
    return !this.mayStep(node, env, []) && !this.exits(node, ownLoop)
  }

  private exits(node: TS.Node, ownLoop: boolean): boolean {
    const ts = this.ts
    if (ts.isFunctionLike(node)) return false
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true
    if (!ownLoop && ts.isBreakOrContinueStatement(node)) return true
    return ts.forEachChild(node, (child) => this.exits(child, ownLoop) || undefined) ?? false
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  private stepName(call: TS.CallExpression, kind: string, env: Env): string | undefined {
    const nameArg = call.arguments[0]
    const literal = nameArg === undefined ? undefined : this.resolver.constant(nameArg, env)
    if (typeof literal === "string" && literal !== "") return [...this.scopes, literal].join(".")
    this.report(
      nameArg ?? call,
      `the first argument of ${kind}() must be a string literal step name`,
    )
    return undefined
  }

  private checkCollision(call: TS.CallExpression, name: string): void {
    const site = `${call.getSourceFile().fileName}:${call.getStart()}`
    const previous = this.stepSite.get(name)
    if (previous !== undefined && previous !== site) {
      this.report(
        call.arguments[0]!,
        `step name "${name}" is already used by another call site — wrap one of them in scope()`,
      )
    }
    this.stepSite.set(name, site)
  }

  private checkOptionKeys(call: TS.CallExpression, kind: string, name: string, env: Env): void {
    const known = KNOWN_OPTIONS[kind]
    const arg = call.arguments[OPTIONS_ARG[kind] ?? -1]
    const literal =
      known === undefined || arg === undefined ? undefined : this.resolver.objectLiteral(arg, env)
    if (literal === undefined) return
    const unknown = literal.properties.flatMap((property) => {
      if (property.name === undefined) return []
      const key = this.resolver.propertyName(property.name)
      return key === undefined || known!.has(key) ? [] : [key]
    })
    if (unknown.length === 0) return
    const why = unknown.flatMap((key) => (RETIRED_OPTIONS[key] ? [RETIRED_OPTIONS[key]] : []))
    this.report(
      literal,
      `step "${name}": unknown key(s) ${unknown.join(", ")} in ${kind}() options${why.length > 0 ? ` — ${why.join("; ")}` : ""}`,
    )
  }

  private contentOf(
    call: TS.CallExpression,
    kind: string,
    env: Env,
    options: Record<string, unknown>,
  ): string | undefined {
    const index = CONTENT_ARG[kind]
    const arg = index === undefined ? undefined : call.arguments[index]
    if (arg === undefined) return typeof options.message === "string" ? options.message : undefined
    const value = this.resolver.constant(arg, env)
    return typeof value === "string" ? value : arg.getText()
  }

  private nodeFor(call: TS.CallExpression, kind: string, name: string, env: Env): number {
    const existing = this.stepIndex.get(name)
    if (existing !== undefined) return existing
    const source = call.getSourceFile()
    const options = this.resolver.staticOptions(call.arguments[OPTIONS_ARG[kind] ?? -1], env)
    const content = this.contentOf(call, kind, env, options)
    this.steps.push({
      name,
      kind: kind as NodeKind,
      scope: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : "",
      options,
      ...(content !== undefined ? { content } : {}),
      file: source.fileName,
      line: source.getLineAndCharacterOfPosition(call.getStart()).line + 1,
    })
    const index = this.newNode(this.steps.length - 1)
    this.stepIndex.set(name, index)
    return index
  }

  private step(call: TS.CallExpression, kind: string, frontier: Frontier, env: Env): Frontier {
    const name = this.stepName(call, kind, env)
    if (name === undefined) return []
    this.checkCollision(call, name)
    this.checkOptionKeys(call, kind, name, env)
    const index = this.nodeFor(call, kind, name, env)
    this.connect(frontier, index)
    const after: Frontier = [{ from: index, conds: [] }]
    if (kind !== "restart") return after
    this.connectToEnd(after)
    return []
  }

  // ── Expressions ───────────────────────────────────────────────────────────

  expression(node: TS.Expression, frontier: Frontier, env: Env): Frontier {
    const ts = this.ts
    if (frontier.length === 0) return frontier
    if (ts.isAwaitExpression(node)) return this.awaited(node, frontier, env)
    if (ts.isCallExpression(node)) return this.call(node, frontier, env, false)
    if (ts.isConditionalExpression(node)) return this.conditional(node, frontier, env)
    if (ts.isBinaryExpression(node)) return this.binary(node, frontier, env)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      this.scanIo(node.body)
      return frontier
    }
    this.checkIo(node)
    return this.subexpressions(node, frontier, env)
  }

  // Property assignments, template spans and the like are not expressions
  // themselves, but the expressions inside them are still flow code.
  private subexpressions(node: TS.Node, frontier: Frontier, env: Env): Frontier {
    let current = frontier
    this.ts.forEachChild(node, (child) => {
      if (this.ts.isExpression(child)) current = this.expression(child, current, env)
      else if (!this.ts.isToken(child) && !this.ts.isTypeNode(child)) {
        this.checkIo(child)
        current = this.subexpressions(child, current, env)
      }
    })
    return current
  }

  private conditional(node: TS.ConditionalExpression, frontier: Frontier, env: Env): Frontier {
    const after = this.expression(node.condition, frontier, env)
    const edgesBefore = this.cfgEdges.length
    const branches = this.split(after, node.condition, env)
    const joined = [
      ...this.expression(node.whenTrue, branches.whenTrue, env),
      ...this.expression(node.whenFalse, branches.whenFalse, env),
    ]
    // No step in either arm: the ternary is a plain value, not a branch.
    return this.cfgEdges.length === edgesBefore ? after : joined
  }

  private binary(node: TS.BinaryExpression, frontier: Frontier, env: Env): Frontier {
    const k = this.ts.SyntaxKind
    const op = node.operatorToken.kind
    const after = this.expression(node.left, frontier, env)
    const shortCircuits =
      op === k.AmpersandAmpersandToken || op === k.BarBarToken || op === k.QuestionQuestionToken
    if (!shortCircuits) return this.expression(node.right, after, env)
    const edgesBefore = this.cfgEdges.length
    const branches = this.split(after, node.left, env)
    const joined =
      op === k.AmpersandAmpersandToken
        ? [...this.expression(node.right, branches.whenTrue, env), ...branches.whenFalse]
        : [...branches.whenTrue, ...this.expression(node.right, branches.whenFalse, env)]
    return this.cfgEdges.length === edgesBefore ? after : joined
  }

  private awaited(node: TS.AwaitExpression, frontier: Frontier, env: Env): Frontier {
    let operand: TS.Expression = node.expression
    while (this.ts.isParenthesizedExpression(operand)) operand = operand.expression
    if (this.ts.isCallExpression(operand)) return this.call(operand, frontier, env, true)
    this.report(node, AWAIT_MESSAGE)
    return this.expression(operand, frontier, env)
  }

  private call(node: TS.CallExpression, frontier: Frontier, env: Env, awaited: boolean): Frontier {
    const runtime = this.resolver.runtimeName(node.expression)
    if (runtime !== undefined) return this.runtimeCall(node, runtime, frontier, env)
    const current = this.callOperands(node, frontier, env)
    const callable = this.resolver.callableOf(node.expression, env)
    if (callable !== undefined) return this.callResolved(node, callable, current, env)
    if (awaited) this.report(node, `${AWAIT_MESSAGE} — this callee cannot be resolved`)
    return current
  }

  /** The callee and its non-function arguments, evaluated in order. */
  private callOperands(node: TS.CallExpression, frontier: Frontier, env: Env): Frontier {
    const ts = this.ts
    let current = frontier
    if (ts.isIdentifier(node.expression)) this.checkIo(node.expression)
    else current = this.expression(node.expression, current, env)
    for (const arg of node.arguments) {
      if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg))
        current = this.expression(arg, current, env)
    }
    return current
  }

  private callResolved(
    node: TS.CallExpression,
    callable: { readonly fn: Callable; readonly env: Env },
    current: Frontier,
    env: Env,
  ): Frontier {
    const bound = this.bindParameters(callable.fn, node.arguments, callable.env, env)
    if (callable.fn.body !== undefined && !this.mayStep(callable.fn.body, bound, [callable.fn])) {
      this.scanIo(callable.fn.body)
      return current
    }
    return this.inline(callable.fn, node.arguments, callable.env, env, node, current)
  }

  private runtimeCall(
    node: TS.CallExpression,
    name: string,
    frontier: Frontier,
    env: Env,
  ): Frontier {
    if (name === "scope" || name === "persona") return this.compose(node, name, frontier, env)
    const isStep = STEP_KINDS.has(name)
    if (!isStep && name !== "refuse") return frontier
    let current = frontier
    // A run() body is opaque: it executes at the edge, not in flow code.
    node.arguments.forEach((arg, i) => {
      if (i > 0 && !(name === "run" && i === 1)) current = this.expression(arg, current, env)
    })
    return isStep ? this.step(node, name, current, env) : []
  }

  private compose(node: TS.CallExpression, name: string, frontier: Frontier, env: Env): Frontier {
    const [first, fnArg] = node.arguments
    const callable = fnArg === undefined ? undefined : this.resolver.callableOf(fnArg, env)
    if (callable === undefined) {
      this.report(fnArg ?? node, `the callback of ${name}() cannot be resolved`)
      return frontier
    }
    if (name !== "scope") return this.inline(callable.fn, [], callable.env, env, node, frontier)
    const prefix = first === undefined ? undefined : this.resolver.constant(first, env)
    if (typeof prefix !== "string" || prefix === "") {
      this.report(first ?? node, "the first argument of scope() must be a string literal prefix")
      return frontier
    }
    this.scopes.push(prefix)
    try {
      return this.inline(callable.fn, [], callable.env, env, node, frontier)
    } finally {
      this.scopes.pop()
    }
  }

  private bindParameters(
    fn: Callable,
    args: readonly TS.Expression[],
    closure: Env,
    callerEnv: Env,
  ): MutableEnv {
    const env: MutableEnv = new Map(closure)
    fn.parameters.forEach((param, i) => {
      const symbol = this.ts.isIdentifier(param.name)
        ? this.resolver.checker.getSymbolAtLocation(param.name)
        : undefined
      const arg = args[i]
      if (symbol === undefined) return
      if (arg !== undefined) env.set(symbol, { node: arg, env: callerEnv })
      else if (param.initializer !== undefined) env.set(symbol, { node: param.initializer, env })
    })
    return env
  }

  private inline(
    fn: Callable,
    args: readonly TS.Expression[],
    closure: Env,
    callerEnv: Env,
    site: TS.Node,
    frontier: Frontier,
  ): Frontier {
    if (this.inlining.includes(fn)) {
      this.report(site, "a flow function may not call itself — write the repetition as a loop")
      return []
    }
    const env = this.bindParameters(fn, args, closure, callerEnv)
    const returns: Pending[] = []
    const savedLoops = this.loops.splice(0)
    this.inlining.push(fn)
    this.sites.push(`${site.getSourceFile().fileName}:${site.getStart()}`)
    this.returns.push(returns)
    try {
      const body = fn.body
      if (body === undefined) return frontier
      const fallthrough = this.ts.isBlock(body)
        ? this.statement(body, frontier, env)
        : this.expression(body, frontier, env)
      return [...fallthrough, ...returns]
    } finally {
      this.returns.pop()
      this.sites.pop()
      this.inlining.pop()
      this.loops.push(...savedLoops)
    }
  }

  /** Build one entry's flow from its own start junction. Step names may repeat across entries — entries share steps. */
  inlineEntry(fn: Callable, env: Env, site: TS.Node, start: number): Frontier {
    this.stepSite.clear()
    return this.inline(fn, [], env, new Map(), site, [{ from: start, conds: [] }])
  }

  // ── Statements ────────────────────────────────────────────────────────────

  statement(node: TS.Statement, frontier: Frontier, env: MutableEnv): Frontier {
    if (frontier.length === 0) return frontier
    return this.statementHandlers.get(node.kind)?.(node, frontier, env) ?? frontier
  }

  private block(
    statements: readonly TS.Statement[],
    frontier: Frontier,
    env: MutableEnv,
  ): Frontier {
    let current = frontier
    for (const statement of statements) current = this.statement(statement, current, env)
    return current
  }

  private variables(node: TS.VariableStatement, frontier: Frontier, env: MutableEnv): Frontier {
    let current = frontier
    const isConst = (node.declarationList.flags & this.ts.NodeFlags.Const) !== 0
    for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer === undefined) continue
      current = this.expression(declaration.initializer, current, env)
      const symbol = this.ts.isIdentifier(declaration.name)
        ? this.resolver.checker.getSymbolAtLocation(declaration.name)
        : undefined
      if (isConst && symbol !== undefined) env.set(symbol, { node: declaration.initializer, env })
    }
    return current
  }

  private ifStatement(node: TS.IfStatement, frontier: Frontier, env: MutableEnv): Frontier {
    const arms = [
      node.thenStatement,
      ...(node.elseStatement === undefined ? [] : [node.elseStatement]),
    ]
    if (arms.every((arm) => this.isInert(arm, env))) {
      const after = this.expression(node.expression, frontier, env)
      for (const arm of arms) this.scanIo(arm)
      return after
    }
    const branches = this.split(
      this.expression(node.expression, frontier, env),
      node.expression,
      env,
    )
    const whenTrue = this.statement(node.thenStatement, branches.whenTrue, env)
    const whenFalse =
      node.elseStatement === undefined
        ? branches.whenFalse
        : this.statement(node.elseStatement, branches.whenFalse, env)
    return [...whenTrue, ...whenFalse]
  }

  private labeled(node: TS.LabeledStatement, frontier: Frontier, env: MutableEnv): Frontier {
    return this.ts.isIterationStatement(node.statement, false)
      ? this.loop(node.statement, frontier, env, node.label.text)
      : this.statement(node.statement, frontier, env)
  }

  private jump(
    node: TS.BreakStatement | TS.ContinueStatement,
    frontier: Frontier,
    kind: "breaks" | "continues",
  ): Frontier {
    const label = node.label?.text
    const loop = [...this.loops].reverse().find((l) => label === undefined || l.label === label)
    loop?.[kind].push(...frontier)
    return []
  }

  private returnStatement(node: TS.ReturnStatement, frontier: Frontier, env: MutableEnv): Frontier {
    const after =
      node.expression === undefined ? frontier : this.expression(node.expression, frontier, env)
    this.returns[this.returns.length - 1]?.push(...after)
    return []
  }

  private throwStatement(node: TS.ThrowStatement, frontier: Frontier, env: MutableEnv): Frontier {
    this.expression(node.expression, frontier, env)
    return []
  }

  private loopPreamble(node: TS.IterationStatement, frontier: Frontier, env: MutableEnv): Frontier {
    const ts = this.ts
    if (ts.isForOfStatement(node) || ts.isForInStatement(node))
      return this.expression(node.expression, frontier, env)
    if (!ts.isForStatement(node) || node.initializer === undefined) return frontier
    if (!ts.isVariableDeclarationList(node.initializer))
      return this.expression(node.initializer, frontier, env)
    return node.initializer.declarations.reduce<Frontier>(
      (acc, d) => (d.initializer === undefined ? acc : this.expression(d.initializer, acc, env)),
      frontier,
    )
  }

  /** Where a pre-test loop goes from its head: into the body, or out. */
  private loopTest(
    node: TS.IterationStatement,
    atHead: Frontier,
    env: MutableEnv,
  ): { whenTrue: Frontier; whenFalse: Frontier } {
    const ts = this.ts
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const iterated = node.expression.getText()
      return {
        whenTrue: this.withCond(atHead, `next of ${iterated}`),
        whenFalse: this.withCond(atHead, `${iterated} exhausted`),
      }
    }
    const condition = ts.isWhileStatement(node)
      ? node.expression
      : ts.isForStatement(node)
        ? node.condition
        : undefined
    if (condition === undefined) return { whenTrue: atHead, whenFalse: [] }
    return this.split(this.expression(condition, atHead, env), condition, env)
  }

  private loop(
    node: TS.IterationStatement,
    frontier: Frontier,
    env: MutableEnv,
    label: string | undefined,
  ): Frontier {
    if (this.isInert(node, env, true)) {
      this.scanIo(node)
      return frontier
    }
    const head = this.newNode(JUNCTION)
    this.connect(this.loopPreamble(node, frontier, env), head)
    const context: LoopContext = { label, breaks: [], continues: [] }
    this.loops.push(context)
    try {
      const exits = this.ts.isDoStatement(node)
        ? this.doLoop(node, head, context, env)
        : this.preTestLoop(node, head, context, env)
      return [...exits, ...context.breaks]
    } finally {
      this.loops.pop()
    }
  }

  private doLoop(
    node: TS.DoStatement,
    head: number,
    context: LoopContext,
    env: MutableEnv,
  ): Frontier {
    const afterBody = this.statement(node.statement, [{ from: head, conds: [] }], env)
    const afterCond = this.expression(node.expression, [...afterBody, ...context.continues], env)
    const branches = this.split(afterCond, node.expression, env)
    this.connect(branches.whenTrue, head)
    return branches.whenFalse
  }

  private preTestLoop(
    node: TS.IterationStatement,
    head: number,
    context: LoopContext,
    env: MutableEnv,
  ): Frontier {
    const test = this.loopTest(node, [{ from: head, conds: [] }], env)
    let afterBody: Frontier = [
      ...this.statement(node.statement, test.whenTrue, env),
      ...context.continues,
    ]
    if (this.ts.isForStatement(node) && node.incrementor !== undefined) {
      afterBody = this.expression(node.incrementor, afterBody, env)
    }
    this.connect(afterBody, head)
    return test.whenFalse
  }

  private switchStatement(node: TS.SwitchStatement, frontier: Frontier, env: MutableEnv): Frontier {
    const after = this.expression(node.expression, frontier, env)
    const subject = node.expression.getText()
    const context: LoopContext = { label: undefined, breaks: [], continues: [] }
    const unmatched = (conds: readonly string[]): Frontier =>
      conds.reduce<Frontier>((acc, cond) => this.withCond(acc, `!(${cond})`), after)
    const matched: string[] = []
    let fallthrough: Frontier = []
    let hasDefault = false
    this.loops.push(context)
    try {
      for (const clause of node.caseBlock.clauses) {
        let entry: Frontier
        if (this.ts.isCaseClause(clause)) {
          const cond = `${subject} === ${clause.expression.getText()}`
          matched.push(cond)
          entry = this.withCond(after, cond)
        } else {
          hasDefault = true
          entry = unmatched(matched)
        }
        fallthrough = this.block(clause.statements, [...fallthrough, ...entry], env)
      }
    } finally {
      this.loops.pop()
    }
    // A `continue` inside a switch belongs to the enclosing loop.
    this.loops[this.loops.length - 1]?.continues.push(...context.continues)
    return [...fallthrough, ...(hasDefault ? [] : unmatched(matched)), ...context.breaks]
  }

  private tryStatement(node: TS.TryStatement, frontier: Frontier, env: MutableEnv): Frontier {
    const edgesBefore = this.cfgEdges.length
    const afterTry = this.statement(node.tryBlock, frontier, env)
    if (this.cfgEdges.length > edgesBefore) {
      this.report(
        node,
        "try/catch around a step is not allowed — a step that fails is recorded in history, never caught",
      )
    }
    return node.finallyBlock === undefined
      ? afterTry
      : this.statement(node.finallyBlock, afterTry, env)
  }

  // ── Collapse ──────────────────────────────────────────────────────────────

  /** Walk junctions from `start` to the step nodes (or the end) they lead to. */
  collapseFrom(start: number): { readonly to: string; readonly label: string }[] {
    const found = new Map<string, { to: string; label: string }>()
    const walk = (node: number, conds: readonly string[], seen: ReadonlySet<number>): void => {
      for (const edge of this.cfgEdges) {
        if (edge.from !== node) continue
        const nextConds = [...conds, ...edge.conds]
        const step = this.cfgNodes[edge.to]!
        if (edge.to !== this.endNode && step === JUNCTION) {
          if (!seen.has(edge.to)) walk(edge.to, nextConds, new Set([...seen, edge.to]))
          continue
        }
        const to = edge.to === this.endNode ? END : this.steps[step]!.name
        const label = nextConds.join(" && ")
        found.set(`${to}\u0000${label}`, { to, label })
      }
    }
    walk(start, [], new Set([start]))
    return [...found.values()]
  }

  stepEdges(): GraphEdge[] {
    return [...this.stepIndex].flatMap(([name, node]) =>
      this.collapseFrom(node).map((edge) => ({ from: name, ...edge })),
    )
  }
}
