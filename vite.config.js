import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        // This app runs entirely in the browser; React server boundaries do not apply.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        defaultHandler(warning);
      },
    },
  },
});
