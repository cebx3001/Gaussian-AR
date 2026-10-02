// ---------------------------------------------------------------------------
// Radial Reveal: el efecto de PlayCanvas para Gaussian Splatting (viene dentro del paquete
// `playcanvas`, `scripts/esm/gsplat/reveal-radial.mjs`). Desde un punto central salen dos ondas:
//   1. la onda de puntos: los splats aparecen como puntos diminutos de color
//   2. la onda de elevación: se levantan, se resaltan y crecen hasta su forma y color reales
// Al terminar, el efecto se retira solo y la escena queda exactamente como es.
//
// Se usa el shader y la lógica del efecto oficial. Como el visor de SuperSplat dibuja los splats en
// modo «unified», el shader se conecta con `setWorkBufferModifier` (la vía que el motor prevé para
// efectos con tiempo) y el work buffer se actualiza en cada cuadro mientras dura el efecto.
// ---------------------------------------------------------------------------
import type { ViewerHandle } from '@playcanvas/supersplat-viewer/viewer';
import { Vec3, WORKBUFFER_UPDATE_ALWAYS, WORKBUFFER_UPDATE_AUTO } from 'playcanvas';
import type { GSplatComponent } from 'playcanvas';
import { GSplatRevealRadial } from 'playcanvas/scripts/esm/gsplat/reveal-radial.mjs';

export type RevealOptions = {
    /** Centro de las ondas, en coordenadas de la escena (mundo). */
    center: [number, number, number];
    /** Distancia a la que termina el efecto: debe cubrir toda la escena. */
    radius: number;
    /** Velocidad inicial de las ondas (unidades de la escena por segundo). */
    speed: number;
    /** Cuánto aumenta esa velocidad por segundo (0 = frente a velocidad constante). */
    acceleration?: number;
    /** Segundos que la onda de elevación va detrás de la de puntos. */
    delay: number;
    /** Intensidad de la elevación y el temblor (unidades de la escena). */
    lift?: number;
    /** Grosor de las bandas de color (unidades de la escena). */
    band?: number;
    /**
     * El efecto oficial está pensado para objetos pequeños: sus puntos miden 5 mm. Este factor los
     * agranda para una escena de ~130 m (1 = tal cual el efecto original).
     */
    dotScale?: number;
};

/** Arranca el efecto sobre el splat del visor. Devuelve una función que lo detiene. */
export const startReveal = (v: ViewerHandle, o: RevealOptions): (() => void) => {
    const gs = (v.app.root.findComponents('gsplat') as GSplatComponent[])[0];
    if (!gs) return () => {};

    // el efecto trabaja en el espacio local del splat: se convierte el centro desde el mundo
    const local = gs.entity.getWorldTransform().clone().invert().transformPoint(new Vec3(...o.center));

    // instancia del efecto oficial, solo para su configuración, su shader y su duración
    const fx = new GSplatRevealRadial({ app: v.app, entity: gs.entity, enabled: false, attributes: {} } as never);
    fx.center.copy(local);
    fx.endRadius = o.radius;
    fx.acceleration = o.acceleration ?? 0;
    fx.delay = o.delay;
    fx.speed = o.speed;
    fx.bandWidth = o.band ?? 1;
    fx.oscillationIntensity = o.lift ?? 0.18;
    fx.dotTint.set(0, 1, 1);
    fx.waveTint.set(1, 0.5, 0);

    // mismo shader, con el tamaño de los puntos escalado (si el texto cambiara, se usa tal cual)
    const dotScale = o.dotScale ?? 1;
    let glsl = fx.getShaderGLSL();
    const scaled = glsl.replaceAll('scaleFactor * 0.05', 'scaleFactor * 0.05 * uDotScale');
    if (scaled !== glsl) glsl = scaled.replace('uniform float uTime;', 'uniform float uTime;\nuniform float uDotScale;');

    const setUniforms = (time: number) => {
        gs.setParameter('uDotScale', dotScale);
        gs.setParameter('uTime', time);
        gs.setParameter('uCenter', [fx.center.x, fx.center.y, fx.center.z]);
        gs.setParameter('uSpeed', fx.speed);
        gs.setParameter('uAcceleration', fx.acceleration);
        gs.setParameter('uDelay', fx.delay);
        gs.setParameter('uDotTint', [fx.dotTint.r, fx.dotTint.g, fx.dotTint.b]);
        gs.setParameter('uWaveTint', [fx.waveTint.r, fx.waveTint.g, fx.waveTint.b]);
        gs.setParameter('uOscillationIntensity', fx.oscillationIntensity);
        gs.setParameter('uEndRadius', fx.endRadius);
        gs.setParameter('uBandWidth', fx.bandWidth);
    };

    let time = 0;
    let running = true;
    const stop = () => {
        if (!running) return;
        running = false;
        v.app.off('update', onUpdate);
        gs.setWorkBufferModifier(null);
        gs.workBufferUpdate = WORKBUFFER_UPDATE_AUTO;
    };
    const onUpdate = (dt: number) => {
        time += dt;
        if (time >= fx.getCompletionTime()) {
            stop();
            return;
        }
        setUniforms(time);
    };

    setUniforms(0);
    gs.setWorkBufferModifier({ glsl });
    gs.workBufferUpdate = WORKBUFFER_UPDATE_ALWAYS;
    v.app.on('update', onUpdate);
    return stop;
};
