/**
 * Orchestrion custom transform for Fabric. Instead of the built-in tracing
 * transform (which always runs the original body inside its traced closure,
 * making `around`/`replace` vetoes impossible), this transform rewrites the
 * matched function to call the Fabric bridge directly.
 *
 * The function keeps its name, `.length`, and `this` binding. The original
 * body moves into a `traced` closure that replays it via `apply(this, args)`
 * over the reconstructed arguments array, and the body becomes a single
 * conditional return: `globalThis[<bridge key>]` present → publish the call,
 * absent → delegate to the traced body untouched. The bridge-absent fallback
 * makes transformed code safe before the bootstrap runs (and in browsers
 * before the bridge is installed), at the cost of the patch only taking
 * effect for calls that happen after the bridge exists.
 *
 * Matched nodes must be function declarations, function expressions, methods,
 * or arrow functions with a block (or, for arrows, expression) body. Arrows
 * are supported only with plain identifier parameters: they have no own
 * `arguments` binding, so the argument array is rebuilt from the parameter
 * list and `this` stays lexical.
 * @module @deepseek-ai/dsh-cordis-fabric/transform
 */

import type { CustomTransform } from '@apm-js-collab/code-transformer'
import { create } from '@apm-js-collab/code-transformer'
import type {
  ArrowFunctionExpression, Expression, FunctionDeclaration, FunctionExpression,
  Node, Pattern, Program, Property, Statement,
} from 'estree'
import { GLOBAL_BRIDGE_KEY } from './bridge.ts'

/** Identifier prefixes injected by this transform. */
const ARGS = 'dshFabricArguments'
const TRACED = 'dshFabricTraced'
const CALL = 'dshFabricCall'

/**
 * Register the Fabric custom transform on an Orchestrion matcher. Both the
 * Node loader and the browser build register the same operator, which reads
 * the patch id and operation from the merged state.
 * @param matcher - the Orchestrion matcher to extend.
 */
export function registerFabricTransform(matcher: ReturnType<typeof create>): void {
  matcher.addTransform('fabric', (state, node, parent, ancestry) => {
    const patchId = state.fabricPatchId
    const operation = state.fabricOperation
    if (typeof patchId !== 'string' || typeof operation !== 'string') {
      throw new Error('fabric: transform config must carry fabricPatchId and fabricOperation strings')
    }
    createFabricTransform(patchId, operation)(state, node, parent, ancestry)
  })
}

/** One matched function with its parameter list. */
interface MatchedFunction {
  /** The function-like node (MethodDefinition/Property unwrapped). */
  node: FunctionDeclaration | FunctionExpression | ArrowFunctionExpression
  /** Whether the node is an arrow function (lexical `this`/`arguments`). */
  arrow: boolean
  /** The function body (block, or an expression for expression-bodied arrows). */
  body: Node | undefined
  /** The parameter list. */
  params: Pattern[]
  /** Whether the node is an async function (its body may await). */
  async: boolean
  /** Whether the node is a generator function (its body may yield). */
  generator: boolean
}

/**
 * Build the Fabric custom transform for a patch.
 * @param patchId - the patch id stamped into the generated call.
 * @param operation - the operation kind stamped into the generated call.
 * @returns the custom transform to register on the matcher.
 */
export function createFabricTransform(
  patchId: string,
  operation: string,
): CustomTransform {
  return (_state, node, _parent, ancestry) => {
    const matched = matchFunction(node)
    if (!matched) return
    const program = ancestry[ancestry.length - 1]
    if (!program || program.type !== 'Program') return

    // Expression-bodied arrows get a synthesized block body so the injected
    // statements have a statement list to live in. Both the node and the
    // local `body` reference must move to the new block.
    if (!matched.body) return
    if (matched.body.type !== 'BlockStatement') {
      const statements: Statement[] = [{ type: 'ReturnStatement', argument: matched.body as Expression }]
      const synthesized: Node = { type: 'BlockStatement', body: statements }
      matched.node.body = synthesized
      matched.body = synthesized
    }
    const block = matched.body as { type: 'BlockStatement'; body: Statement[] }
    const statements = block.body

    // Injected names must not shadow identifiers the file already uses (the
    // traced body keeps resolving through the transformed function's scope);
    // the per-program allocator is seeded with every identifier in the file.
    const refs = namesOf(program)
    const argsName = refs.unique(ARGS)
    const tracedName = refs.unique(TRACED)
    const callName = refs.unique(CALL)

    // const dshFabricArguments = <args>
    // Regular functions rebuild from their own `arguments` object; arrows have
    // no own binding, so the array is assembled from the (plain identifier)
    // parameter names — handler mutations then flow through apply() to the
    // replayed body.
    const args: Statement = matched.arrow
      ? {
        type: 'VariableDeclaration',
        kind: 'const',
        declarations: [{
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: argsName },
          init: {
            type: 'ArrayExpression',
            elements: (matched.params as { type: 'Identifier'; name: string }[])
              .map(param => ({ type: 'Identifier', name: param.name })),
          },
        }],
      }
      : {
        type: 'VariableDeclaration',
        kind: 'const',
        declarations: [{
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: argsName },
          init: {
            type: 'CallExpression',
            optional: false,
            callee: {
              type: 'MemberExpression',
              computed: false,
              optional: false,
              object: {
                type: 'MemberExpression',
                computed: false,
                optional: false,
                object: {
                  type: 'MemberExpression',
                  computed: false,
                  optional: false,
                  object: { type: 'Identifier', name: 'Array' },
                  property: { type: 'Identifier', name: 'prototype' },
                },
                property: { type: 'Identifier', name: 'slice' },
              },
              property: { type: 'Identifier', name: 'call' },
            },
            arguments: [{ type: 'Identifier', name: 'arguments' }],
          },
        }],
      }

    // const dshFabricTraced = () => (function () { <original body> }).apply(this, dshFabricArguments)
    const traced: Statement = {
      type: 'VariableDeclaration',
      kind: 'const',
      declarations: [{
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: tracedName },
        init: {
          type: 'ArrowFunctionExpression',
          expression: false,
          generator: false,
          async: false,
          params: [],
          body: {
            type: 'BlockStatement',
            body: [{
              type: 'ReturnStatement',
              argument: {
                type: 'CallExpression',
                optional: false,
                callee: {
                  type: 'MemberExpression',
                  computed: false,
                  optional: false,
                  object: {
                    type: 'FunctionExpression',
                    id: null,
                    params: matched.params,
                    body: { type: 'BlockStatement', body: statements },
                    generator: matched.generator,
                    async: matched.async,
                  },
                  property: { type: 'Identifier', name: 'apply' },
                },
                arguments: [
                  { type: 'ThisExpression' },
                  { type: 'Identifier', name: argsName },
                ],
              },
            }],
          },
        },
      }],
    }

    // const dshFabricCall = { id, operation, arguments: dshFabricArguments, self, traced }
    const call: Statement = {
      type: 'VariableDeclaration',
      kind: 'const',
      declarations: [{
        type: 'VariableDeclarator',
        id: { type: 'Identifier', name: callName },
        init: {
          type: 'ObjectExpression',
          properties: [
            property('id', { type: 'Literal', value: patchId }),
            property('operation', { type: 'Literal', value: operation }),
            property('arguments', { type: 'Identifier', name: argsName }),
            property('self', { type: 'ThisExpression' }),
            property('traced', { type: 'Identifier', name: tracedName }),
          ],
        },
      }],
    }

    // return globalThis["__dshFabricBridge"]
    //   ? globalThis["__dshFabricBridge"].publish(dshFabricCall)
    //   : dshFabricTraced()
    const bridge = (): Expression => ({
      type: 'MemberExpression',
      computed: true,
      optional: false,
      object: { type: 'Identifier', name: 'globalThis' },
      property: { type: 'Literal', value: GLOBAL_BRIDGE_KEY },
    })
    const publish: Statement = {
      type: 'ReturnStatement',
      argument: {
        type: 'ConditionalExpression',
        test: bridge(),
        consequent: {
          type: 'CallExpression',
          optional: false,
          callee: {
            type: 'MemberExpression',
            computed: false,
            optional: false,
            object: bridge(),
            property: { type: 'Identifier', name: 'publish' },
          },
          arguments: [{ type: 'Identifier', name: callName }],
        },
        alternate: {
          type: 'CallExpression',
          optional: false,
          callee: { type: 'Identifier', name: tracedName },
          arguments: [],
        },
      },
    }

    block.body = [args, traced, call, publish]
  }
}

/**
 * Extract a transformable function from the matched node. Class methods and
 * object properties are wrapped; the actual function lives in their `value`.
 * @param node - the matched AST node.
 * @returns the function with its body and params, or `undefined` to skip.
 */
function matchFunction(node: Node): MatchedFunction | undefined {
  const fn = node.type === 'MethodDefinition' || node.type === 'Property'
    ? (node as { value?: unknown }).value
    : node
  if (typeof fn !== 'object' || fn === null) return undefined
  const type = (fn as { type?: string }).type
  if (type !== 'FunctionDeclaration' && type !== 'FunctionExpression' && type !== 'ArrowFunctionExpression') {
    return undefined
  }
  const functionNode = fn as FunctionDeclaration | FunctionExpression | ArrowFunctionExpression
  const arrow = type === 'ArrowFunctionExpression'
  // Generator functions are skipped: the injected `return publish(...)` would
  // make the outer generator return instead of yielding, changing iteration
  // semantics for callers.
  if (functionNode.generator) return undefined
  if (arrow) {
    // Arrows rebuild arguments from their parameter names; only plain
    // identifier parameters are supported (no rest, defaults, or destructuring).
    if (!functionNode.params.every(param => param.type === 'Identifier')) return undefined
    // An arrow body referencing the enclosing `arguments` object would break
    // when moved into the traced regular function (its own `arguments` would
    // shadow the outer one); skip rather than change semantics.
    if (referencesOuterArguments(functionNode.body)) return undefined
  }
  return {
    node: functionNode,
    arrow,
    body: (functionNode as { body?: unknown }).body as Node | undefined,
    params: functionNode.params,
    async: functionNode.async ?? false,
    generator: functionNode.generator ?? false,
  }
}

/**
 * Whether an arrow body references the enclosing scope's `arguments` object.
 * Nested non-arrow functions own their `arguments` and are not descended
 * into; nested arrows still resolve lexically and are descended into.
 * @param node - the arrow's body.
 * @returns true when the body reads the outer `arguments`.
 */
function referencesOuterArguments(node: Node | undefined): boolean {
  if (!node) return false
  if (node.type === 'Identifier') return node.name === 'arguments'
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') return false
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue
    // Property keys and non-computed member properties are not references.
    if (key === 'key' && (node.type === 'Property' || node.type === 'MethodDefinition')) continue
    if (key === 'property' && node.type === 'MemberExpression' && !node.computed) continue
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (typeof child === 'object' && child !== null && referencesOuterArguments(child as Node)) return true
      }
    } else if (typeof value === 'object' && value !== null) {
      if (referencesOuterArguments(value as Node)) return true
    }
  }
  return false
}

/** A `key: value` object property. */
function property(key: string, value: Expression): Property {
  return {
    type: 'Property',
    kind: 'init',
    method: false,
    shorthand: false,
    computed: false,
    key: { type: 'Identifier', name: key },
    value,
  }
}

/**
 * Per-program identifier allocator: injected names are unique within one
 * transformed file and reused deterministically across files. The name set is
 * seeded with every identifier of the program on first use, so an injected
 * name can never shadow a reference the traced body keeps resolving.
 * @param program - the matched file's Program node.
 * @returns a `unique(base)` allocator for that file.
 */
function namesOf(program: Program) {
  let names = programNames.get(program)
  if (!names) {
    names = new Set<string>()
    collectIdentifiers(program, names)
    programNames.set(program, names)
  }
  return {
    unique(base: string): string {
      let name = base
      let i = 0
      while (names.has(name)) name = `${base}_${++i}`
      names.add(name)
      return name
    },
  }
}

/**
 * Collect every identifier name in a node into the given set. The walk is
 * deliberately broad (property keys, labels, and member properties included):
 * over-conservative renaming is safe, while a missed variable reference
 * would silently change what the moved body resolves.
 * @param node - the AST node to walk.
 * @param out - the set receiving identifier names.
 */
function collectIdentifiers(node: Node, out: Set<string>): void {
  if (node.type === 'Identifier') {
    out.add(node.name)
    return
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (typeof child === 'object' && child !== null) collectIdentifiers(child as Node, out)
      }
    } else if (typeof value === 'object' && value !== null) {
      collectIdentifiers(value as Node, out)
    }
  }
}

/** Per-file injected-name sets, keyed by the transformed Program node. */
const programNames = new WeakMap<Program, Set<string>>()
