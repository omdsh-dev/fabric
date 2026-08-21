// Fixture entry for the test kit: imports the stent-target fixture after
// the kit child bootstrapped the patches, so the target module is
// transformed before evaluation. The default export is the function the kit
// runs with the given args.
import { add } from './node_modules/stent-target-fixture/index.mjs'

export default async (args) => {
  if (args?.throw !== undefined) throw new Error(args.throw)
  return { sum: add(args?.a ?? 0, args?.b ?? 0) }
}
