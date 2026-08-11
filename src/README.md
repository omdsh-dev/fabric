# Source Layout

The baseline source entries are:

- `src/index.ts`: Loader-facing plugin namespace and public exports;
- `src/invariant.ts` and `src/api/invariant.ts`: package-owned invariant companions;
- `src/host-contracts.ts`: the only view of the DSH host runtime — narrow structural contracts for every `@deepseek-ai/*` service this package delegates to;
- `src/service.ts` and `src/runtime.ts`: platform-free Fabric registry and patch dispatch;
- `src/api/`: cooperative Mod-facing Host facades (`agent`, `tools`, `prompt`, `commands`, `compat`);
- `src/client/`: combined browser face (bridge, service, and client facade).

Rules:

- Never import a private `@deepseek-ai/*` package. Extend `src/host-contracts.ts` when a facade needs a new host surface, and keep the contract narrow: only what the facades actually forward.
- Keep `src/index.ts` limited to Loader metadata and re-exports.
- Keep platform-free code free of `node:*` imports so the browser bundle can reuse it; Node-only machinery stays in `src/node-loader.ts`, `src/serve.ts`, and `src/browser-transform.ts`.
- Add `src/<feature>/` directories only when a cohesive capability warrants the split.
