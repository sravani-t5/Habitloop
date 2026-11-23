import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // Static SPA build -> uploaded to S3 (+ CloudFront). "index.html" fallback gives client-side routing.
  kit: { adapter: adapter({ fallback: 'index.html' }) }
};
