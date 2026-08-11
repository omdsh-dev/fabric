# Standalone Fabric Bundle Contracts

This reference is shipped with the repository so planning, implementation, testing, and distribution use only guidance stored below the repository root.

## Repository boundary

All source, TypeScript configuration, test fixtures, skill instructions, and contributor guidance used by this repository live below the repository root. Describe repository files with project-root paths such as `docs/fabric.md`; parent-directory navigation is not valid documentation. Paths that leave the repository are not valid template inputs. Ordinary npm dependencies are allowed; a dependency is not a source or configuration file reference.

A DSH host is a runtime consumer of the finished package, not a development input. The host supplies the authoritative services the facades delegate to and applies the package's bundle patch when the package is installed into a profile.

## Host contracts

The `@deepseek-ai/dsh-*` host packages are private and not installable from the npm registry. `src/host-contracts.ts` is the package's only view of the host runtime: it declares the smallest structural surface the facades actually forward, plus the Cordis `Context` service and `Events` augmentations those facades rely on. Extend it only when a facade needs a new host surface, and keep the contracts narrow.

## Plugin forms

A function plugin exports `name`, `inject`, `Config`, and `apply` as one ESM namespace and has no default export. A service plugin default-exports its `Service` subclass and follows the host service lifecycle. Do not combine the two loader forms. Required Cordis services belong in `inject`; optional services are read through named lookup.

## Lifecycle ownership

Every listener, registry entry, timer, watcher, child process, and callback registered by a plugin belongs to its Cordis fiber. Use effects or returned disposers and test removal after fiber disposal. Publish state and emit events only after the owning operation succeeds. A waterfall listener delegates by calling `next()`.

## Invariant companion

Every package entry may expose `./invariant` as a separate function plugin. Its installer checks an authoritative event or data relationship owned by the package. An empty installer is valid only when the package owns no observable relationship; explain that reason in the source. The companion resolves the host `invariants` service through the narrow local contract in `src/host-contracts.ts`.

## Bundle composition

`package.json` declares the bundle patch with `dsh.bundle.patch`. `cordis.patch.yml` inserts or overrides plugin rows; it does not change source files, compiler settings, catalogs, or launcher code. An id-targeted override replaces the complete `config`, so retained fields must be restated. The package row name must resolve through the consuming DSH profile.

## Evidence

The minimum package evidence includes a real Loader export-shape test, schema/default behavior, observable plugin behavior, and disposal. Host-facing facades additionally need real composition tests over the repository-local fakes in `tests/fakes.ts`, and serve primitives need real HTTP evidence through `tests/fakes.ts`. Typechecking, tests, and a development build are separate checks.

## Build and distribution

The development build is:

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

The self-contained prepare build is:

```sh
pnpm run prepare
```

It emits declarations and runtime JavaScript using only this repository's installed dependencies. `pnpm pack --dry-run --json` runs lifecycle scripts; inspect its final file list and restore a development build afterward when the pack lifecycle cleans or replaces generated files.

A package is ready for Git or npm only when every manifest-declared runtime and type entry exists after the relevant consumer lifecycle. Publishing, pushing, tagging, and registry operations remain separately authorized actions.
