/**
 * Module-identity helpers shared by the Node loader and the browser build
 * transform: package-version lookup and module-type detection.
 * @module @deepseek-ai/dsh-cordis-fabric/module-identity
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Read the version field of the owning package.json.
 * @param basedir - package directory as a file URL or filesystem path.
 * @returns the version string, or `''` when it cannot be determined.
 */
export function getPackageVersion(basedir: string): string {
  try {
    const url = new URL(basedir)
    if (url.protocol === 'file:') basedir = fileURLToPath(url)
  } catch {
    // Already a filesystem path.
  }
  try {
    const manifest = JSON.parse(readFileSync(join(basedir, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
}

/**
 * Detect the module kind of a source file from its extension.
 * @param id - the module id (file path or URL).
 * @returns `'esm'` for TS/TSX/MJS/JS sources, `'cjs'` for CJS sources.
 */
export function detectModuleType(id: string): 'esm' | 'cjs' {
  return id.endsWith('.cjs') ? 'cjs' : 'esm'
}
