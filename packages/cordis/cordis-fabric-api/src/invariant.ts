/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cordis-fabric-api`.
 * @module @deepseek-ai/dsh-cordis-fabric-api/invariant
 */

/* jscpd:ignore-start */
import type { Context } from 'cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cordis-fabric-api'

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
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
