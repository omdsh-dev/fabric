# Test Layout

`tests/fabric/` owns the transformation, loader, browser, testkit, and serve primitives. `tests/api/` owns the cooperative Host/client facades, their assembled compositions, and the compat adapter. `tests/fakes.ts` provides repository-local structural fakes for the private DSH host services (`tools`, `systemPrompt`, `commands`, browser `command`/`slots`, and `httpServer`); each fake is a Cordis `Service` subclass so registrations are owned by the calling fiber, and every HMR-safety assertion runs against that ownership.

Rules:

- Extend `tests/fakes.ts` instead of importing a private host package; keep fake behavior structurally compatible with the real service contract.
- Child-process suites (`tests/fabric/child-runner.mjs`, `tests/api/child-runner-compat.mjs`, `tests/fabric/multi-install.mjs`, `tests/fabric/async-fallback.mjs`) resolve against this repository's own sources and never against another checkout.
- Add fixtures under `tests/snapshots/` only for stable user-, model-, CLI-, terminal-, editor-, or browser-visible expected output, with an explicit refresh command.
- Tests must remain typechecked by `tsconfig.vitest.json`.
