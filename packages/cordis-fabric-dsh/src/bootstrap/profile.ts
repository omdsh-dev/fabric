/**
 * DSH profile bootstrap for the Fabric layer: read the composed
 * `cordis-fabric` row's static patch descriptors from a profile's rows and
 * install the load-time transformation hooks before any target plugin
 * module imports, plus the post-boot binding verification. This is the DSH
 * assembly half of `cordis-fabric` — the pure package only knows how to
 * install hooks from descriptors, not where a deployment composes them.
 * @module @oh-my-dsh/cordis-fabric-dsh/bootstrap/profile
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FabricPatchStub } from '@oh-my-dsh/cordis-fabric'

/** One composed profile row's config surface (the loader row shape). */
export interface FabricProfileRow {
  name?: string
  config?: unknown
  disabled?: boolean
}

/** The composed profile rows this bootstrap reads (id → row). */
export type FabricProfileRows = ReadonlyMap<string, FabricProfileRow>

/** One Fabric row's config surface: the namespaced patch stubs. */
interface FabricRowConfig {
  fabric?: { patches?: unknown }
}

/**
 * Read the composed `cordis-fabric` row's patch stubs from the dedicated
 * `config.fabric.patches` section. The row's `disabled` flag governs
 * mounting the plugin only; the bootstrap reads this section whenever it is
 * present.
 * @param rowConfig - the row's config, when the row exists.
 * @returns the patch descriptors, or undefined when none are declared.
 */
function fabricDescriptors(rowConfig: FabricRowConfig | undefined): unknown {
  return rowConfig?.fabric?.patches
}

/**
 * Install the Fabric transformation hooks from the composed profile rows.
 *
 * The optional `cordis-fabric` row may carry static patch descriptors under
 * `config.fabric.patches` (id/target/operation — handlers are trusted code
 * bound at registration). The hooks must exist before any target plugin is
 * imported, so this runs in the boot `prepare` phase, before the config tree
 * mounts. The row's `disabled` flag governs mounting the plugin (the browser
 * roster keeps the row disabled by default); it does not suppress the
 * load-time bootstrap — patches from the composed row apply whenever the row
 * carries them. When the row is absent or carries no patches, nothing is
 * installed.
 * @param rows - the fully composed profile rows for this invocation.
 */
export async function installFabricBootstrap(rows: FabricProfileRows): Promise<void> {
  const fabricRow = [...rows].find(([id]) => id === 'cordis-fabric')?.[1]
  const descriptors = fabricDescriptors(fabricRow?.config as FabricRowConfig | undefined)
  if (!Array.isArray(descriptors) || descriptors.length === 0) return
  const { bootstrapFabric } = await import('@oh-my-dsh/cordis-fabric')
  bootstrapFabric(descriptors as FabricPatchStub[])
}

/**
 * Verify the composed profile's `required` Fabric patches bound at load
 * time. Runs after the config tree mounts (boot completion), when every
 * target module has been imported and the transformation hooks recorded
 * their bindings; a required patch that bound nothing fails the launch
 * loud, naming the patch id and its target, instead of shipping an inert
 * transform.
 * @param rows - the fully composed profile rows for this invocation.
 */
export async function checkFabricRequiredPatches(rows: FabricProfileRows): Promise<void> {
  const fabricRow = [...rows].find(([id]) => id === 'cordis-fabric')?.[1]
  const descriptors = fabricDescriptors(fabricRow?.config as FabricRowConfig | undefined)
  if (!Array.isArray(descriptors) || descriptors.length === 0) return
  const { checkRequiredPatches } = await import('@oh-my-dsh/cordis-fabric')
  checkRequiredPatches(descriptors as FabricPatchStub[])
}

/** The live loader's composed entries, read as the id → row map. */
function composedFabricRows(ctx: Context): FabricProfileRows {
  const rows = new Map<string, FabricProfileRow>()
  const loader = (ctx as unknown as {
    loader?: { entries?: () => Iterable<{ options?: Partial<{ id?: unknown; config?: unknown; disabled?: unknown }> }> }
  }).loader
  for (const entry of loader?.entries?.() ?? []) {
    const options = entry.options
    if (options !== undefined && typeof options.id === 'string') {
      const row: FabricProfileRow = { config: options.config }
      if (typeof options.disabled === 'boolean') row.disabled = options.disabled
      rows.set(options.id, row)
    }
  }
  return rows
}

/**
 * Fabric-required rows: rows (the cordis-fabric carrier aside) whose config
 * declares `config.fabric.patches`. They ship disabled and the fabric-dsh
 * launcher enables them; the post-boot check uses this list to catch a boot
 * where such a row is enabled WITHOUT the hooks (a misconfigured plain
 * `dsh` launch) or where the hooks are present but a required patch bound
 * nothing.
 */
function fabricRequiredRows(rows: FabricProfileRows): Array<{ id: string; disabled?: boolean }> {
  const out: Array<{ id: string; disabled?: boolean }> = []
  for (const [id, row] of rows) {
    if (id === 'cordis-fabric') continue
    const raw = fabricDescriptors(row?.config as FabricRowConfig | undefined)
    if (Array.isArray(raw) && raw.length > 0) {
      const entry: { id: string; disabled?: boolean } = { id }
      if (typeof row?.disabled === 'boolean') entry.disabled = row.disabled
      out.push(entry)
    }
  }
  return out
}

/** One recorded load-time binding, as the runtime reports it. */
interface FabricBindingView {
  module: string
  file: string
  nodes: number
}

/**
 * Print the post-boot hook summary: which patch bound to which target file.
 * Runs under fabric-dsh after the required check, so the boot output lists
 * exactly what the Fabric layer hooked (or that a target never loaded).
 * Written straight to stderr like the preload's launch marker, so no
 * logging-level filter can hide it.
 */
function logHookSummary(descriptors: readonly FabricPatchStub[], runtime: { bindingsOf: (id: string) => FabricBindingView[] }): void {
  if (descriptors.length === 0) return
  const lines: string[] = []
  for (const patch of descriptors) {
    const bindings = runtime.bindingsOf(patch.id)
    if (bindings.length === 0) {
      lines.push(`  not hooked ${patch.id} (target not loaded at boot)`)
      continue
    }
    for (const binding of bindings) {
      lines.push(`  hooked ${patch.id} → ${binding.module} ${binding.file} (${binding.nodes} node(s))`)
    }
  }
  process.stderr.write(`fabric: hooks summary — ${descriptors.length} patch(es):\n${lines.join('\n')}\n`)
}

/**
 * Boot-completion patch check for both launch modes — the Fabric gate.
 * The launcher (fabric-dsh) writes the composed descriptors to
 * $FABRIC_CONFIG, injects the loader hooks through a preload, and
 * enables the Fabric-required rows through a generated overlay; this plugin
 * schedules the check one tick after mount (all tree entries have applied
 * by then).
 *
 * - fabric ON ($FABRIC_CONFIG present): a `required` patch that bound
 *   nothing fails the launch loud, like the patched profile-boot used to;
 *   on success the hook summary is logged;
 * - fabric OFF (plain `dsh`): Fabric-required rows stay disabled by default
 *   and the boot skips them (the dependent plugins simply do not load). If
 *   one is nevertheless ENABLED, the hooks are absent and its transforms
 *   can never run — the boot fails loud instead of silently degrading.
 * @param ctx - the owning context (effects ride its fiber).
 */
export function scheduleRequiredPatchCheck(ctx: Context): void {
  const configPath = process.env.FABRIC_CONFIG
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        if (configPath !== undefined && configPath !== '') {
          // fabric ON: the exact file the preload installed from is the
          // truth of what was bound.
          const { readFileSync } = await import('node:fs')
          const { checkRequiredPatches, flushBindingReports, runtime } = await import('@oh-my-dsh/cordis-fabric')
          const descriptors = JSON.parse(readFileSync(configPath, 'utf8')) as FabricPatchStub[]
          // The async hook path delivers binding reports over a port; wait
          // for them before judging (no-op on the synchronous path).
          await flushBindingReports(1000)
          checkRequiredPatches(descriptors)
          logHookSummary(descriptors, runtime as unknown as { bindingsOf: (id: string) => FabricBindingView[] })
          return
        }
        // fabric OFF: gate on Fabric-required rows that are enabled anyway.
        const enabled = fabricRequiredRows(composedFabricRows(ctx)).filter(({ disabled }) => disabled === false)
        if (enabled.length === 0) return
        throw new Error(
          'fabric: rows ' + enabled.map(({ id }) => id).join(', ')
          + ' declare Fabric patches but are enabled on a plain-dsh boot (the hooks are not installed); '
          + 'launch through fabric-dsh, which enables Fabric-required rows itself',
        )
      })()
    }, 0)
    return () => { clearTimeout(timer) }
  }, 'fabric: required patch check')
}
