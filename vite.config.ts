import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// `base: './'` keeps every asset reference relative, so the built site works
// unchanged whether it's served from a domain root or a GitHub Pages project
// subpath (https://<user>.github.io/Gaussian-AR/).
//
// Two pages: `index.html` is the 3D viewer, `ar.html` is the WebXR AR experience.
export default defineConfig({
    base: './',
    build: {
        target: 'es2022',
        assetsInlineLimit: 0,
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                ar: fileURLToPath(new URL('./ar.html', import.meta.url))
            }
        }
    }
});
