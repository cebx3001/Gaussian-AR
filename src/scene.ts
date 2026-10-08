import elVadoSettings from './el-vado/settings.json';
import type { ExperienceSettings } from '@playcanvas/supersplat-viewer/settings';

/** Both places share the same viewer and interface; only their spatial data differs. */
export const isElVado = document.documentElement.dataset.scene === 'el-vado' ||
    new URLSearchParams(location.search).get('scene') === 'el-vado';
if (isElVado) document.documentElement.dataset.scene = 'el-vado';

export const scene = isElVado ? {
    id: 'el-vado',
    title: 'El Vado',
    url: './el-vado/scene/0_0/meta.json',
    filename: 'meta.json',
    center: elVadoSettings.annotations[0].camera.initial.target as [number, number, number],
    ground: -0.23,
    orbitMaxPitch: 90,
    unitScale: 0.01,
    diameter: 2.1,
    settings: elVadoSettings as unknown as Partial<ExperienceSettings>,
    page: './el-vado.html',
    arPage: './ar-cero.html?scene=el-vado',
} : {
    id: 'san-sebastian',
    title: 'San Sebastián',
    url: './scene.sog',
    filename: 'scene.sog',
    center: [-1.5, 23, 8.4] as [number, number, number],
    ground: 23,
    orbitMaxPitch: 0,
    unitScale: 1,
    diameter: 173,
    settings: {} as Partial<ExperienceSettings>,
    page: './',
    arPage: './ar-cero.html',
};
