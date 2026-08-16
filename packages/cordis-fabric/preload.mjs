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
 */
import { readFileSync } from 'node:fs'
import { bootstrapFabric } from 'cordis-fabric'

const configPath = process.env.DSH_FABRIC_CONFIG
if (configPath !== undefined && configPath !== '') {
  const descriptors = JSON.parse(readFileSync(configPath, 'utf8'))
  bootstrapFabric(descriptors)
}
