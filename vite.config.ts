import { defineConfig } from 'vite';

// `base: './'` keeps every asset reference relative, so the built site works
// unchanged whether it's served from a domain root or a GitHub Pages project
// subpath (https://<user>.github.io/Gaussian-AR/).
export default defineConfig({
    base: './',
    build: {
        target: 'es2022',
        assetsInlineLimit: 0
    }
});
