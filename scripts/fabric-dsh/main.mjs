/**
 * fabric-dsh: the plug-and-play Fabric launcher. Runs the official dsh CLI
 * with the Fabric transformation hooks injected through a preload — the host
 * source stays untouched; the hooks only exist when this command is used.
 *
 * Usage:
 *   node scripts/fabric-dsh.mjs [dsh args...]                 (installed dsh)
 *   node scripts/fabric-dsh.mjs --harness <checkout> [...]    (source checkout)
 *
 * Installed mode (default) runs a registry-installed @deepseek-ai/dsh: the
 * published lib/bin.js is plain ESM, so no tsx and no checkout are needed.
 * The CLI resolves from --dsh <path> (or DSH_CLI), else the caller's project
 * dependencies, else a `dsh` on PATH. Source mode (DSH_HARNESS is honored
 * when --harness is absent) runs the checkout's apps/cli/src/bin.ts through
 * tsx instead. Profile resolution follows dsh: DSH_HOME/profiles/<name>.
 *
 * Installed bundle form — no bundle checkout required: the bundle ships this
 * launcher (bin `fabric-dsh`), so after `dsh plugin --profile web add
 * github:dsh-external/fabric` (or scripts/install.sh):
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
import { buildCliArgs, parseArgs } from './args.mjs'
import { resolveHost } from './cli.mjs'
import { composeFabricConfig, resolveProfile, resolveYaml } from './profile.mjs'

/**
 * Run the Fabric launcher. The entry module passes its own URL so installed
 * bundle invocations can derive DSH_HOME/profile from the bin's real path.
 */
export function main({ argv = process.argv.slice(2), env = process.env, launcherUrl = import.meta.url } = {}) {
  const args = parseArgs(argv, env)

  // A bare spawnSync parent never returns once its child dies of SIGINT: the
  // sync wait loop swallows the signal and the shell hangs until a second ^C.
  // The child still receives every signal directly and owns its own graceful
  // first-^C / forceful second-^C escalation.
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => {})

  const host = resolveHost(args, { cwd: process.cwd(), env })
  const profile = resolveProfile({ args, source: host.source, launcherUrl, env })
  const { requireFromProfile, yaml } = resolveYaml(profile.profileDir, host.fromCli)
  const config = composeFabricConfig({
    args,
    dshHome: profile.dshHome,
    profileDir: profile.profileDir,
    requireFromProfile,
    yaml,
  })
  const cliArgs = buildCliArgs(args, profile.effectiveProfile, config.enablePath, config.enableOverlay)

  // Heal the profile's module fallback BEFORE the preload imports the
  // profile's trio: the preload runs before the CLI's own prepareProfile
  // heals it, and the trio's peer (@deepseek-ai/cordis) must already resolve
  // from the profile for the profile-authoritative copy to load. The heal is
  // the CLI's own API (idempotent re-link), not a host source change. Source
  // mode resolves dsh-app-boot from the harness; installed mode resolves it
  // from the CLI's real location, cwd-independent.
  const healEval = host.source
    ? `const { healProfilesModuleFallback } = await import('@deepseek-ai/dsh-app-boot'); healProfilesModuleFallback(${JSON.stringify(host.cliPkgJson)})`
    : `const { createRequire } = await import('node:module'); const { healProfilesModuleFallback } = await import(createRequire(${JSON.stringify(pathToFileURL(host.realBin).href)}).resolve('@deepseek-ai/dsh-app-boot')); healProfilesModuleFallback(${JSON.stringify(host.cliPkgJson)})`
  const heal = spawnSync(
    process.execPath,
    [...(host.source ? ['--import', 'tsx/esm'] : []), '--input-type=module', '--eval', healEval],
    { stdio: 'inherit', ...(host.source ? { cwd: host.harness } : {}), env: { ...env, DSH_HOME: profile.dshHome } },
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
    // Source mode runs from the harness: tsx resolves its tsconfig there.
    // Installed mode needs no pinned cwd: the published bin is plain ESM.
    { stdio: 'inherit', ...(host.source ? { cwd: host.harness } : {}), env: { ...env, DSH_FABRIC_CONFIG: config.configPath, DSH_FABRIC_PROFILE: profile.profileDir, DSH_HOME: profile.dshHome } },
  )
  config.cleanup()
  if (result.error !== undefined) throw result.error
  process.exit(result.status ?? 0)
}

function bundledPreloadPath(launcherUrl) {
  return join(fileURLToPath(new URL('../packages/cordis-fabric', launcherUrl)), 'preload.mjs')
}
