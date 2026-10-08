# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- Accept Vite+ 1.1.x and matching Vite+ core aliases as optional build-tool peers.
  Qualify regular Vite 8.2.2 and Vite+ 0.3.1/1.1.0 with clean installed consumers,
  browser HMR, server builds, and responsive images.

### Added

- Include a minimal Vite+ starter using `vp` for development, lint checks,
  tests, and builds against the checkout's packed artifact.

## 0.4.1 - 2026-09-30

### Fixed

- Decode versioned and legacy route metadata headers so Unicode metadata
  produced by `@askrjs/server` is restored correctly.
- Insert document fragments and head content literally, preserving replacement
  strings such as `$$`, `$&`, and backtick/apostrophe sequences.
