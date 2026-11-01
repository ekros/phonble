import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginBasicSsl } from '@rsbuild/plugin-basic-ssl';

const relayPort = Number(process.env.RELAY_PORT ?? 3001);

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  html: {
    title: 'Phonble',
  },
  plugins: [
    pluginReact({
      reactCompiler: true,
    }),
    ...(process.env.HTTPS === '1' ? [pluginBasicSsl()] : []),
  ],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ws': {
        target: `http://localhost:${relayPort}`,
        ws: true,
      },
    },
  },
});
