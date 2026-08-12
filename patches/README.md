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

The patch is the **complete** upstream diff `4ee4ae88..0e1065d4` restricted to everything outside the shipped packages: the only excluded paths are the three package directories themselves, so a host at `4ee4ae88` plus this patch becomes `0e1065d4` minus the trio. Nothing outside the packages is dropped. The 69-file diff covers:

- `apps/cli/` — launcher wiring and bootstrap verification: `src/profile-boot.ts` calls `installFabricBootstrap` in the boot prepare phase (before any target module import) and `checkFabricRequiredPatches` after boot; `ProfileRows` becomes the fabric row type; `tests/fabric-bootstrap-*` and its fixture verify it; `package.json` / `tsconfig.json` wire the CLI build.
- `packages/bundle/web-app/` — `cordis.patch.yml` roster rows `cordis-fabric` and `cordis-fabric-dsh` (disabled opt-ins) and `package.json` bundle dependencies on the three packages.
- `packages/client/tsdown.client.ts` — the `clientBundle` opt-in source `transform` (the browser build seam Fabric bundles rewrite through).
- `packages/self-modification/tool-cordis/src/api-catalog.ts` — the official package's catalog entries for the fabric services and types; the host needs them for the fabric APIs to be visible in its catalog.
- `packages/typert/generator/` and `scripts/gen-cordis-catalog.ts` — catalog generation adapts to the three packages.
- `scripts/` — host-side tests (`client-bundle-source-transform.spec.ts`, `dev-web-fabric.spec.ts`), workspace-constraint and doc-graph updates, invariant and README gate exemptions.
- `tsconfig.base.json` (source paths for the trio), `tsconfig.host.json` / `tsconfig.client.json` (project references), root `package.json` (dev dependency `unrun`, catalog script `tsx --tsconfig`), `pnpm-lock.yaml`, `knip.json`, `.gitignore` (fixture `node_modules` negations).
- Documentation that changed with the feature: root `README*`, `THIRD_PARTY_NOTICES.md`, `docs/`, and `.agents/notes/implemented/` (architecture and testing notes, including the Fabric HMR e2e proof).

Apply it from a deepseek-harness checkout at snapshot `4ee4ae88` (or any tree that lacks the wiring):

```sh
git apply patches/fabric-host-integration.patch
```

A host already at `0e1065d4` or later already contains this wiring and needs nothing. Regenerate the patch from upstream when the fabric host integration changes again:

```sh
git -C <deepseek-harness> diff 4ee4ae888fb8e5c2fb2f81ebd7064d02034e3792 0e1065d4 -- . \
  ':(exclude)packages/self-modification/cordis-fabric' \
  ':(exclude)packages/self-modification/cordis-fabric-api' \
  ':(exclude)packages/self-modification/cordis-fabric-dsh' \
  > patches/fabric-host-integration.patch
```
