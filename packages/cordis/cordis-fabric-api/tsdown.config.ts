import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * cordis-fabric-api is a dual-face package: the Host half (index plus the
 * module entries and the invariant companion) plus the browser client bundle.
 * The shared client preset emits both faces in the repository's explicit build
 * phases; the module entries are additional node exports resolved from `lib`.
 */
export default clientBundle(
  '@deepseek-ai/dsh-cordis-fabric-api',
  ['lib/types/index.js', 'lib/types/agent.js', 'lib/types/tools.js', 'lib/types/prompt.js', 'lib/types/commands.js', 'lib/types/compat.js', 'lib/types/invariant.js'],
)
