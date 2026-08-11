# Fabric Contributor Notes

This repository is a standalone DeepSeek Harness Fabric/Mixin extension bundle.

- Preserve the function-plugin named exports: `name`, `inject`, `Config`, and `apply`; do not add a default export.
- Keep Loader metadata in `src/index.ts`, narrow host contracts in `src/host-contracts.ts`, and platform-free service/runtime machinery in `src/service.ts` and `src/runtime.ts`.
- Keep all registrations scoped to the plugin fiber and test disposal.
- The DSH host packages (`@deepseek-ai/dsh-*`) are private and not installable from the npm registry. Import their types only through the narrow structural contracts in `src/host-contracts.ts`; never add a package import or a path that resolves outside this repository.
- Keep host-provided runtime APIs as peer dependencies only when they are installable from the registry; document host-only services as runtime contracts instead.
- Do not add source, configuration, documentation, project-reference, `link:`, or `file:` paths that leave this repository.
- Describe repository files with project-root paths such as `docs/fabric.md`; never use parent-directory navigation in documentation.
- Update `README.md`, configuration JSDoc, tests, and `cordis.patch.yml` together when behavior changes.
- Run `pnpm run verify:self-contained`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, and `pnpm run prepare` before publishing changes.
