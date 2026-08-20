import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Preload injection equivalence: the fabric-dsh launcher runs the host CLI as
 * `node --import tsx/esm --import <fabric-dsh-preload.ts> bin.ts` with
 * DSH_FABRIC_CONFIG pointing at the composed descriptors. These cases spawn
 * that exact launcher shape and verify the preload bootstraps the Fabric
 * hooks before the entry module imports its targets — the same guarantee the
 * removed host patch (profile-boot installFabricBootstrap) used to provide.
 */
const preload = fileURLToPath(new URL('../../../../src/fabric-dsh-preload.ts', import.meta.url))
const entry = fileURLToPath(new URL('../fixtures/preload-entry.mjs', import.meta.url))

const patch = {
  id: 'preload/multiply-add',
  target: {
    module: 'fabric-target-fixture',
    versionRange: '^1.0.0',
    filePath: 'index.mjs',
    functionQuery: { functionName: 'add', kind: 'Sync' },
  },
  operation: 'before',
  required: true,
}

const tempDir = mkdtempSync(join(tmpdir(), 'dsh-fabric-preload-'))
const configPath = join(tempDir, 'fabric-config.json')
writeFileSync(configPath, JSON.stringify([patch]))

afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

/** Spawn the fabric-dsh launcher shape and return the entry's stdout. */
function run(configEnv: string | undefined, profileEnv?: string): { stdout: string; stderr: string } {
  // tsconfig (whose paths lack these packages); children must resolve
  // against this repo's own tsconfig so source-mode imports stay on src.
  const childEnv: NodeJS.ProcessEnv = { ...process.env }
  if (configEnv === undefined) delete childEnv.DSH_FABRIC_CONFIG
  else childEnv.DSH_FABRIC_CONFIG = configEnv
  if (profileEnv === undefined) delete childEnv.DSH_FABRIC_PROFILE
  else childEnv.DSH_FABRIC_PROFILE = profileEnv
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--import', preload, entry], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    encoding: 'utf8',
    env: childEnv,
  })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return { stdout: result.stdout, stderr: result.stderr }
}

describe('cordis-fabric preload injection (fabric-dsh launcher shape)', () => {
  it('bootstraps the hooks before the entry imports its targets', () => {
    const out = run(configPath)
    expect(out.stdout).toContain('BEFORE add(2,3)=5 AFTER add(2,3)=23')
  })

  it('stays inert without DSH_FABRIC_CONFIG (host runs unmodified)', () => {
    const out = run(undefined)
    expect(out.stdout).toContain('NO-CONFIG bindings=0 add(2,3)=5')
  })

  it('prints the fabric-enabled launch marker only when the hooks install', () => {
    const enabled = run(configPath)
    expect(enabled.stderr).toContain('fabric-dsh: Fabric hooks installed (1 descriptor(s))')
    const inert = run(undefined)
    expect(inert.stderr).not.toContain('fabric-dsh:')
  })

  it('resolves the trio from the profile when DSH_FABRIC_PROFILE is set', () => {
    // A stub "cordis-fabric" under the profile dir records the descriptor
    // count its bootstrapFabric received; the preload must import THIS copy
    // (the profile's installed copy is authoritative at runtime) rather
    // than the one beside the preload.
    const profileDir = join(tempDir, 'profile')
    const stubDir = join(profileDir, 'node_modules', '@oh-my-dsh', 'cordis-fabric')
    mkdirSync(stubDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{}\n')
    writeFileSync(join(stubDir, 'package.json'), JSON.stringify({
      name: '@oh-my-dsh/cordis-fabric', version: '1.0.0', type: 'module', exports: { '.': './index.js' },
    }))
    writeFileSync(join(stubDir, 'index.js'), [
      'export function bootstrapFabric(descriptors) {',
      '  globalThis.__fabricProfileMarker = { count: descriptors.length }',
      '}',
      '',
    ].join('\n'))
    const out = run(configPath, profileDir)
    expect(out.stdout).toContain('PROFILE-MARKER count=1')
  })
})
