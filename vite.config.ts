import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => {
  const base = process.env.VITE_BASE || (command === 'build' ? '/Patio-sky/' : '/');
  return {
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Patio Sky',
        short_name: 'Patio Sky',
        description: 'Offline sky guide for the Sylmar patio and dark sites.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,txt,woff2}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackAllowlist: [new RegExp(base === '/' ? '^/' : '^/Patio-sky/')],
        modifyURLPrefix: base === '/' ? undefined : { '': base },
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  server: { host: '0.0.0.0', port: 4317 },
  preview: { host: '0.0.0.0', port: 4317 },
  test: {
    environment: 'node',
    include: ['test/**/*.ts'],
  },
};
});
