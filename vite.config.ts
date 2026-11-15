import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    watch: {
      // Skip non-source folders so the dev server doesn't track thousands of test/build files
      ignored: ['**/scratch/**', '**/dist/**', '**/docs/**', '**/scripts/**']
    }
  },
  build: {
    target: 'esnext'
  }
});

