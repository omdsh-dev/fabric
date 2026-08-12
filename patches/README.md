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

`fabric-host-integration.patch` carries the deepseek-harness host-side changes the three packages need in order to RUN. The three packages only know how to install hooks and mount facades; a DSH host at the pre-split snapshot does not call them, so the bundle would be inert without this patch.

The patch keeps only the seams the official plugin registration system cannot provide. Everything the official channels handle is deliberately excluded: installing the trio (`dsh plugin --profile <p> add github:dsh-external/fabric`), bundle roster rows and dependencies, catalog generation over the workspace, invariant/gate exemptions for trio-in-workspace, and documentation (`README*`, `docs/`, `.agents/`). The 15-file diff covers the seams only:

- `apps/cli/` — launcher wiring and bootstrap verification: `src/profile-boot.ts` calls `installFabricBootstrap` in the boot prepare phase (before any target module import) and `checkFabricRequiredPatches` after boot; `ProfileRows` becomes the fabric row type; `tests/fabric-bootstrap-*` and its fixture verify it; `package.json` / `tsconfig.json` wire the CLI build (the static `cordis-fabric-dsh` import resolves from the workspace, so this seam is for source hosts until the official host merges the wiring).
- `packages/client/tsdown.client.ts` — the `clientBundle` opt-in source `transform` (the browser build seam; `dsh.client` has no transform field, so the host build tool must expose it).
- `packages/self-modification/tool-cordis/src/api-catalog.ts` — the official package's catalog entries for the fabric services and types; the catalog is compiled into the official package with no runtime registration path, so the entries must be patched in.
- `scripts/` — host-side seam tests (`client-bundle-source-transform.spec.ts`, `dev-web-fabric.spec.ts`).
- `tsconfig.host.json` / `tsconfig.client.json` (include/exclude the new seam spec), `knip.json` and `.gitignore` (the `apps/cli` bootstrap fixture).

Apply it from a deepseek-harness checkout at snapshot `4ee4ae88` (or any tree that lacks the wiring):

```sh
git apply patches/fabric-host-integration.patch
```

or with the applier (idempotent: detects hosts that already contain the wiring):

```sh
pnpm run patch:host -- <deepseek-harness-checkout>
```

The bundle itself installs through the official plugin channel: `dsh plugin --profile <p> add github:dsh-external/fabric`.

A host already at `0e1065d4` or later already contains this wiring and needs nothing. Regenerate the patch with the extraction script instead of by hand — it reproduces the seam-only diff mechanically (worktree at the upstream commit, reverts the registry-handled files to the baseline, reduces the four partially-kept files to their seam lines, excludes trio and documentation, and verifies forward and reverse apply). The values live in `patches/host-patch.config.json`:

```sh
pnpm run extract:patch -- --harness <fork-checkout>
```

The `--harness` checkout must contain both snapshots (the fork worktree, e.g. the `feat-fabric` branch). The script fails loud when a seam anchor has drifted upstream.
