import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: 'src/index.js',
    format: ['esm'],
    outDir: 'dist',
    platform: 'node',
    dts: false,
    sourcemap: true,
    copy: [{ from: 'src/index.d.ts', to: 'dist', flatten: true }],
    deps: {
      neverBundle: ['vite', /^@askrjs\/askr(?:\/.*)?$/],
    },
  },
});
