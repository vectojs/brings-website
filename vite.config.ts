import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 2324,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
