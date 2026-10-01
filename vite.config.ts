import { defineConfig } from 'vite';

// `base: './'` mantiene todas las rutas relativas, así el sitio funciona igual en la raíz de un
// dominio o en el subdirectorio de GitHub Pages (https://<usuario>.github.io/Gaussian-AR/).
// El AR (ar.html) está desactivado por ahora: su código sigue en src/ar-experience.ts.
export default defineConfig({
    base: './',
    build: {
        target: 'es2022',
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 4000
    }
});
