import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  // Bundle the shared workspace package; keep real npm deps external.
  noExternal: ['@zirzircord/shared'],
});
