import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  clean: true,
  dts: true,
  sourcemap: true,
  target: 'node20', // Update target for crypto.randomUUID
  banner: {
    js: '#!/usr/bin/env node',
  },
});