import { defineConfig } from 'astro/config';
import { resolveHosting } from './config/hosting.mjs';

export default defineConfig({
  ...resolveHosting(),
  output: 'static',
  build: { format: 'file' },
});
