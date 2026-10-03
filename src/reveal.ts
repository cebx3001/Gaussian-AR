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
import { WORKBUFFER_UPDATE_ALWAYS, WORKBUFFER_UPDATE_AUTO } from 'playcanvas';
import type { AppBase, GSplatComponent } from 'playcanvas';
import { GSplatRevealRadial } from 'playcanvas/scripts/esm/gsplat/reveal-radial.mjs';

export type RevealOptions = {
    /**
     * Punto de donde nacen las ondas, en coordenadas del mundo (el modificador del work buffer trabaja
     * en el mundo, ya con la transformación de la entidad aplicada).
     */
    center: [number, number, number];
    /**
     * Metros del mundo por unidad de la escena (1 = el modelo está a su tamaño original). Con un modelo
     * reducido, p. ej. 1/135 en realidad aumentada, el efecto se aplica en unidades de la escena y se
     * devuelve a metros: radio, velocidad, puntos y bandas conservan su proporción.
     */
    scale?: number;
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

/**
 * Parámetros del efecto en este proyecto, iguales en el visor y en la realidad aumentada. Duran 5 s:
 * los splats llegan hasta 116 m del centro (la mitad está a menos de 53 m), así que `radius` cubre toda
 * la escena y las ondas empiezan despacio en el centro y aceleran hacia afuera; la onda de elevación
 * (colores) sale `delay` s detrás de la de puntos y llega a `radius` justo a los 5 s, cuando el efecto
 * se retira solo. Las distancias están en unidades de la escena (no cambian con la escala del modelo).
 * `dotScale` agranda los puntos del efecto original para esta escena.
 */
export const REVEAL_SECONDS = 5;
export const REVEAL = (() => {
    const radius = 117;
    const delay = 1;
    const speed = 5; // al arrancar
    const travel = REVEAL_SECONDS - delay; // lo que tarda la onda de colores en recorrer `radius`
    const acceleration = (2 * (radius - speed * travel)) / (travel * travel);
    return { radius, delay, speed, acceleration, lift: 3, band: 6, dotScale: 60 };
})();

/** Arranca el efecto sobre el splat de la app. Devuelve una función que lo detiene. */
export const startReveal = (app: AppBase, o: RevealOptions, onDone?: () => void): (() => void) => {
    const gs = (app.root.findComponents('gsplat') as GSplatComponent[])[0];
    if (!gs) return () => {};

    // instancia del efecto oficial, solo para su configuración, su shader y su duración
    const fx = new GSplatRevealRadial({ app, entity: gs.entity, enabled: false, attributes: {} } as never);
    fx.center.set(0, 0, 0); // las ondas nacen del origen del espacio del efecto (ver `uOrigin`)
    fx.endRadius = o.radius;
    fx.acceleration = o.acceleration ?? 0;
    fx.delay = o.delay;
    fx.speed = o.speed;
    fx.bandWidth = o.band ?? 1;
    fx.oscillationIntensity = o.lift ?? 0.18;
    fx.dotTint.set(0, 1, 1);
    fx.waveTint.set(1, 0.5, 0);

    // El shader es el oficial, sin tocar. Se le añaden dos cosas:
    //  1. el tamaño de los puntos escalado (`uDotScale`), porque el original está pensado para objetos pequeños
    //  2. un envoltorio que lleva la escena a «unidades de la escena» y vuelve: así el efecto se ve igual a
    //     cualquier tamaño del modelo y nace de `uOrigin` (el punto del mundo de donde salen las ondas)
    const dotScale = o.dotScale ?? 1;
    const scale = o.scale ?? 1;
    let glsl = fx.getShaderGLSL();
    const withDots = glsl.replaceAll('scaleFactor * 0.05', 'scaleFactor * 0.05 * uDotScale');
    if (withDots !== glsl) glsl = withDots.replace('uniform float uTime;', 'uniform float uTime;\nuniform float uDotScale;');

    const renamed = glsl
        .replace('void modifySplatCenter(', 'void effectCenter(')
        .replace('void modifySplatRotationScale(', 'void effectRotationScale(')
        .replace('void modifySplatColor(', 'void effectColor(');
    if (!renamed.includes('effectCenter(') || !renamed.includes('effectRotationScale(') || !renamed.includes('effectColor(')) {
        throw new Error('reveal: el shader de PlayCanvas cambió y no se pudo envolver');
    }
    glsl = `uniform float uInv;
uniform vec3 uOrigin;
${renamed}
void modifySplatCenter(inout vec3 center) {
    vec3 p = (center - uOrigin) * uInv;
    vec3 before = p;
    effectCenter(p);
    center += (p - before) / uInv;
}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    vec3 s = scale * uInv;
    effectRotationScale((originalCenter - uOrigin) * uInv, (modifiedCenter - uOrigin) * uInv, rotation, s);
    scale = s / uInv;
}
void modifySplatColor(vec3 center, inout vec4 color) {
    effectColor((center - uOrigin) * uInv, color);
}
`;

    const setUniforms = (time: number) => {
        gs.setParameter('uDotScale', dotScale);
        gs.setParameter('uInv', 1 / scale);
        gs.setParameter('uOrigin', o.center);
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
        app.off('update', onUpdate);
        gs.setWorkBufferModifier(null);
        gs.workBufferUpdate = WORKBUFFER_UPDATE_AUTO;
    };
    const onUpdate = (dt: number) => {
        time += dt;
        if (time >= fx.getCompletionTime()) {
            stop();
            onDone?.();
            return;
        }
        setUniforms(time);
    };

    setUniforms(0);
    gs.setWorkBufferModifier({ glsl });
    gs.workBufferUpdate = WORKBUFFER_UPDATE_ALWAYS;
    app.on('update', onUpdate);
    return stop;
};
