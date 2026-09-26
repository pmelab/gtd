import { resolve } from "node:path"
import type * as TS from "typescript"

/** What an identifier stands for at one specialization: an argument or a `const` initializer, with the environment it closes over. */
export interface Binding {
  readonly node: TS.Expression
  readonly env: Env
}

export type Env = ReadonlyMap<TS.Symbol, Binding>

export type Callable = TS.ArrowFunction | TS.FunctionExpression | TS.FunctionDeclaration

export type Constant = string | number | boolean

/** Symbol, constant and callee resolution — the specialization half of the analyzer. */
export class Resolver {
  readonly ts: typeof TS
  readonly checker: TS.TypeChecker
  private readonly runtimeFile: string

  constructor(ts: typeof TS, checker: TS.TypeChecker, runtimeFile: string) {
    this.ts = ts
    this.checker = checker
    this.runtimeFile = runtimeFile
  }

  symbolOf(node: TS.Node): TS.Symbol | undefined {
    const parent = node.parent
    const symbol =
      parent !== undefined && this.ts.isShorthandPropertyAssignment(parent) && parent.name === node
        ? this.checker.getShorthandAssignmentValueSymbol(parent)
        : this.checker.getSymbolAtLocation(node)
    if (symbol === undefined) return undefined
    return symbol.flags & this.ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol
  }

  /** The runtime export a callee names (`agent`, `scope`, `tail`, …), or `undefined`. */
  runtimeName(callee: TS.Expression): string | undefined {
    const symbol = this.symbolOf(callee)
    const file = symbol?.declarations?.[0]?.getSourceFile().fileName
    return file !== undefined && resolve(file) === this.runtimeFile ? symbol!.name : undefined
  }

  constant(node: TS.Expression, env: Env): Constant | undefined {
    const literal = this.literal(node)
    if (literal !== undefined) return literal
    const inner = this.unwrap(node)
    if (inner !== node) return this.constant(inner, env)
    return this.composite(node, env)
  }

  private literal(node: TS.Expression): Constant | undefined {
    const ts = this.ts
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    return node.kind === ts.SyntaxKind.FalseKeyword ? false : undefined
  }

  private composite(node: TS.Expression, env: Env): Constant | undefined {
    const ts = this.ts
    if (ts.isTemplateExpression(node)) return this.template(node, env)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return this.concat(node, env)
    }
    if (ts.isPropertyAccessExpression(node)) return this.propertyConstant(node, env)
    const bound = this.bindingOf(node, env)
    return bound === undefined ? undefined : this.constant(bound.node, bound.env)
  }

  /** `obj.key` where `obj` resolves to an object literal whose `key` is itself constant. */
  private propertyConstant(node: TS.PropertyAccessExpression, env: Env): Constant | undefined {
    const found = this.property(node, env)
    return found === undefined ? undefined : this.constant(found.node, found.env)
  }

  /** The initializer `obj.key` reads, when `obj` resolves to an object literal. */
  property(node: TS.PropertyAccessExpression, env: Env): Binding | undefined {
    const ts = this.ts
    const holder = ts.isPropertyAccessExpression(node.expression)
      ? this.property(node.expression, env)
      : { node: node.expression, env }
    if (holder === undefined) return undefined
    const literal = this.objectLiteral(holder.node, holder.env)
    const property = literal?.properties.find(
      (p): p is TS.PropertyAssignment | TS.ShorthandPropertyAssignment =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        this.propertyName(p.name) === node.name.text,
    )
    if (property === undefined) return undefined
    return ts.isPropertyAssignment(property)
      ? { node: property.initializer, env: holder.env }
      : { node: property.name, env: holder.env }
  }

  private unwrap(node: TS.Expression): TS.Expression {
    const ts = this.ts
    return ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
      ? node.expression
      : node
  }

  private template(node: TS.TemplateExpression, env: Env): string | undefined {
    let text = node.head.text
    for (const span of node.templateSpans) {
      const value = this.constant(span.expression, env)
      if (value === undefined) return undefined
      text += String(value) + span.literal.text
    }
    return text
  }

  private concat(node: TS.BinaryExpression, env: Env): string | undefined {
    const left = this.constant(node.left, env)
    const right = this.constant(node.right, env)
    return left === undefined || right === undefined ? undefined : String(left) + String(right)
  }

  bindingOf(node: TS.Expression, env: Env): Binding | undefined {
    if (!this.ts.isIdentifier(node)) return undefined
    const symbol = this.symbolOf(node)
    if (symbol === undefined) return undefined
    return env.get(symbol) ?? this.constBinding(symbol)
  }

  private constBinding(symbol: TS.Symbol): Binding | undefined {
    const ts = this.ts
    const declaration = symbol.valueDeclaration
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined
    const list = declaration.parent
    const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0
    return isConst && declaration.initializer !== undefined
      ? { node: declaration.initializer, env: new Map() }
      : undefined
  }

  /** The function a callee resolves to, with the environment its body closes over. */
  callableOf(
    node: TS.Expression,
    env: Env,
  ): { readonly fn: Callable; readonly env: Env } | undefined {
    const ts = this.ts
    let current = node
    let currentEnv = env
    for (let depth = 0; depth < 16; depth++) {
      while (ts.isParenthesizedExpression(current)) current = current.expression
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        return { fn: current, env: currentEnv }
      }
      const bound = ts.isPropertyAccessExpression(current)
        ? this.property(current, currentEnv)
        : this.bindingOf(current, currentEnv)
      if (bound === undefined) return this.declaredFunction(current)
      current = bound.node
      currentEnv = bound.env
    }
    return undefined
  }

  private declaredFunction(
    node: TS.Expression,
  ): { readonly fn: Callable; readonly env: Env } | undefined {
    const declaration = this.symbolOf(node)?.valueDeclaration
    return declaration !== undefined &&
      this.ts.isFunctionDeclaration(declaration) &&
      declaration.body !== undefined
      ? { fn: declaration, env: new Map() }
      : undefined
  }

  objectLiteral(node: TS.Expression, env: Env): TS.ObjectLiteralExpression | undefined {
    if (this.ts.isObjectLiteralExpression(node)) return node
    const bound = this.ts.isPropertyAccessExpression(node)
      ? this.property(node, env)
      : this.bindingOf(node, env)
    return bound === undefined ? undefined : this.objectLiteral(bound.node, bound.env)
  }

  propertyName(name: TS.PropertyName): string | undefined {
    const ts = this.ts
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
  }

  /** The constant-valued properties of an options object. */
  staticOptions(node: TS.Expression | undefined, env: Env): Record<string, Constant> {
    const options: Record<string, Constant> = {}
    const literal = node === undefined ? undefined : this.objectLiteral(node, env)
    for (const property of literal?.properties ?? []) {
      if (!this.ts.isPropertyAssignment(property)) continue
      const key = this.propertyName(property.name)
      const value = key === undefined ? undefined : this.constant(property.initializer, env)
      if (value !== undefined) options[key!] = value
    }
    return options
  }
}
