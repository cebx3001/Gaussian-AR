// Narrativa espacial de la plaza: los textos y las poses de cámara viven en
// `story.json`. En el visor con `?editar` se capturan las poses y se copian los datos.
import raw from './story.json';

export type Vec3Tuple = [number, number, number];

export type Pose = {
    position: Vec3Tuple;
    target: Vec3Tuple;
    fov: number;
};

export type StoryPoint = {
    id: string;
    kicker: string;
    title: string;
    text: string;
    /** `null` = todavía sin capturar: el visor usa una vista provisional. */
    pose: Pose | null;
};

export type Story = {
    place: { kicker: string; title: string };
    /** Animación de entrada al abrir el visor. */
    intro: boolean;
    /** Vista de la maqueta completa. `null` = encuadre automático a 45°. */
    overview: Pose | null;
    points: StoryPoint[];
};

export const defaultStory = (): Story => JSON.parse(JSON.stringify(raw)) as Story;

export const round = (v: number, digits = 3): number => {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
};
