import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ignoredDirectories = new Set(['.git', 'lib', 'node_modules'])
const textExtensions = new Set(['.cjs', '.cts', '.js', '.json', '.jsx', '.md', '.mjs', '.mts', '.ts', '.tsx', '.yaml', '.yml'])
const codeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const failures = []
const textFiles = []

function isInsideRoot(target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const fullPath = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      try {
        const target = realpathSync(fullPath)
        if (!isInsideRoot(target)) failures.push(`${relative(root, fullPath)}: symlink leaves repository`)
      } catch (error) {
        failures.push(`${relative(root, fullPath)}: broken symlink (${error.message})`)
      }
      continue
    }
    if (entry.isDirectory()) {
      walk(fullPath)
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      textFiles.push(fullPath)
    }
  }
}

walk(root)

for (const filePath of textFiles) {
  const rel = relative(root, filePath)
  const source = readFileSync(filePath, 'utf8')
  if (rel !== 'scripts/verify-self-contained.mjs') {
    const workstationPath = source.match(/(?:^|\s|["'`(=,:])((?:~\/|\/(?:home|Users)\/[^/\s"'`<>]+|(?:[A-Za-z]:[\\/][^\s"'`<>]+)))/m)
    if (workstationPath !== null) failures.push(`${rel}: contains absolute workstation path ${workstationPath[1]}`)
  }
  if (extname(filePath) === '.md') {
    if (/\.\.[/\\]/.test(source)) failures.push(`${rel}: documentation uses parent-directory navigation`)
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, '')
      if (rawTarget.startsWith('#') || rawTarget.startsWith('mailto:')) continue
      if (/^[a-z][a-z+.-]*:/i.test(rawTarget)) {
        failures.push(`${rel}: external Markdown link ${rawTarget}`)
        continue
      }
      const targetPath = resolve(dirname(filePath), rawTarget.split('#')[0])
      if (!isInsideRoot(targetPath)) {
        failures.push(`${rel}: Markdown link leaves repository: ${rawTarget}`)
      } else if (!existsSync(targetPath)) {
        failures.push(`${rel}: broken Markdown link: ${rawTarget}`)
      }
    }
  }

  if (codeExtensions.has(extname(filePath))) {
    const pathPatterns = [
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*|require\.resolve\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g,
      /\/\/\/\s*<reference\s+path=['"](\.{1,2}\/[^'"]+)['"]/g,
    ]
    for (const pattern of pathPatterns) {
      for (const match of source.matchAll(pattern)) {
        const targetPath = resolve(dirname(filePath), match[1])
        if (!isInsideRoot(targetPath)) failures.push(`${rel}: code path leaves repository: ${match[1]}`)
      }
    }
  }
}

const workspaceMembers = new Set(['cordis-fabric', 'cordis-fabric-api', 'cordis-fabric-dsh'])
const manifestPaths = ['package.json', ...['cordis-fabric', 'cordis-fabric-api', 'cordis-fabric-dsh'].map(name => join('packages', name, 'package.json'))]
for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (/^(?:file|link|portal|git\+|https?):/i.test(spec) || spec.startsWith('.') || isAbsolute(spec)) {
        failures.push(`${manifestPath}: ${field}.${name} uses non-registry spec ${spec}`)
      } else if (/^workspace:/i.test(spec) && !workspaceMembers.has(name)) {
        failures.push(`${manifestPath}: ${field}.${name} uses workspace spec for a non-workspace member ${spec}`)
      }
    }
  }
}

const lockfileSource = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
// workspace: specs in the lockfile are inherently intra-repo (pnpm only
// writes them for workspace members, which the manifest check above pins);
// link:/file:/portal: entries are likewise pnpm's standard intra-workspace
// record — allow them when their target stays inside the repository.
for (const match of lockfileSource.matchAll(/(?:^|[\s'"])(file|link|portal):([^\s'",}\]]+)/g)) {
  const target = match[2]
  // pnpm records intra-workspace links relative to the dependent package
  // directory, so accept targets that resolve inside the repository from
  // the root or from any workspace member.
  const bases = [root, ...[...workspaceMembers].map(name => join(root, 'packages', name))]
  const inside = bases.some(base => isInsideRoot(resolve(base, target)))
  if (!inside) failures.push(`pnpm-lock.yaml: contains local dependency spec ${match[1]}:${target} pointing outside the repository`)
}

function collectTsconfigs(directory, matches) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) collectTsconfigs(join(directory, entry.name), matches)
    } else if (/^tsconfig.*\.json$/.test(entry.name)) {
      matches.push(join(directory, entry.name))
    }
  }
}

const tsconfigs = []
collectTsconfigs(root, tsconfigs)
for (const configPath of tsconfigs) {
  const label = relative(root, configPath)
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const candidates = []
  if (typeof config.extends === 'string' && config.extends.startsWith('.')) candidates.push(config.extends)
  for (const reference of config.references ?? []) {
    if (typeof reference.path === 'string') candidates.push(reference.path)
  }
  for (const values of Object.values(config.compilerOptions?.paths ?? {})) {
    if (Array.isArray(values)) candidates.push(...values)
  }
  for (const candidate of candidates) {
    const targetPath = resolve(dirname(configPath), candidate.replace(/\*$/, ''))
    if (!isInsideRoot(targetPath)) failures.push(`${label}: compiler path leaves repository: ${candidate}`)
  }
}

for (const requiredPath of [
  'AGENTS.md',
  'README.md',
  'cordis.patch.yml',
  'docs/dsh-plugin-contracts.md',
  'packages/cordis-fabric/package.json',
  'packages/cordis-fabric/src',
  'packages/cordis-fabric/tests',
  'packages/cordis-fabric-api/package.json',
  'packages/cordis-fabric-api/src',
  'packages/cordis-fabric-api/tests',
  'packages/cordis-fabric-dsh/package.json',
  'packages/cordis-fabric-dsh/src',
  'packages/cordis-fabric-dsh/src/host-contracts.ts',
  'packages/cordis-fabric-dsh/tests',
  'patches/README.md',
  'patches/fabric-host-integration.patch',
  'pnpm-workspace.yaml',
  'scripts/prepare.mjs',
  'tsconfig.base.json',
]) {
  if (!existsSync(join(root, requiredPath))) failures.push(`missing repository-layout contract ${requiredPath}`)
}
if (existsSync(join(root, 'legacy'))) failures.push('legacy/ must be removed: it references files outside this repository')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`self-contained repository verified (${textFiles.length} text files)`)
