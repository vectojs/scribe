import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3517,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
