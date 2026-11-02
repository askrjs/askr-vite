# Vite+ starter

This minimal island uses Vite+ 1.4.0 for development, production builds, lint
checks, and its built-in Vitest tests. The `vite` dependency is the matching
Vite+ core alias; do not replace it with regular Vite when using this toolchain.

The starter consumes a packed artifact from this checkout. `@askrjs/vite`
requires Vite+ 1.4 or newer in the 1.x line.

From the repository root:

```sh
npm ci
npm run build
npm pack --ignore-scripts
cd examples/vite-plus
npm install
npm run check
npm test
npm run build
npm run dev
```

`check` runs static lint checks. All four scripts use `vp`; the starter does not
need a separate regular Vite or Vitest installation. The package's browser
consumer suite installs this starter against the actual tarball and exercises
these commands.

The starter pins MSW 2.15.0 and imports tests from `vite-plus/test`. Its native
mock test runs real `@askrjs/fetch` requests through an Askr query, exercises
errors and retry, then closes interception and checks the real HTTP server.
The installed consumer test checks the exact Vite+ core peer diagnostics after
install and clean ci, with no missing or extraneous packages. See the
[toolchain notes](../../README.md#test-runners-and-api-mocks) for the supported
MSW version and peer checks.

Browser mocks are disabled by default. Generate the exact installed MSW
package's worker once:

```sh
npm exec -- msw init public --save
```

Set `VITE_ENABLE_MOCKS=true` in the development environment before running
`npm run dev`. The app awaits worker startup before mounting; `/api/profile`
then returns `{ "name": "Development profile" }`. The development check and
native tests do not require browser mocking. Production builds omit the mock
startup and handler code even when this development variable is set.
