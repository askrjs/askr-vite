# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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

- Strict normally installed TypeScript 6 and 7 consumers covering all retained and
  retired public names, virtual server types, private paths and runtime namespaces.
- Real installed watch/recovery coverage for Vite 8.2.2 and Vite+ 0.3.3/1.1.0,
  original source maps for unusual paths and duplicate identical plugin setup,
  and deterministic captured-source recovery probes.
- Compatible development lock corrections for Vite+ 0.3.3,
  `tinypool` 2.1.2, `source-map-js` 1.2.2 and `sharp` 0.35.5. Existing toolchain ranges remain;
  no runtime dependency range or package version changes.

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
