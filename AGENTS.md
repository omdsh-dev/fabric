# Fabric Contributor Notes

This repository is a standalone DeepSeek Harness Fabric/Mixin extension workspace.

- The workspace contains exactly three complete packages: `cordis-fabric` (pure transformation service), `cordis-fabric-api` (pure compat facade), and `cordis-fabric-dsh` (DSH-facing facades, invariant, profile bootstrap). Never add a fourth package: any code outside these three — the official `@deepseek-ai/dsh-tool-cordis` toolset included — is applied as a pnpm dependency patch stored in `patches/` and declared in `pnpm-workspace.yaml`. Host-side launcher/bootstrap and browser build seams the trio needs to run are supplied by `src/fabric-dsh.ts`, its tsdown output `lib/fabric-dsh.js`, and `packages/cordis-fabric/preload.mjs`; historical seam metadata remains in `patches/` (see `patches/README.md`).
- Preserve the function-plugin named exports: `name`, `inject`, `Config`, and `apply`; do not add a default export.
- Keep Loader metadata in each package's `src/index.ts`, narrow host-package type imports in `packages/cordis-fabric-dsh/src` (facades import the real `@deepseek-ai/dsh-*` types and declare them as peers), and platform-free service/runtime machinery in `packages/cordis-fabric/src/service.ts` and `packages/cordis-fabric/src/runtime.ts`.
- Keep all registrations scoped to the plugin fiber and test disposal.
- The DSH host packages (`@deepseek-ai/dsh-*`) are installable from the npm registry; import their types directly and declare them as peer + dev dependencies. Never add a package import or a path that resolves outside this repository.
- Keep host-provided runtime APIs as peer dependencies only when they are installable from the registry; document host-only services as runtime contracts instead.
- Cross-package dependencies use the `workspace:^` protocol; every other dependency spec is registry-only. Do not add source, configuration, documentation, project-reference, `link:`, or `file:` paths that leave this repository.
- Describe repository files with project-root paths such as `packages/cordis-fabric/README.md`; never use parent-directory navigation in documentation.
- Update `README.md`, configuration JSDoc, tests, and `cordis.patch.yml` together when behavior changes.
- Run `pnpm run verify:self-contained`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, and `pnpm run prepare` before publishing changes.
