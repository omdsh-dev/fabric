import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * Resolve the profile like dsh does. An installed bundle bin additionally
 * derives both DSH_HOME and the profile name from its own path.
 */
export function resolveProfile({ args, source, launcherUrl, env = process.env }) {
  const installedMatch = fileURLToPath(launcherUrl)
    .match(/^(.*)\/profiles\/([^/]+)\/node_modules\/cordis-fabric-bundle\/scripts\/fabric-dsh\.mjs$/)
  const dshHome = installedMatch !== null
    ? installedMatch[1]
    : env.DSH_HOME ?? join(homedir(), '.dsh')
  const profileName = installedMatch !== null
    ? (args.profile ?? installedMatch[2])
    : args.profile ?? env.DSH_PROFILE ?? 'default'
  // An installed profile bin already identifies the profile. Reuse that name
  // when forwarding to the official CLI, even when the caller omits `web`.
  const effectiveProfile = args.profile ?? (installedMatch !== null ? installedMatch[2] : undefined)
  const profileDir = join(dshHome, 'profiles', profileName)
  if (!existsSync(profileDir)) {
    console.error(`fabric-dsh: profile ${profileName} not found at ${profileDir} (DSH_HOME=${dshHome})`)
    if (source) {
      console.error(`  install the Fabric bundle first: scripts/install.sh <deepseek-harness-checkout> --dsh-home ${dshHome}`)
      console.error(`  or: DSH_HOME=${dshHome} pnpm -C <deepseek-harness-checkout> dsh plugin --profile ${profileName} add github:dsh-external/fabric`)
    } else {
      console.error(`  install the Fabric bundle first: dsh plugin --profile ${profileName} add https://github.com/omdsh-dev/fabric/releases/latest/download/pkg.tgz`)
    }
    process.exit(1)
  }
  return { dshHome, profileName, effectiveProfile, profileDir, installedMatch }
}

/** Resolve js-yaml from the profile first, then from the CLI package. */
export function resolveYaml(profileDir, fromCli) {
  const requireFromProfile = createRequire(join(profileDir, 'package.json'))
  let yaml
  try { yaml = requireFromProfile('js-yaml') } catch { /* not in the profile */ }
  if (yaml === undefined) {
    // The CLI's own declared dependencies carry js-yaml (either host mode).
    try { yaml = fromCli('js-yaml') } catch { /* not resolvable from the CLI */ }
  }
  if (yaml === undefined) {
    console.error('fabric-dsh: js-yaml is required (install it in the profile or beside the CLI)')
    process.exit(1)
  }
  return { requireFromProfile, yaml }
}

/** Load one YAML patch layer (empty array when the file is absent). */
function createPatchLoader(yaml) {
  /** js-yaml schema tolerating the Loader's `!!js` expression tag. */
  let yamlSchema
  try {
    const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
      kind: 'scalar',
      resolve: (data) => data !== null,
      construct: (data) => data,
    })
    yamlSchema = yaml.DEFAULT_SCHEMA.extend([jsTag])
  } catch { yamlSchema = undefined }

  return function loadPatchLayer(path) {
    if (!existsSync(path)) return []
    const text = readFileSync(path, 'utf8')
    const data = yamlSchema !== undefined
      ? yaml.load(text, { schema: yamlSchema })
      : yaml.load(text)
    return Array.isArray(data) ? data : []
  }
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

/** Compose profile rows and create the temporary Fabric handoff files. */
export function composeFabricConfig({ args, dshHome, profileDir, requireFromProfile, yaml }) {
  const loadPatchLayer = createPatchLoader(yaml)
  const bundlePatchFile = (manifestPath) => {
    try {
      const manifestPathname = requireFromProfile.resolve(`${manifestPath}/package.json`)
      const manifest = JSON.parse(readFileSync(manifestPathname, 'utf8'))
      const patchRel = manifest?.dsh?.bundle?.patch
      if (typeof patchRel !== 'string') return undefined
      return resolve(join(manifestPathname, '..', patchRel))
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

  // A row whose config declares config.fabric.patches (the cordis-fabric
  // carrier row aside) hard-depends on Fabric. Such rows ship disabled; the
  // launcher enables them through a generated overlay after every user layer.
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
  return {
    configPath,
    enablePath,
    enableOverlay,
    patches,
    cleanup: () => rmSync(temp, { recursive: true, force: true }),
  }
}
