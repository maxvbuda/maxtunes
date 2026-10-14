import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works both locally and under /maxtunes/ on GitHub Pages.
  base: './',
  plugins: [react()],
  server: { port: 5180, open: false },
  build: { outDir: 'dist', sourcemap: true },
});
