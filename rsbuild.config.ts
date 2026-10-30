import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  html: {
    title: 'Phonble',
  },
  plugins: [
    pluginReact({
      reactCompiler: true,
    }),
  ],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ws': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
