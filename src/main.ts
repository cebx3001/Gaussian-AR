import './style.css';

import { ArExperience, CONFIG, detectArSupport } from './ar-experience';
import type { ArPhase } from './ar-experience';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const overlay = $<HTMLElement>('overlay');
const intro = $<HTMLElement>('intro');
const statusEl = $<HTMLElement>('status');
const enterBtn = $<HTMLButtonElement>('enter');
const hud = $<HTMLElement>('hud');
const hint = $<HTMLElement>('hint');
const exitBtn = $<HTMLButtonElement>('exit');

const HINTS: Partial<Record<ArPhase, string>> = {
    starting: 'Iniciando AR…',
    scanning: 'Mueve el teléfono despacio para detectar una superficie…',
    aim: 'Apunta al punto donde quieres la escena y toca la pantalla',
    revealing: 'Materializando…',
    placed: 'Fijada. Camina a su alrededor. Toca «Salir» cuando quieras.'
};

const onPhase = (phase: ArPhase, detail?: string) => {
    if (phase === 'unsupported') {
        statusEl.textContent =
            detail ?? 'Este navegador no puede ejecutar immersive-ar. Ábrelo en un móvil con WebXR (p. ej. Chrome en Android).';
        enterBtn.hidden = true;
        return;
    }
    if (phase === 'ready') {
        statusEl.textContent = 'Listo.';
        enterBtn.hidden = false;
        return;
    }
    if (phase === 'ended') {
        intro.hidden = false;
        hud.hidden = true;
        statusEl.textContent = detail ?? 'Sesión AR finalizada.';
        enterBtn.hidden = false;
        enterBtn.textContent = 'Volver a entrar en AR';
        return;
    }
    // in-session phases
    intro.hidden = true;
    hud.hidden = false;
    if (HINTS[phase]) hint.textContent = HINTS[phase]!;
};

const main = async () => {
    const previewOnly = new URLSearchParams(location.search).has('preview');
    const supported = await detectArSupport();

    if (!supported && !previewOnly) {
        onPhase('unsupported');
        return;
    }

    const xp = new ArExperience(canvas, CONFIG, onPhase, overlay);
    try {
        await xp.init();
    } catch (err) {
        statusEl.textContent = err instanceof Error ? err.message : 'Fallo al inicializar.';
        return;
    }

    if (previewOnly) {
        intro.hidden = true;
        xp.previewPlace();
        return;
    }

    enterBtn.addEventListener('click', () => xp.enter());
    exitBtn.addEventListener('click', () => xp.exit());
};

void main();
