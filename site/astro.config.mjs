import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  site: 'https://carvalhovini.com',
  integrations: [preact()],
  server: { port: 4321 },
});
