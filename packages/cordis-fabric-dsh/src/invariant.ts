/**
 * Package-owned invariant companion for `cordis-fabric-dsh`.
 * @module cordis-fabric-dsh/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'cordis-fabric-dsh'

/** Cordis companion plugin name. */
export const name = 'cordis-fabric-dsh-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the low-level Fabric registry is process-local
 * machinery whose lifecycle relations are owned by the Cordis service and
 * the transform hooks; every DSH-facing facade delegates to its
 * authoritative domain owner (tools, systemPrompt, commands, agent events,
 * browser command/slot services), which owns the checked relationships.
 * Facade conformance tests and the launcher bootstrap spec pin the
 * delegation instead.
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
