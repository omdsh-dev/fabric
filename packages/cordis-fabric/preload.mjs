/**
 * fabric-dsh preload: installs the Fabric transformation hooks before the
 * CLI entry module loads. The composed descriptors are passed through
 * DSH_FABRIC_CONFIG (a JSON file written by the fabric-dsh command), so this
 * file stays dependency-free and host-source-agnostic.
 *
 * The host runs `node --import tsx/esm --import <this file> apps/cli/src/bin.ts`;
 * bootstrapFabric registers the loader hooks exactly where the patched
 * profile-boot used to call installFabricBootstrap (boot prepare, before any
 * target import) — except no host source change is involved.
 *
 * The trio resolves from the profile when DSH_FABRIC_PROFILE is set: the
 * profile's installed copy is authoritative at runtime — the Host plugin and
 * every consumer plugin import that same copy, so hooks, binding reports,
 * and handlers share one module instance. (A static import cannot express
 * this: when this file ships inside the installed bundle at
 * cordis-fabric-bundle/packages/cordis-fabric, Node's package self-reference
 * would bind it to that inner copy instead of the profile's.) Without the
 * env the preload resolves from its own location (dev/sandbox layout, tsx
 * src mapping).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const configPath = process.env.DSH_FABRIC_CONFIG
if (configPath !== undefined && configPath !== '') {
  let bootstrapFabric
  const profileDir = process.env.DSH_FABRIC_PROFILE
  if (profileDir !== undefined && profileDir !== '') {
    const resolveFrom = createRequire(pathToFileURL(join(profileDir, 'package.json')))
    ;({ bootstrapFabric } = await import(pathToFileURL(resolveFrom.resolve('cordis-fabric'))))
  } else {
    ;({ bootstrapFabric } = await import('cordis-fabric'))
  }
  const descriptors = JSON.parse(readFileSync(configPath, 'utf8'))
  bootstrapFabric(descriptors)
}
