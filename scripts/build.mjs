// Builds the extension into dist/:
//   popup/   React UI (Vite app)
//   content.js, hook.js, background.js  (single-file IIFE bundles — MV3 content scripts can't be ES modules)
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const watchOpt = watch ? {} : null;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (!existsSync(resolve(root, 'public/icons/icon-128.png'))) {
  execFileSync(process.execPath, [resolve(root, 'scripts/generate-icons.mjs')], { stdio: 'inherit' });
}

const scripts = [
  ['content', 'src/content/index.ts'],
  ['hook', 'src/content/hook.ts'],
  ['background', 'src/background/index.ts'],
];

for (const [name, entry] of scripts) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir: dist,
      emptyOutDir: false,
      watch: watchOpt,
      minify: !watch,
      target: 'chrome120',
      lib: { entry: resolve(root, entry), formats: ['iife'], name: `nightshift_${name}`, fileName: () => `${name}.js` },
    },
  });
}

await build({
  configFile: false,
  root: resolve(root, 'src'),
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  publicDir: resolve(root, 'public'),
  build: {
    outDir: dist,
    emptyOutDir: false,
    watch: watchOpt,
    target: 'chrome120',
    rollupOptions: { input: { popup: resolve(root, 'src/popup/index.html') } },
  },
});

console.log(watch ? 'NightShift: watching for changes…' : 'NightShift: built to dist/');
