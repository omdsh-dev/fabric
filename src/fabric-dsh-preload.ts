/**
 * fabric-dsh preload: installs the Fabric transformation hooks before the
 * CLI entry module loads. The composed descriptors are passed through
 * DSH_FABRIC_CONFIG (a JSON file written by the fabric-dsh command), so this
 * file stays host-source-agnostic.
 *
 * Source launches run `node --import tsx/esm --import <this file> apps/cli/src/bin.ts`;
 * installed launches use the compiled JavaScript artifact emitted beside the
 * launcher. The source uses only erasable TypeScript syntax so tsx can load it
 * directly. bootstrapFabric registers the loader hooks exactly where the
 * patched profile-boot used to call installFabricBootstrap (boot prepare,
 * before any target import) — except no host source change is involved.
 *
 * The trio resolves from the profile when DSH_FABRIC_PROFILE is set: the
 * profile's installed copy is authoritative at runtime — the Host plugin and
 * every consumer plugin import that same copy, so hooks, binding reports,
 * and handlers share one module instance. (A static import cannot express
 * this: when this file ships inside the installed bundle, Node's package
 * self-reference would bind it to an inner copy instead of the profile's.)
 * Without the env the preload resolves from its own location (dev/sandbox
 * layout, tsx source mapping).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FabricPatchStub } from '@oh-my-dsh/cordis-fabric'

type BootstrapFabric = (descriptors: FabricPatchStub[]) => unknown

const configPath = process.env.DSH_FABRIC_CONFIG
if (configPath !== undefined && configPath !== '') {
  let bootstrapFabric: BootstrapFabric
  const profileDir = process.env.DSH_FABRIC_PROFILE
  if (profileDir !== undefined && profileDir !== '') {
    const resolveFrom = createRequire(pathToFileURL(join(profileDir, 'package.json')))
    ;({ bootstrapFabric } = await import(pathToFileURL(resolveFrom.resolve('@oh-my-dsh/cordis-fabric')).href))
  } else {
    ;({ bootstrapFabric } = await import('@oh-my-dsh/cordis-fabric'))
  }
  const descriptors = JSON.parse(readFileSync(configPath, 'utf8')) as FabricPatchStub[]
  bootstrapFabric(descriptors)
  // The launch marker: only a fabric-dsh launch reaches this line, so the
  // boot output always tells the user whether this is a fabric-enabled
  // launch or a plain dsh one.
  process.stderr.write(`fabric-dsh: Fabric hooks installed (${descriptors.length} descriptor(s)) — this launch is fabric-enabled\n`)
}
