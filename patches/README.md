# Dependency Patches

Place pnpm dependency patches in `patches/` only when an exact upstream package version must be corrected for this bundle.

Declare each patch in the project-root `pnpm-workspace.yaml`:

```yaml
patchedDependencies:
  'package-name@1.2.3': patches/package-name@1.2.3.patch
```

Keep the patch version exact, document why the patch is required, and remove it when the upstream dependency contains the fix. A patch that affects the Git prepare build must be present in source control and covered by clean-install, `pnpm run prepare`, and pack verification. Do not add an empty `patchedDependencies` block when the bundle has no patches.

## Package boundary

This workspace ships exactly three packages: `cordis-fabric`, `cordis-fabric-api`, and `cordis-fabric-dsh`. Anything else is never added as a fourth package. In particular, `@deepseek-ai/dsh-tool-cordis` is an official DeepSeek Harness package (its repository is `deepseek-ai/deepseek-harness`): it must not be republished or re-implemented here. When a behavior of an official package must change for this bundle, apply a pnpm patch through `patchedDependencies` exactly as above.

## Host integration patch

The host patch is now EMPTY (0 files): every host-side seam the trio needs
moved into the plug-and-play `fabric-dsh` launcher (`scripts/fabric-dsh.mjs`
plus `packages/cordis-fabric/preload.mjs`). Running the official `dsh` leaves
the host source untouched; `fabric-dsh` supplies the wiring at launch:

- **loader hooks** — the preload calls `bootstrapFabric` (the same loader-hook
  registration the patched profile-boot used to perform) before the CLI entry
  loads, reading the composed descriptors from `$DSH_FABRIC_CONFIG`;
- **patch composition** — fabric-dsh merges the profile's patch layers
  (bundle `cordis.patch.yml` files, the profile layer, the `$DSH_HOME` layer,
  `--patch` overlays) with the Loader's id-targeted semantics and extracts the
  `cordis-fabric` row's `config.fabric.patches`;
- **post-boot check** — the Host plugin (`scheduleRequiredPatchCheck`)
  verifies required bindings one tick after mount under the launcher;
- **bundle rows** — the trio's own `cordis.patch.yml` inserts the
  `cordis-fabric` / `cordis-fabric-dsh` rows as disabled opt-ins (installed
  through the official plugin channel);
- **profile pnpm settings** — fabric-dsh appends `blockExoticSubdeps: false`
  and `dangerouslyAllowAllBuilds: true` to the profile's `pnpm-workspace.yaml`
  (the keys the profile template patch used to bake in);
- **tool-cordis catalog** — `FabricService` registers the fabric SERVICE_API
  entries at mount time (built hosts degrade to uncatalogued rows).

Usage:

```sh
DSH_HOME=$HOME/.dsh_dev pnpm run dsh plugin --profile web add github:dsh-external/fabric
node scripts/fabric-dsh.mjs --harness <deepseek-harness-checkout> --profile web web --port 8000
```

The empty `fabric-host-integration.patch` remains as a no-op so existing apply
flows keep working; `extract-patch.mjs` writes it when no seams remain and
`patch.sh` treats it as a successful no-op. The extraction machinery
(`patches/host-patch.config.json`) stays as the record of what USED to be
patched and as the tool that re-adds a seam if a future host change ever
needs one again:

```sh
pnpm run extract:patch -- --harness <fork-checkout>
```

The `--harness` checkout must contain both snapshots (the fork worktree, e.g.
the `feat-fabric` branch). The script fails loud when a seam anchor has
drifted upstream.
