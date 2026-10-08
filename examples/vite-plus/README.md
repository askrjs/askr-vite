# Vite+ starter

This minimal island uses Vite+ 1.1.0 for development, production builds, lint
checks, and Vitest tests. The `vite` dependency is the matching Vite+ core alias;
do not replace it with regular Vite when using this toolchain.

The starter consumes a packed artifact from this checkout. Vite+ 1.1.0 peer
compatibility is available from `@askrjs/vite@0.4.2`.

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
