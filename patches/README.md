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
  loads, reading the composed descriptors from `$DSH_FABRIC_CONFIG`. The trio
  resolves from the profile (`DSH_FABRIC_PROFILE`) so hooks, binding reports,
  and handlers share the one module instance the plugins use; fabric-dsh
  heals the profile's module fallback first (the preload runs before the
  CLI's own boot would), then prints a `fabric-dsh:` marker on stderr —
  the boot output always shows whether a launch is fabric-enabled. The Host
  plugin's post-boot check also prints a hook summary on stderr, listing
  every patch and the target file it hooked (or that it never loaded);
- **patch composition** — fabric-dsh merges the profile's patch layers
  (bundle `cordis.patch.yml` files, the profile layer, the `$DSH_HOME` layer,
  `--patch` overlays) with the Loader's id-targeted semantics and aggregates
  the `config.fabric.patches` every row declares (the `cordis-fabric` row is
  the canonical carrier);
- **Fabric-required rows** — a row whose config declares
  `config.fabric.patches` hard-depends on the Fabric layer: it ships
  disabled, and fabric-dsh enables it through a generated `--patch` overlay
  (after every user layer). A plain `dsh` boot therefore skips such rows
  entirely (the app runs, the dependent plugins stay unloaded), while
  fabric-dsh loads them with the hooks installed and verifies required
  bindings one tick after mount; explicitly enabling such a row on a plain
  `dsh` boot fails loud (the Host plugin's post-boot gate);
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
# one-time: harness deps/build + profile seed + bundle install + row enable
pnpm run install:host -- <deepseek-harness-checkout> --dsh-home "$HOME/.dsh_dev"
# the bundle ships the launcher — no bundle checkout needed afterwards
"$HOME/.dsh_dev/profiles/web/node_modules/.bin/fabric-dsh" \
  --source <deepseek-harness-checkout> web --port 8000
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
