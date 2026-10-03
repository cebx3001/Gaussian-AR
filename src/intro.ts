// Animación de entrada: de keyframes (segundos) a la pista de cámara de SuperSplat.
import type { AnimTrack } from '@playcanvas/supersplat-viewer/settings';
import { Vec3 } from 'playcanvas';

import { round } from './story';
import type { Keyframe, Pose, Vec3Tuple } from './story';

export const INTRO_SECONDS = 5;
/** Cuadros por segundo de la pista: SuperSplat expresa los tiempos de los keyframes en cuadros. */
export const INTRO_FPS = 30;

/** Pista de SuperSplat a partir de keyframes en segundos (la interpolación es una spline suave). */
export const trackFromKeyframes = (keyframes: Keyframe[], duration = INTRO_SECONDS): AnimTrack => {
    const sorted = [...keyframes].sort((a, b) => a.t - b.t);
    const times: number[] = [];
    const position: number[] = [];
    const target: number[] = [];
    const fov: number[] = [];
    for (const k of sorted) {
        let frame = Math.round(Math.max(0, Math.min(duration, k.t)) * INTRO_FPS);
        if (times.length && frame <= times[times.length - 1]) frame = times[times.length - 1] + 1; // tiempos estrictamente crecientes
        times.push(frame);
        position.push(...k.position);
        target.push(...k.target);
        fov.push(k.fov);
    }
    return {
        name: 'entrada',
        duration: Math.max(duration, times[times.length - 1] / INTRO_FPS),
        frameRate: INTRO_FPS,
        loopMode: 'none',
        interpolation: 'spline',
        smoothness: 1,
        keyframes: { times, values: { position, target, fov } }
    };
};

/**
 * Entrada automática: arranca más cerca, más baja y girada, y termina en la pose dada,
 * desacelerando. Gira alrededor del ancla.
 */
export const autoKeyframes = (pose: Pose, anchor: Vec3Tuple, count: number): Keyframe[] => {
    const a = new Vec3(...anchor);
    const rel = new Vec3(...pose.position).sub(a);
    const radius = rel.length();
    const yaw1 = Math.atan2(rel.x, rel.z);
    const pitch1 = Math.asin(Math.max(-1, Math.min(1, rel.y / radius)));
    const yaw0 = yaw1 - (150 * Math.PI) / 180;
    const pitch0 = (12 * Math.PI) / 180;
    const out: Keyframe[] = [];
    for (let k = 0; k < count; k++) {
        const t = k / (count - 1);
        const e = 1 - Math.pow(1 - t, 3); // desacelera al llegar
        const yaw = yaw0 + (yaw1 - yaw0) * e;
        const pitch = pitch0 + (pitch1 - pitch0) * e;
        const r = radius * (0.5 + 0.5 * e);
        const cp = Math.cos(pitch);
        out.push({
            t: round(t * INTRO_SECONDS, 2),
            position: [round(a.x + r * Math.sin(yaw) * cp), round(a.y + r * Math.sin(pitch)), round(a.z + r * Math.cos(yaw) * cp)],
            target: [...anchor],
            fov: pose.fov
        });
    }
    return out;
};
