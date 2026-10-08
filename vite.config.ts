import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// `base: './'` mantiene todas las rutas relativas, así el sitio funciona igual en la raíz de un
// dominio o en el subdirectorio de GitHub Pages (https://<usuario>.github.io/Gaussian-AR/).
// Dos páginas: `index.html` (el visor) y `ar.html` (realidad aumentada con 8th Wall).

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

        // Sin «tocar para enfocar»: un toque o doble clic sobre la escena no cambia el centro de giro
        const pick = 'async _pickSceneTarget(offsetX, offsetY) {';
        if (!code.includes(pick)) throw new Error('patch-supersplat-viewer: no se encontró _pickSceneTarget');
        code = code.replace(pick, pick + '\n        if (globalThis.__NO_PICK) return null;');

        return { code, map: null };
    }
});

/**
 * Motor de 8th Wall (binario con SLAM, paquete `@8thwall/engine-binary`). Su licencia exige usarlo sin
 * modificar y conservar su aviso de derechos de autor, así que se copia tal cual a `external/xr/`
 * (sin pasar por el empaquetador), que es donde `ar.html` lo carga.
 */
const engine8thWall = (): Plugin => {
    const src = fileURLToPath(new URL('./node_modules/@8thwall/engine-binary/dist', import.meta.url));
    let outDir = 'dist';
    const types: Record<string, string> = {
        '.js': 'text/javascript',
        '.svg': 'image/svg+xml',
        '.glb': 'model/gltf-binary'
    };
    return {
        name: 'engine-8thwall',
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },
        configureServer(server) {
            server.middlewares.use('/external/xr', (req, res, next) => {
                const file = join(src, decodeURIComponent((req.url ?? '/').split('?')[0]));
                if (!file.startsWith(src) || !existsSync(file) || !statSync(file).isFile()) return next();
                res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
                createReadStream(file).pipe(res);
            });
        },
        closeBundle() {
            if (!existsSync(src)) throw new Error('engine-8thwall: falta @8thwall/engine-binary (npm install)');
            cpSync(src, join(outDir, 'external', 'xr'), { recursive: true });
        }
    };
};

export default defineConfig({
    base: './',
    plugins: [patchSuperSplat(), engine8thWall()],
    optimizeDeps: { exclude: ['@playcanvas/supersplat-viewer'] },
    build: {
        target: 'es2022',
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 4000,
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                elVado: fileURLToPath(new URL('./el-vado.html', import.meta.url)),
                ar: fileURLToPath(new URL('./ar.html', import.meta.url)),
                arCero: fileURLToPath(new URL('./ar-cero.html', import.meta.url)),
                recorrido: fileURLToPath(new URL('./recorrido.html', import.meta.url))
            }
        }
    }
});
