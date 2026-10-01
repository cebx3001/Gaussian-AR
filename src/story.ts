// Narrativa espacial de la plaza. Los textos y las poses de cámara viven en `story.json`.
// Las poses se capturan desde la cámara del visor de SuperSplat con `?editar`.
import raw from './story.json';

export type Vec3Tuple = [number, number, number];

export type Pose = {
    position: Vec3Tuple;
    target: Vec3Tuple;
    fov: number;
};

/** Un cuadro clave de la animación de entrada: instante (s) y vista de la cámara. */
export type Keyframe = {
    t: number;
    position: Vec3Tuple;
    target: Vec3Tuple;
    fov: number;
};

/** Animación de entrada hecha con la línea de tiempo (`?animar`). Sin keyframes: entrada automática. */
export type IntroAnimation = {
    duration: number;
    keyframes: Keyframe[];
};

export type Chapter = {
    id: string;
    /** Nombre del botón. */
    nav: string;
    kicker: string;
    title: string;
    text: string;
    /** `null` = todavía sin capturar. */
    pose: Pose | null;
};

export type Story = {
    place: { kicker: string; title: string };
    /** Animación de entrada al abrir el visor. */
    intro?: IntroAnimation;
    chapters: Chapter[];
};

export const defaultStory = (): Story => JSON.parse(JSON.stringify(raw)) as Story;

export const round = (v: number, digits = 3): number => {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
};
