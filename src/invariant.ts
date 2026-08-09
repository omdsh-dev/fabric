/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cordis-fabric`.
 * @module @deepseek-ai/dsh-cordis-fabric/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cordis-fabric'

/** Cordis companion plugin name. */
export const name = 'cordis-fabric-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Fabric registry is process-local machinery whose
 * lifecycle relations are owned by the Cordis service and the transform
 * hooks; there is no independent event or data stream to check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
