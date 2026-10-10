# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.5.0 - 2026-10-10

### Breaking changes

- Keep the named `askr` factory at the root; remove the duplicate default and
  `askrVitePlugin` exports. Remove the unused `ssrPrecompile` option, which never
  changed output.
- Keep `ImagePipelineOptions` at the root and remove its duplicate `/image`
  reexport. Keep per-declaration `ImageOptions` at `/image`.
- Narrow `/server` to `askrServer`, `createDocumentApp`, and their three option/plugin
  types. Retire the seven low-level marker and response/head/fragment helper
  exports while preserving the internal implementations.
- Document every removed name and its migration in
  [the migration guide](docs/migration-0.5.0.md). All four export keys and their
  Node/browser conditions remain.

### Fixed

- Watch declared source images directly and recreate emitted asset references for
  each build. Source-only replacement, deletion/recreation, repeated entry edits,
  unchanged declaration modules and removal of the last declaration now produce
  the current assets and checked metadata.
- Resolve declared image URLs using file-URL semantics, preserving spaces,
  Unicode and percent-encoded reserved characters in real filesystem paths.
- Encode emitted asset filenames in checked `src`/`srcset` URLs, so Node metadata
  with spaces or Unicode selects the same responsive candidates as the browser
  client instead of falling back to the full-size source image.
- Reject malformed checked Node metadata with an attributed rebuild instruction,
  preserving finite positive dimensions including fractional SVG dimensions.
  Missing source files identify the image and restoration step.
- Preserve preceding client metadata during an unrelated SSR build.

### Added

- Standardize first-party tests and configuration examples on Vite+ imports.
  Keep Vite+ 0.3.3/MSW 2 as the Askr setup path; plain Vite remains an internal
  compatibility control for the existing public plugin contract.

- Installed mock/test toolchain coverage using native Core/Fetch requests, real
  MSW browser workers, loading/error/retry, HMR and interception cleanup. Qualify
  Vite+ 0.3.3/MSW 2.15.0 as the primary Askr recipe using its built-in runner
  with the exact upstream alias-peer diagnostic. Keep plain Vite
  8.2.2/Vitest 5.0.3/MSW 2.15.0 as a peer-clean secondary compatibility control
  and Vite+ 1.1.0 as a separate runtime characterization, not a required upgrade.
- Explicit MSW 3/Vite+ and MSW 3/Vitest mocker peer-boundary regressions, plus
  development-only opt-in MSW 2 setup in the Vite+ starter. No plugin runtime,
  public API, peer range or production dependency changes.
- Pin the existing three-OS CI matrix to the qualified Node 24.21.0 and npm
  12.0.1 resolver so installed-toolchain graph assertions run with the recorded
  tool versions.
- Strict normally installed TypeScript 6 and 7 consumers covering all retained and
  retired public names, virtual server types, private paths and runtime namespaces.
- Real installed watch/recovery coverage for Vite 8.2.2 and Vite+ 0.3.3/1.1.0,
  original source maps for unusual paths and duplicate identical plugin setup,
  and deterministic captured-source recovery probes.
- Compatible development lock corrections for Vite+ 0.3.3,
  `tinypool` 2.1.2, `source-map-js` 1.2.2 and `sharp` 0.35.5. Existing toolchain ranges remain;
  no runtime dependency range or package version changes.

### Development

- First-party development workflows use Vite+; specialized compiler, runtime,
  browser, and package checks remain part of validation.

## 0.4.2 - 2026-10-08

### Breaking changes

- None.

### Deprecations

- None.

### Fixed

- Accept Vite+ 1.1.x and matching Vite+ core aliases as optional build-tool peers.
  Qualify regular Vite 8.2.2 and Vite+ 0.3.1/1.1.0 with clean installed consumers,
  browser HMR, server builds, and responsive images.
- Install browser engines for the complete hosted publication gate.

### Added

- Include a minimal Vite+ starter using `vp` for development, lint checks,
  tests, and builds against the checkout's packed artifact.

## 0.4.1 - 2026-09-30

### Fixed

- Decode versioned and legacy route metadata headers so Unicode metadata
  produced by `@askrjs/server` is restored correctly.
- Insert document fragments and head content literally, preserving replacement
  strings such as `$$`, `$&`, and backtick/apostrophe sequences.
