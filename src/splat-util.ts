// Utilidades compartidas por el visor (index.html) y la historia con scroll (historia.html).
import type { ViewerHandle } from '@playcanvas/supersplat-viewer/viewer';
import { Vec3 } from 'playcanvas';
import type { GSplatComponent } from 'playcanvas';

import type { Pose } from './story';

/**
 * Origen de las ondas del efecto en la entrada: la superficie de la maqueta que se ve en el centro de la pantalla en
 * el primer cuadro (el splat más cercano a la cámara sobre su línea de mirada), en coordenadas del MUNDO, que es como
 * trabaja el modificador del work buffer. Antes se pasaba al espacio local del splat y, con la rotación de 180° del
 * visor, quedaba espejado unos 60 por debajo del suelo: las ondas tardaban segundos en llegar a la maqueta y casi toda
 * la entrada se veía vacía. Si no hay splats en esa línea, se usa el punto de mira.
 */
export const revealOrigin = (v: ViewerHandle, from: Pose['position'], to: Pose['target']): Pose['target'] => {
    const gs = (v.app.root.findComponents('gsplat') as GSplatComponent[])[0];
    const centers = (gs?.resource as { centers?: Float32Array } | undefined)?.centers;
    if (!gs || !centers) return to;
    const m = gs.entity.getWorldTransform();
    const o = new Vec3(...from);
    const d = new Vec3(...to).sub(o).normalize();
    const p = new Vec3();
    const w = new Vec3();
    let best = Infinity;
    let hit: Pose['target'] | null = null;
    for (let i = 0; i + 2 < centers.length; i += 3) {
        m.transformPoint(p.set(centers[i], centers[i + 1], centers[i + 2]), w);
        const ax = w.x - o.x, ay = w.y - o.y, az = w.z - o.z;
        const along = ax * d.x + ay * d.y + az * d.z;
        if (along <= 0.5 || along >= best) continue;
        const perp2 = ax * ax + ay * ay + az * az - along * along;
        const tol = Math.max(0.8, along * 0.02);
        if (perp2 <= tol * tol) {
            best = along;
            hit = [w.x, w.y, w.z];
        }
    }
    return hit ?? to;
};

/**
 * Llama a `done` cuando el Gaussian se está dibujando de verdad: con la compilación de shaders en paralelo, el motor
 * omite los draws cuyo shader aún no está listo (la escena «corre» pero no se ve). Se espera a que el copiado al work
 * buffer (con el efecto) y el dibujo del splat se ejecuten con shader válido. Tope de 20 s por si acaso.
 */
export const waitUntilDrawn = (v: ViewerHandle, done: () => void) => {
    type Dev = { draw: (...a: unknown[]) => unknown; shader: { name?: string } | null; shaderValid?: boolean };
    const dev = v.app.graphicsDevice as unknown as Dev;
    const orig = dev.draw;
    let copied = false;
    let drawn = false;
    dev.draw = function (this: Dev, ...a: unknown[]) {
        const r = orig.apply(this, a);
        const name = this.shader?.name ?? '';
        if (this.shaderValid) {
            if (name.includes('SplatCopyToWorkBuffer')) copied = true;
            else if (name.includes('Splat')) drawn = true;
        }
        return r;
    };
    const start = performance.now();
    let finished = false;
    const tick = () => {
        if (finished) return;
        v.app.renderNextFrame = true;
        if ((copied && drawn) || performance.now() - start > 20000) {
            finished = true;
            dev.draw = orig;
            // un cuadro más para que lo dibujado llegue a la pantalla
            requestAnimationFrame(() => done());
            return;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};
