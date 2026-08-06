/**
 * Browser build transform for Fabric: a bundler-agnostic code transform that
 * applies the Fabric rewrite to target modules during a client bundle build.
 *
 * The upstream `createCodeTransformer` adapter resolves module identity
 * through `module-details-from-path`, which requires a `node_modules`
 * boundary. Client bundles build from repository source paths, so this
 * factory accepts a caller-provided identity resolver: map a module id to
 * `{ name, version, path }` (package name, version, package-relative path)
 * and the Orchestrion matcher runs exactly as it does for the Node loader.
 *
 * Like the Node path, the transform parses emitted JavaScript: TypeScript
 * sources must be compiled before transformation, or the parse fails loudly.
 * @module @deepseek-ai/dsh-cordis-fabric/browser-transform
 */

import { create, type InstrumentationConfig } from '@apm-js-collab/code-transformer'
import parse from 'module-details-from-path'
import { relative } from 'node:path'
import ts from 'typescript'
import { getPackageVersion, detectModuleType } from './module-identity.ts'
import { orderInstrumentations } from './node-loader.ts'
import { registerFabricTransform } from './transform.ts'
import type { FabricInstrumentationConfig } from './node-loader.ts'

/**
 * Strip TypeScript type annotations so the Orchestrion transformer (a plain
 * JavaScript parser) can parse `.ts`/`.tsx` sources. Type stripping only
 * removes annotations; the emitted JavaScript keeps module and function
 * shapes intact.
 * @param code - TypeScript source.
 * @returns the equivalent JavaScript source.
 */
function stripTypes(code: string, fileName: string): string {
  const output = ts.transpileModule(code, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      // JSX must be emitted as calls (the Orchestrion parser cannot read JSX
      // syntax). The automatic runtime keeps the output self-contained:
      // sources using the modern transform (no React import) get a
      // `react/jsx-runtime` import instead of referencing an undefined
      // `React`, while classic-runtime sources keep their explicit
      // `React.createElement` calls and React import untouched.
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  return output.outputText
}

/** Module identity the matcher needs for one module id. */
export interface ModuleIdentity {
  /** npm package name. */
  name: string
  /** Installed or declared package version. */
  version: string
  /** File path relative to the package root. */
  path: string
}

/** Map a bundler module id to its package identity; `undefined` skips it. */
export type IdentityResolver = (id: string) => ModuleIdentity | undefined

/**
 * Resolve repository source modules: any id under `packageRoot` maps to the
 * given package name and version. This is the resolver client plugin builds
 * use, since their sources live at `packages/<group>/<name>/src/...`.
 * @param packageName - the npm package name of the built plugin.
 * @param packageRoot - absolute source root of the package.
 * @param version - package version stamped into transformed calls.
 * @returns an identity resolver for that package's sources.
 */
export function repoSourceResolver(packageName: string, packageRoot: string, version: string): IdentityResolver {
  const root = packageRoot.endsWith('/') ? packageRoot : `${packageRoot}/`
  return (id) => {
    if (!id.startsWith(root)) return undefined
    return { name: packageName, version, path: relative(packageRoot, id).replaceAll('\\', '/') }
  }
}

/**
 * Resolve installed-package modules through `node_modules` boundaries.
 * @returns an identity resolver for module ids inside any installed package.
 */
export function nodeModulesResolver(): IdentityResolver {
  return (id) => {
    const details = parse(id)
    if (!details) return undefined
    return { name: details.name, version: getPackageVersion(details.basedir), path: details.path }
  }
}

/**
 * A transformed module: rewritten source plus an optional source map.
 */
export interface TransformOutput {
  /** Rewritten source code. */
  code: string
  /** Source map when the underlying transformer produced one. */
  map?: string
}

/**
 * Build a bundler transform for Fabric instrumentations.
 *
 * The returned function can be wired into a bundler's `transform` hook
 * (tsdown/Rolldown, Rollup, Vite); it returns `null` for modules the
 * instrumentations do not target.
 * @param instrumentations - Fabric instrumentations (see
 * {@link patchInstrumentation}).
 * @param resolve - module identity resolver for the build's source layout.
 * @returns a transform function `(code, id) => output | null`.
 */
export function createBrowserTransform(
  instrumentations: FabricInstrumentationConfig[],
  resolve: IdentityResolver,
): (code: string, id: string) => TransformOutput | null {
  const matcher = create(orderInstrumentations(instrumentations))
  registerFabricTransform(matcher)

  return (code, id) => {
    const identity = resolve(id)
    if (!identity) return null
    const transformer = matcher.getTransformer(identity.name, identity.version, identity.path)
    if (!transformer) return null
    // TypeScript sources are stripped to plain JavaScript first; the source
    // map is intentionally not chained through the strip step.
    const source = /\.tsx?$/.test(id) ? stripTypes(code, id) : code
    const result = transformer.transform(source, detectModuleType(id))
    return result.map === undefined ? { code: result.code } : { code: result.code, map: result.map }
  }
}

export type { InstrumentationConfig }
