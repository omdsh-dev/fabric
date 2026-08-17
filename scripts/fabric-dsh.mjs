#!/usr/bin/env node
/**
 * fabric-dsh: the plug-and-play Fabric launcher. Runs the official dsh CLI
 * with the Fabric transformation hooks injected through a preload — the host
 * source stays untouched; the hooks only exist when this command is used.
 *
 * Usage:
 *   node scripts/fabric-dsh.mjs --harness <deepseek-harness> [dsh args...]
 *   (DSH_HARNESS env is honored when --harness is absent; profile resolution
 *    follows dsh: DSH_HOME/profiles/<name>.)
 *
 * Installed form — no bundle checkout required: the bundle ships this
 * launcher (bin `fabric-dsh`), so after `dsh plugin --profile web add
 * github:dsh-external/fabric` (or scripts/install.sh):
 *
 *   $DSH_HOME/profiles/web/node_modules/.bin/fabric-dsh \
 *     --harness <deepseek-harness> web --port 8000
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
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const args = { harness: process.env.DSH_HARNESS, profile: undefined, patchFiles: [], passthrough: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--harness') args.harness = argv[++i]
    else if (a === '--profile') args.profile = argv[++i]
    else if (a === '--patch') args.patchFiles.push(argv[++i])
    else if (a.startsWith('--patch=')) args.patchFiles.push(a.slice('--patch='.length))
    else args.passthrough.push(a)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

// A bare spawnSync parent never returns once its child dies of SIGINT: the
// sync wait loop swallows the signal and the launcher hangs even after the
// child's graceful shutdown finished. The shell keeps waiting on this hung
// foreground job, so a single ^C looks broken — typed input (arrow keys)
// echoes literally and only a second ^C, which kills the hung launcher,
// returns the terminal to normal. An installed handler settles the loop:
// spawnSync returns as soon as the child exits and the shell regains the
// prompt after ONE ^C. The child (the official CLI) still receives every
// signal directly — the kernel delivers to the whole foreground process
// group — and owns its own graceful/first-vs-second ^C escalation.
process.on('SIGINT', () => {})
process.on('SIGTERM', () => {})

// `web` is the CLI's hardcoded alias for --profile web: the layer
// composition must follow the same profile the CLI will actually boot.
if (args.profile === undefined && args.passthrough[0] === 'web') args.profile = 'web'
if (args.harness === undefined) {
  console.error('fabric-dsh: pass --harness <deepseek-harness> or set DSH_HARNESS')
  process.exit(1)
}
const harness = resolve(args.harness)
const bin = join(harness, 'apps/cli/src/bin.ts')
if (!existsSync(bin)) {
  console.error(`fabric-dsh: no CLI entry at ${bin}`)
  process.exit(1)
}

// Resolve the profile like dsh does: --profile flag, else $DSH_PROFILE,
// else the default profile name. When this launcher runs from an INSTALLED
// bundle (`<home>/profiles/<name>/node_modules/cordis-fabric-bundle/...`),
// derive both the home and the profile from its own path, so no bundle
// checkout and no env are required to launch.
const installedMatch = fileURLToPath(import.meta.url)
  .match(/^(.*)\/profiles\/([^/]+)\/node_modules\/cordis-fabric-bundle\/scripts\/fabric-dsh\.mjs$/)
const dshHome = installedMatch !== null
  ? installedMatch[1]
  : process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileName = installedMatch !== null
  ? (args.profile ?? installedMatch[2])
  : args.profile ?? process.env.DSH_PROFILE ?? 'default'
const profileDir = join(dshHome, 'profiles', profileName)
if (!existsSync(profileDir)) {
  console.error(`fabric-dsh: profile ${profileName} not found at ${profileDir} (DSH_HOME=${dshHome})`)
  console.error(`  install the Fabric bundle first: scripts/install.sh <deepseek-harness-checkout> --dsh-home ${dshHome}`)
  console.error(`  or: DSH_HOME=${dshHome} pnpm -C <deepseek-harness-checkout> dsh plugin --profile ${profileName} add github:dsh-external/fabric`)
  process.exit(1)
}
const requireFromProfile = createRequire(join(profileDir, 'package.json'))
let yaml
try { yaml = requireFromProfile('js-yaml') } catch { /* not in the profile */ }
if (yaml === undefined) {
  try { yaml = createRequire(join(harness, 'package.json'))('js-yaml') } catch { /* not in the harness */ }
}
if (yaml === undefined) {
  console.error('fabric-dsh: js-yaml is required (install it in the profile or harness)')
  process.exit(1)
}

/** js-yaml schema tolerating the Loader's `!!js` expression tag (kept as the raw string; only row id/config/disabled matter here). */
let yamlSchema
try {
  const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: (data) => data !== null,
    construct: (data) => data,
  })
  yamlSchema = yaml.DEFAULT_SCHEMA.extend([jsTag])
} catch { yamlSchema = undefined }

/** Load one YAML patch layer (empty array when the file is absent). */
function loadPatchLayer(path) {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const data = yamlSchema !== undefined
    ? yaml.load(text, { schema: yamlSchema })
    : yaml.load(text)
  return Array.isArray(data) ? data : []
}

/** Merge one patch layer into the row index with id-targeted semantics. */
function applyLayer(rows, layer) {
  for (const entry of layer) {
    if (entry === null || typeof entry !== 'object') continue
    if (Array.isArray(entry.insert)) {
      for (const row of entry.insert) {
        if (row === null || typeof row !== 'object' || typeof row.id !== 'string') continue
        rows.set(row.id, { ...rows.get(row.id), ...row })
      }
    } else if (typeof entry.id === 'string') {
      // id-targeted override replaces the whole row (disabled flag included).
      rows.set(entry.id, { ...entry })
    }
  }
}

const bundlePatchFile = (manifestPath) => {
  try {
    const manifest = JSON.parse(readFileSync(requireFromProfile.resolve(`${manifestPath}/package.json`), 'utf8'))
    const patchRel = manifest?.dsh?.bundle?.patch
    if (typeof patchRel !== 'string') return undefined
    return resolve(join(requireFromProfile.resolve(`${manifestPath}/package.json`), '..', patchRel))
  } catch { return undefined }
}

const profilePkgPath = join(profileDir, 'package.json')
const profilePkg = existsSync(profilePkgPath) ? JSON.parse(readFileSync(profilePkgPath, 'utf8')) : {}
const bundles = profilePkg?.dsh?.profile?.bundles ?? []

const rows = new Map()
for (const bundle of bundles) {
  const patchPath = bundlePatchFile(bundle)
  if (patchPath !== undefined) applyLayer(rows, loadPatchLayer(patchPath))
}
applyLayer(rows, loadPatchLayer(join(profileDir, 'cordis.patch.yml')))
applyLayer(rows, loadPatchLayer(join(dshHome, 'cordis.patch.yml')))
for (const patchFile of args.patchFiles) applyLayer(rows, loadPatchLayer(resolve(patchFile)))

// Ensure the profile's pnpm settings allow the git-hosted trio to build on
// install (the patch used to bake these into the profile template; this
// command owns them now, appending only the missing keys).
const wsYamlPath = join(profileDir, 'pnpm-workspace.yaml')
let wsContent = existsSync(wsYamlPath) ? readFileSync(wsYamlPath, 'utf8') : 'packages:\n  - .\n'
let wsChanged = false
for (const [key, value] of [['blockExoticSubdeps', 'false'], ['dangerouslyAllowAllBuilds', 'true']]) {
  if (!new RegExp(`^${key}:`, 'm').test(wsContent)) {
    wsContent += `${wsContent.endsWith('\n') ? '' : '\n'}${key}: ${value}\n`
    wsChanged = true
  }
}
if (wsChanged) writeFileSync(wsYamlPath, wsContent)

// Fabric-required rows: a row whose config declares `config.fabric.patches`
// (the cordis-fabric carrier row aside) hard-depends on the Fabric layer.
// Such rows ship DISABLED; the launcher enables them through a generated
// overlay applied after every user layer, so a plain `dsh` boot skips them
// entirely (the app runs, the dependent plugins stay unloaded) while
// fabric-dsh loads them with the hooks already installed.
const enableOverlay = []
const byId = new Map()
for (const [id, row] of rows) {
  const config = row?.config
  const declared = config?.fabric?.patches ?? config?.patches
  if (!Array.isArray(declared)) continue
  for (const patch of declared) {
    if (patch !== null && typeof patch === 'object' && typeof patch.id === 'string') byId.set(patch.id, patch)
  }
  if (id !== 'cordis-fabric' && row.disabled !== false) enableOverlay.push({ id, disabled: false })
}
const patches = [...byId.values()]

const temp = mkdtempSync(join(tmpdir(), 'dsh-fabric-config-'))
const configPath = join(temp, 'config.json')
writeFileSync(configPath, JSON.stringify(patches))
const enablePath = join(temp, 'enable.yaml')
writeFileSync(enablePath, enableOverlay.length > 0 ? yaml.dump(enableOverlay) : '[]\n')

// The CLI argv shape depends on the mode (official args.ts rules):
// - `plugin` takes its own required --profile AFTER the subcommand;
// - `web` is the hardcoded alias for --profile web and rejects the parent
//   flag (its app owns the remaining args, so --patch must ride web's own
//   --patch option);
// - a generic boot takes the launcher flags FIRST (parent position): the
//   app args only start at the first token the launcher does not know.
const [mode] = args.passthrough
const patchArgs = [...args.patchFiles.flatMap((f) => ['--patch', f]), ...(enableOverlay.length > 0 ? ['--patch', enablePath] : [])]
let cliArgs
if (mode === 'plugin') {
  if (patchArgs.length > 0) {
    console.error('fabric-dsh: --patch overlays only apply when booting a profile, not for plugin')
    process.exit(1)
  }
  cliArgs = [...args.passthrough, ...(args.profile ? ['--profile', args.profile] : [])]
} else if (mode === 'web') {
  if (args.profile !== undefined && args.profile !== 'web') {
    console.error(`fabric-dsh: \`web\` boots the web profile; drop --profile ${args.profile} or omit the web alias`)
    process.exit(1)
  }
  // web's own --patch must precede the app args (passThroughOptions sends
  // everything after the first unknown token to the app).
  const [web, ...appArgs] = args.passthrough
  cliArgs = [web, ...patchArgs, ...appArgs]
} else {
  cliArgs = [...(args.profile ? ['--profile', args.profile] : []), ...patchArgs, ...args.passthrough]
}

// Heal the profile's module fallback BEFORE the preload imports the
// profile's trio: the preload runs before the CLI's own prepareProfile
// heals it, and the trio's peer (@deepseek-ai/cordis) must already resolve
// from the profile for the profile-authoritative copy to load. The heal is
// the CLI's own API (idempotent re-link), not a host source change.
const heal = spawnSync(
  process.execPath,
  ['--import', 'tsx/esm', '--input-type=module', '--eval',
    `const { healProfilesModuleFallback } = await import('@deepseek-ai/dsh-app-boot'); healProfilesModuleFallback(${JSON.stringify(join(harness, 'apps/cli/package.json'))})`],
  { stdio: 'inherit', cwd: harness, env: { ...process.env, DSH_HOME: dshHome } },
)
if (heal.error !== undefined) throw heal.error
if (heal.status !== 0) process.exit(heal.status ?? 1)

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx/esm', '--import', join(bundledPreloadDir(), 'preload.mjs'), bin, ...cliArgs],
  // cwd is the harness: tsx resolves `tsx/esm` and auto-discovers the entry's
  // tsconfig (apps/cli, extending the base) from there, exactly like the
  // official dsh script.
  { stdio: 'inherit', cwd: harness, env: { ...process.env, DSH_FABRIC_CONFIG: configPath, DSH_FABRIC_PROFILE: profileDir, DSH_HOME: dshHome } },
)
rmSync(temp, { recursive: true, force: true })
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 0)

/** The preload rides beside this launcher (the bundle repo's
 * packages/cordis-fabric), independent of the caller's cwd. */
function bundledPreloadDir() {
  return fileURLToPath(new URL('../packages/cordis-fabric', import.meta.url))
}
