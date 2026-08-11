/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cordis-fabric/api`.
 * @module @deepseek-ai/dsh-cordis-fabric/api/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { HostInvariantInstaller, HostInvariantRegistry } from '../host-contracts.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-cordis-fabric/api'

/** Cordis companion plugin name. */
export const name = 'cordis-fabric-api-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every Fabric API facade delegates to its
 * authoritative domain owner (tools, systemPrompt, commands, agent events,
 * browser command/slot services), which owns the checked relationships;
 * facade conformance tests pin the delegation instead.
 */
const install: HostInvariantInstaller = () => {}

/**
 * Resolve the host registry through Cordis's named service lookup. Keeping
 * this narrow local contract lets the package build without the private host
 * source package; a composed DSH profile still supplies the real
 * `invariants` service.
 * @param ctx - Cordis context carrying the host service.
 * @returns the host invariant registry.
 * @throws {Error} when the companion is loaded without its host service.
 */
function getInvariantRegistry(ctx: Context): HostInvariantRegistry {
  const registry = ctx.get('invariants') as HostInvariantRegistry | undefined
  if (registry === undefined) {
    throw new Error(`invariant companion requires the "invariants" service for ${PACKAGE_NAME}`)
  }
  return registry
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(getInvariantRegistry(ctx).register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
