import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// `base: './'` mantiene todas las rutas relativas, así el sitio funciona igual en la raíz de un
// dominio o en el subdirectorio de GitHub Pages (https://<usuario>.github.io/Gaussian-AR/).
// El AR (ar.html) está desactivado por ahora: su código sigue en src/ar-experience.ts.

/**
 * El visor de SuperSplat fija el giro vertical de la órbita en -90°…90° y no expone ese límite.
 * Este parche (versión fija del paquete) lo vuelve configurable desde la página, y añade un
 * suelo opcional al modo de vuelo. Si el paquete cambia y el texto no se encuentra, la
 * compilación falla en vez de publicar un visor sin el límite.
 */
const patchSuperSplat = (): Plugin => ({
    name: 'patch-supersplat-viewer',
    enforce: 'pre',
    transform(code, id) {
        if (!/supersplat-viewer[\\/]dist[\\/]viewer\.js$/.test(id)) return null;

        const pitch = 'this.controller.pitchRange = new Vec2(-90, 90);';
        if (!code.includes(pitch)) throw new Error('patch-supersplat-viewer: no se encontró pitchRange');
        code = code.replace(
            pitch,
            'this.controller.pitchRange = new Vec2(globalThis.__ORBIT_PITCH_MIN ?? -90, globalThis.__ORBIT_PITCH_MAX ?? 90);'
        );

        const fly = /this\._step\(move\);(\s*)camera\.position\.copy\(this\._position\);/;
        if (!fly.test(code)) throw new Error('patch-supersplat-viewer: no se encontró el paso del modo vuelo');
        code = code.replace(
            fly,
            'this._step(move);$1this._position.y = Math.max(this._position.y, globalThis.__FLY_MIN_Y ?? -Infinity);$1camera.position.copy(this._position);'
        );

        return { code, map: null };
    }
});

export default defineConfig({
    base: './',
    plugins: [patchSuperSplat()],
    optimizeDeps: { exclude: ['@playcanvas/supersplat-viewer'] },
    build: {
        target: 'es2022',
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 4000
    }
});
