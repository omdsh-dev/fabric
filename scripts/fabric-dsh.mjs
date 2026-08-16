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
 * Composition: the command resolves the profile's patch layers (bundle
 * cordis.patch.yml files in `dsh.profile.bundles` order, the profile's own
 * cordis.patch.yml, $DSH_HOME/cordis.patch.yml, then --patch overlays),
 * merges them with the Loader's id-targeted semantics, extracts the
 * `cordis-fabric` row's `config.fabric.patches` (or deprecated
 * `config.patches`) descriptors, writes them to a temp JSON, and launches
 * the official CLI with the preload reading that file.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

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
// else the default profile name.
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileName = args.profile ?? process.env.DSH_PROFILE ?? 'default'
const profileDir = join(dshHome, 'profiles', profileName)
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

const fabricRow = rows.get('cordis-fabric')
const fabricConfig = fabricRow?.config
const descriptors = fabricConfig?.fabric?.patches ?? fabricConfig?.patches
const patches = Array.isArray(descriptors) ? descriptors : []

const temp = mkdtempSync(join(tmpdir(), 'dsh-fabric-config-'))
const configPath = join(temp, 'config.json')
writeFileSync(configPath, JSON.stringify(patches))

// The CLI argv shape depends on the mode (official args.ts rules):
// - `plugin` takes its own required --profile AFTER the subcommand;
// - `web` is the hardcoded alias for --profile web and rejects the parent
//   flag (its app owns the remaining args, so --patch must ride web's own
//   --patch option);
// - a generic boot takes the launcher flags FIRST (parent position): the
//   app args only start at the first token the launcher does not know.
const [mode] = args.passthrough
const patchArgs = args.patchFiles.flatMap((f) => ['--patch', f])
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
  cliArgs = [...args.passthrough, ...patchArgs]
} else {
  cliArgs = [...(args.profile ? ['--profile', args.profile] : []), ...patchArgs, ...args.passthrough]
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx/esm', '--import', join(harnessRelativePreload(), 'preload.mjs'), bin, ...cliArgs],
  // cwd is the harness: tsx resolves `tsx/esm` and auto-discovers the entry's
  // tsconfig (apps/cli, extending the base) from there, exactly like the
  // official dsh script. TSX_TSCONFIG_PATH is pinned to the harness base so a
  // stale shell value (e.g. an old staging checkout) cannot poison paths.
  { stdio: 'inherit', cwd: harness, env: { ...process.env, DSH_FABRIC_CONFIG: configPath, TSX_TSCONFIG_PATH: join(harness, 'tsconfig.base.json') } },
)
rmSync(temp, { recursive: true, force: true })
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 0)

/** Prefer the preload bundled with the trio resolved from this repo. */
function harnessRelativePreload() {
  const repo = process.cwd()
  return join(repo, 'packages/cordis-fabric')
}
