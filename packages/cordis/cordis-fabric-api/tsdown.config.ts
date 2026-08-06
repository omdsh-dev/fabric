import { defineConfig } from 'tsdown'
import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * cordis-fabric-api is a dual-face package: the Host half (index plus the
 * module entries and the invariant companion) plus the browser client
 * bundle. The client preset provides both the node-half shape and the lazy
 * CJS browser bundle; the module entries are further node artifacts the
 * subpath exports resolve.
 */
const [nodeHalf, browserHalf] = clientBundle(
  '@deepseek-ai/dsh-cordis-fabric-api',
  ['lib/types/index.js', 'lib/types/agent.js', 'lib/types/tools.js', 'lib/types/prompt.js', 'lib/types/commands.js', 'lib/types/compat.js', 'lib/types/invariant.js'],
)

export default defineConfig([
  nodeHalf,
  browserHalf,
])
