import { defineConfig } from 'vite';

// Relative base so the build works from GitHub Pages or any sub-folder.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
});
