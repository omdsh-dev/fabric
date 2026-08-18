import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Installed-mode launcher resolution: without --source, fabric-dsh runs a
 * registry-installed @deepseek-ai/dsh — the published lib/bin.js is plain
 * ESM, so no tsx and no checkout. The CLI resolves from DSH_CLI, the
 * caller's project dependencies, or a PATH shim (symlink shims and pnpm's
 * cmd-shim script form alike). These offline fixtures stand in for each
 * resolution path; the stub `cordis-fabric` in the profile records what the
 * preload delivered, and the stub `@deepseek-ai/dsh-app-boot` records the
 * pre-boot module-fallback heal.
 */
const launcher = fileURLToPath(new URL('../../../scripts/fabric-dsh.mjs', import.meta.url))
const launcherModules = fileURLToPath(new URL('../../../scripts/fabric-dsh/', import.meta.url))
const fabricPackage = fileURLToPath(new URL('../', import.meta.url))

const tempDir = mkdtempSync(join(tmpdir(), 'dsh-fabric-installed-'))
const home = join(tempDir, 'home')
const profileDir = join(home, 'profiles', 't1')
const webProfileDir = join(home, 'profiles', 'web')
const proj = join(tempDir, 'proj')
const dshPkg = join(proj, 'node_modules', '@deepseek-ai', 'dsh')
const binFile = join(dshPkg, 'lib', 'bin.js')
const shimDir = join(tempDir, 'shims')
const scriptShimDir = join(tempDir, 'script-shims')

mkdirSync(join(dshPkg, 'lib'), { recursive: true })
writeFileSync(join(dshPkg, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh', version: '9.9.9', type: 'module', bin: { dsh: 'lib/bin.js' },
}, null, 2))
writeFileSync(binFile, [
  "console.log(`FAKE-DSH argv=${JSON.stringify(process.argv.slice(2))}`)",
  "console.log(`FAKE-DSH config=${process.env.DSH_FABRIC_CONFIG !== undefined} profile=${process.env.DSH_FABRIC_PROFILE}`)",
  '',
].join('\n'))

// The CLI's own dependencies: the launcher falls back to them for js-yaml
// (not in the profile) and resolves dsh-app-boot from the CLI's real
// location for the pre-boot heal.
mkdirSync(join(proj, 'node_modules', '@deepseek-ai', 'dsh-app-boot'), { recursive: true })
writeFileSync(join(proj, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh-app-boot', version: '1.0.0', type: 'module', main: 'index.js',
}))
writeFileSync(join(proj, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'index.js'),
  "export function healProfilesModuleFallback(anchor) { console.log('HEAL-MARK ' + anchor) }\n")
mkdirSync(join(proj, 'node_modules', 'js-yaml'), { recursive: true })
writeFileSync(join(proj, 'node_modules', 'js-yaml', 'package.json'), JSON.stringify({
  name: 'js-yaml', version: '4.0.0', main: 'index.js',
}))
writeFileSync(join(proj, 'node_modules', 'js-yaml', 'index.js'), [
  'class Type { constructor() {} }',
  'const DEFAULT_SCHEMA = { extend: () => ({}) }',
  'const load = () => []',
  "const dump = () => '[]\\n'",
  'module.exports = { Type, DEFAULT_SCHEMA, load, dump }',
  '',
].join('\n'))

// The profile's installed trio copy (the preload resolves it through
// DSH_FABRIC_PROFILE): a stub cordis-fabric recording the descriptor count.
const stubFabric = join(profileDir, 'node_modules', 'cordis-fabric')
mkdirSync(stubFabric, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), '{}\n')
writeFileSync(join(stubFabric, 'package.json'), JSON.stringify({
  name: 'cordis-fabric', version: '1.0.0', type: 'module', exports: { '.': './index.js' },
}))
writeFileSync(join(stubFabric, 'index.js'),
  'export function bootstrapFabric(descriptors) { console.log(`PROFILE-BOOT count=${descriptors.length}`) }\n')

// An installed bundle bin derives `web` from this exact profile path. Keep
// this profile real (not a symlink), so the launcher exercises that path
// inference rather than only the generic installed mode.
mkdirSync(join(webProfileDir, 'node_modules'), { recursive: true })
writeFileSync(join(webProfileDir, 'package.json'), '{}\n')
symlinkSync(stubFabric, join(webProfileDir, 'node_modules', 'cordis-fabric'))
const installedBundle = join(webProfileDir, 'node_modules', 'cordis-fabric-bundle')
const installedLauncher = join(installedBundle, 'scripts', 'fabric-dsh.mjs')
mkdirSync(join(installedBundle, 'scripts'), { recursive: true })
mkdirSync(join(installedBundle, 'packages'), { recursive: true })
copyFileSync(launcher, installedLauncher)
cpSync(launcherModules, join(installedBundle, 'scripts', 'fabric-dsh'), { recursive: true })
symlinkSync(fabricPackage, join(installedBundle, 'packages', 'cordis-fabric'))
mkdirSync(join(webProfileDir, 'node_modules', '.bin'), { recursive: true })
symlinkSync('../cordis-fabric-bundle/scripts/fabric-dsh.mjs', join(webProfileDir, 'node_modules', '.bin', 'fabric-dsh'))

// PATH shims: a symlink (npm-global style) and a cmd-shim script (pnpm).
mkdirSync(shimDir, { recursive: true })
symlinkSync(binFile, join(shimDir, 'dsh'))
mkdirSync(scriptShimDir, { recursive: true })
writeFileSync(join(scriptShimDir, 'dsh'), [
  '#!/bin/sh',
  'basedir=$(dirname "$0")',
  'exec node "$basedir/../nowhere" "$@"',
  `# cmd-shim-target=${binFile}`,
  '',
].join('\n'))

afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

function run(argv: string[], options: { cwd?: string; path?: string; launcher?: string; dsh?: string } = {}): { status: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home }
  delete env.DSH_SOURCE
  delete env.DSH_CLI
  delete env.DSH_FABRIC_CONFIG
  delete env.DSH_FABRIC_PROFILE
  if (options.dsh !== undefined) env.DSH_CLI = options.dsh
  if (options.path !== undefined) env.PATH = options.path
  const result = spawnSync(process.execPath, [options.launcher ?? launcher, ...argv], {
    cwd: options.cwd ?? home,
    encoding: 'utf8',
    env,
  })
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

function expectBoot(out: { status: number; stdout: string; stderr: string }): void {
  expect(out.status, `${out.stdout}\n${out.stderr}`).toBe(0)
  // The pre-boot heal ran against the CLI package's own manifest...
  expect(out.stdout).toContain(`HEAL-MARK ${join(dshPkg, 'package.json')}`)
  // ...the CLI received the profile's argv untouched...
  expect(out.stdout).toContain('FAKE-DSH argv=["--profile","t1","--dump-config"]')
  expect(out.stdout).toContain('FAKE-DSH config=true')
  expect(out.stdout).toContain(`profile=${profileDir}`)
  // ...and the preload installed the hooks from the profile's trio copy.
  expect(out.stdout).toContain('PROFILE-BOOT count=0')
  expect(out.stderr).toContain('fabric-dsh: Fabric hooks installed (0 descriptor(s))')
}

function expectInstalledWeb(out: { status: number; stdout: string; stderr: string }): void {
  expect(out.status, `${out.stdout}\n${out.stderr}`).toBe(0)
  expect(out.stdout).toContain(`HEAL-MARK ${join(dshPkg, 'package.json')}`)
  expect(out.stdout).toContain('FAKE-DSH argv=["--profile","web","--port","8000"]')
  expect(out.stdout).toContain('FAKE-DSH config=true')
  expect(out.stdout).toContain(`profile=${webProfileDir}`)
  expect(out.stdout).toContain('PROFILE-BOOT count=0')
  expect(out.stderr).toContain('fabric-dsh: Fabric hooks installed (0 descriptor(s))')
}

describe('fabric-dsh installed mode (registry-installed dsh)', () => {
  it('uses --source as the source-checkout selector', () => {
    const source = join(tempDir, 'missing-source')
    const out = run(['--source', source, '--profile', 't1', '--dump-config'], { path: '/usr/bin:/bin' })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain(`no CLI entry at ${join(source, 'apps/cli/src/bin.ts')}`)
  })

  it('infers web and forwards it when invoked from the installed profile bin', () => {
    expectInstalledWeb(run(['--port', '8000'], {
      launcher: join(webProfileDir, 'node_modules', '.bin', 'fabric-dsh'),
      cwd: home,
      path: `${shimDir}:/usr/bin:/bin`,
    }))
  })

  it('resolves an explicit DSH_CLI override', () => {
    expectBoot(run(['--profile', 't1', '--dump-config'], { dsh: binFile }))
  })

  it("resolves the CLI from the caller's project dependencies", () => {
    expectBoot(run(['--profile', 't1', '--dump-config'], { cwd: proj, path: '/usr/bin:/bin' }))
  })

  it('follows a symlink dsh shim on PATH', () => {
    expectBoot(run(['--profile', 't1', '--dump-config'], { path: `${shimDir}:/usr/bin:/bin` }))
  })

  it('follows a cmd-shim script dsh on PATH', () => {
    expectBoot(run(['--profile', 't1', '--dump-config'], { path: `${scriptShimDir}:/usr/bin:/bin` }))
  })

  it('fails with guidance when no CLI is resolvable', () => {
    const out = run(['--profile', 't1', '--dump-config'], { path: '/usr/bin:/bin' })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('no installed @deepseek-ai/dsh found')
    expect(out.stderr).toContain('DSH_CLI')
  })
})
