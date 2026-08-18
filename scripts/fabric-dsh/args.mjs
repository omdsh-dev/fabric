export function parseArgs(argv, env = process.env) {
  const args = {
    harness: env.DSH_HARNESS,
    dsh: env.DSH_CLI,
    profile: undefined,
    patchFiles: [],
    passthrough: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--harness') args.harness = argv[++i]
    else if (a === '--dsh') args.dsh = argv[++i]
    else if (a === '--profile') args.profile = argv[++i]
    else if (a === '--patch') args.patchFiles.push(argv[++i])
    else if (a.startsWith('--patch=')) args.patchFiles.push(a.slice('--patch='.length))
    else args.passthrough.push(a)
  }
  // `web` is the CLI's hardcoded alias for --profile web: the layer
  // composition must follow the same profile the CLI will actually boot.
  if (args.profile === undefined && args.passthrough[0] === 'web') args.profile = 'web'
  return args
}

export function buildCliArgs(args, effectiveProfile, enablePath, enableOverlay) {
  const [mode] = args.passthrough
  const patchArgs = [
    ...args.patchFiles.flatMap((file) => ['--patch', file]),
    ...(enableOverlay.length > 0 ? ['--patch', enablePath] : []),
  ]
  let cliArgs
  if (mode === 'plugin') {
    if (patchArgs.length > 0) {
      console.error('fabric-dsh: --patch overlays only apply when booting a profile, not for plugin')
      process.exit(1)
    }
    cliArgs = [...args.passthrough, ...(effectiveProfile ? ['--profile', effectiveProfile] : [])]
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
    // Generic boot takes the launcher flags first; the app args only start at
    // the first token the launcher does not know.
    cliArgs = [...(effectiveProfile ? ['--profile', effectiveProfile] : []), ...patchArgs, ...args.passthrough]
  }
  return cliArgs
}
