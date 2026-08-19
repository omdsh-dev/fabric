/**
 * fabric-dsh: the plug-and-play Fabric launcher. Runs the official dsh CLI
 * with the Fabric transformation hooks injected through a preload — the host
 * source stays untouched; the hooks only exist when this command is used.
 *
 * Usage:
 *   node lib/fabric-dsh.js [dsh args...]                  (installed bundle)
 *   node --import tsx/esm src/fabric-dsh.ts --source <checkout> [...]
 *
 * Installed mode (default) runs a registry-installed @deepseek-ai/dsh: the
 * published lib/bin.js is plain ESM, so no tsx and no checkout are needed.
 * The CLI resolves from DSH_CLI, the caller's project dependencies, or a
 * `dsh` on PATH. Source mode (DSH_SOURCE) runs the checkout's
 * apps/cli/src/bin.ts through tsx instead. Profile resolution follows dsh:
 * DSH_HOME/profiles/<name>.
 *
 * Installed bundle form — no bundle checkout required: the bundle ships this
 * launcher (bin `fabric-dsh`), so after installing the release bundle through
 * the plugin channel (or running `scripts/install.sh`):
 *
 *   $DSH_HOME/profiles/web/node_modules/.bin/fabric-dsh --port 8000
 *
 * (home and profile name then derive from the install path itself.)
 *
 * Composition: the command resolves the profile's patch layers (bundle
 * cordis.patch.yml files in `dsh.profile.bundles` order, the profile's own
 * cordis.patch.yml, $DSH_HOME/cordis.patch.yml, then --patch overlays),
 * merges them with the Loader's id-targeted semantics, aggregates the
 * `config.fabric.patches` descriptors every row declares (the cordis-fabric
 * row is the canonical carrier), writes them to a temp JSON, and launches
 * the official CLI with the preload reading that file. A row that declares
 * fabric patches is Fabric-required: it ships disabled, and this command
 * enables it through a generated --patch overlay (after every user layer),
 * so a plain `dsh` boot skips such rows entirely while this launch loads
 * them with the hooks already installed.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildCliArgs, parseArgs } from './args.ts'
import { resolveHost, type ResolvedHost } from './cli.ts'
import { composeFabricConfig, resolveProfile, resolveYaml, type FabricConfig } from './profile.ts'
import type { LauncherArgs } from './args.ts'

export interface LauncherOptions {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  launcherUrl?: string | URL
}

/**
 * Run the Fabric launcher. The entry module passes its own URL so installed
 * bundle invocations can derive DSH_HOME/profile from the bin's real path.
 */
export function main({
  argv = process.argv.slice(2),
  env = process.env,
  launcherUrl = import.meta.url,
}: LauncherOptions = {}): never {
  const args: LauncherArgs = parseArgs(argv, env)

  // A bare spawnSync parent never returns once its child dies of SIGINT: the
  // sync wait loop swallows the signal and the shell hangs until a second ^C.
  // The child still receives every signal directly and owns its own graceful
  // first-^C / forceful second-^C escalation.
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => {})

  const host: ResolvedHost = resolveHost(args, { cwd: process.cwd(), env })
  const profile = resolveProfile({ args, source: host.source, launcherUrl, env })
  const { requireFromProfile, yaml } = resolveYaml(profile.profileDir, host.fromCli)
  const config: FabricConfig = composeFabricConfig({
    args,
    dshHome: profile.dshHome,
    profileDir: profile.profileDir,
    requireFromProfile,
    yaml,
  })
  const cliArgs = buildCliArgs(args, profile.effectiveProfile, config.enablePath, config.enableOverlay)

  // Heal both dependency closures before the preload imports the profile's
  // trio: the DSH installation provides host packages, while the bundle's
  // bundledDependencies provide the Fabric packages. The healer creates the
  // profile-level names from the bundle's real nested package locations.
  const bundlePackageJson = fileURLToPath(new URL('../package.json', launcherUrl))
  const healEval = host.source
    ? `const { healProfilesModuleFallback } = await import('@deepseek-ai/dsh-app-boot'); healProfilesModuleFallback(${JSON.stringify(bundlePackageJson)}); healProfilesModuleFallback(${JSON.stringify(host.cliPkgJson)})`
    : `const { createRequire } = await import('node:module'); const { healProfilesModuleFallback } = await import(createRequire(${JSON.stringify(pathToFileURL(host.realBin).href)}).resolve('@deepseek-ai/dsh-app-boot')); healProfilesModuleFallback(${JSON.stringify(bundlePackageJson)}); healProfilesModuleFallback(${JSON.stringify(host.cliPkgJson)})`
  const heal = spawnSync(
    process.execPath,
    [...(host.source ? ['--import', 'tsx/esm'] : []), '--input-type=module', '--eval', healEval],
    { stdio: 'inherit', ...(host.source ? { cwd: host.sourceRoot } : {}), env: { ...env, DSH_HOME: profile.dshHome } },
  )
  if (heal.error !== undefined) throw heal.error
  if (heal.status !== 0) process.exit(heal.status ?? 1)

  const result = spawnSync(
    process.execPath,
    [
      ...(host.source ? ['--import', 'tsx/esm'] : []),
      '--import',
      bundledPreloadPath(launcherUrl),
      host.bin,
      ...cliArgs,
    ],
    // Source mode runs from the source checkout: tsx resolves its tsconfig
    // there. Installed mode needs no pinned cwd: the published bin is plain ESM.
    { stdio: 'inherit', ...(host.source ? { cwd: host.sourceRoot } : {}), env: { ...env, DSH_FABRIC_CONFIG: config.configPath, DSH_FABRIC_PROFILE: profile.profileDir, DSH_HOME: profile.dshHome } },
  )
  config.cleanup()
  if (result.error !== undefined) throw result.error
  process.exit(result.status ?? 0)
}

function bundledPreloadPath(launcherUrl: string | URL): string {
  return join(fileURLToPath(new URL('../packages/cordis-fabric', launcherUrl)), 'preload.mjs')
}
