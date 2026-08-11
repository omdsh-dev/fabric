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

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const [name, spec] of Object.entries(packageJson[field] ?? {})) {
    if (/^(?:file|link|portal|workspace|git\+|https?):/i.test(spec) || spec.startsWith('.') || isAbsolute(spec)) {
      failures.push(`package.json: ${field}.${name} uses non-registry spec ${spec}`)
    }
  }
}

const lockfileSource = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
const localLockSpec = lockfileSource.match(/(?:^|[\s'"])(?:file|link|portal|workspace):[^\s'",}\]]+/m)
if (localLockSpec !== null) failures.push(`pnpm-lock.yaml: contains local dependency spec ${localLockSpec[0].trim()}`)

for (const fileName of readdirSync(root).filter(name => /^tsconfig.*\.json$/.test(name))) {
  const config = JSON.parse(readFileSync(join(root, fileName), 'utf8'))
  const candidates = []
  if (typeof config.extends === 'string' && config.extends.startsWith('.')) candidates.push(config.extends)
  for (const reference of config.references ?? []) {
    if (typeof reference.path === 'string') candidates.push(reference.path)
  }
  for (const values of Object.values(config.compilerOptions?.paths ?? {})) {
    if (Array.isArray(values)) candidates.push(...values)
  }
  for (const candidate of candidates) {
    const targetPath = resolve(root, candidate.replace(/\*$/, ''))
    if (!isInsideRoot(targetPath)) failures.push(`${fileName}: compiler path leaves repository: ${candidate}`)
  }
}

for (const requiredPath of [
  'AGENTS.md',
  'docs/dsh-plugin-contracts.md',
  'patches/README.md',
  'scripts/prepare.mjs',
  'src/README.md',
  'src/host-contracts.ts',
  'tests/README.md',
  'tests/fakes.ts',
  'tests/snapshots/README.md',
]) {
  if (!existsSync(join(root, requiredPath))) failures.push(`missing repository-layout contract ${requiredPath}`)
}
if (existsSync(join(root, 'legacy'))) failures.push('legacy/ must be removed: it references files outside this repository')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`self-contained repository verified (${textFiles.length} text files)`)
