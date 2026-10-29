import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Read VITE_* variables from the single .env at the repo root.
  // Only VITE_* variables reach the browser, so backend secrets stay private.
  envDir: '..',
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
