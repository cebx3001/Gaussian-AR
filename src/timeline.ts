// ---------------------------------------------------------------------------
// Línea de tiempo de 6 s para crear la animación de entrada (`?animar`).
// Básica, a la manera del editor de SuperSplat: se coloca el cabezal, se mueve la cámara con los
// gestos del visor y se añade un keyframe; los keyframes se pueden mover, borrar y reproducir.
//
// La vista previa es la pista de cámara de SuperSplat: el visor la reproduce y esta línea de tiempo
// solo gobierna el cabezal (`seek`), el play y la pausa. Al cambiar keyframes el visor se vuelve a
// crear la próxima vez que se pide una vista previa.
// ---------------------------------------------------------------------------
import type { ViewerHandle } from '@playcanvas/supersplat-viewer/viewer';

import { INTRO_SECONDS } from './intro';
import type { Keyframe, Pose } from './story';

export type TimelineHost = {
    viewer: () => ViewerHandle | null;
    /** Vista actual de la cámara del visor; el punto de mira queda `distance` metros al frente. */
    capture: (distance: number) => Pose | null;
    /** Vuelve a crear el visor con los keyframes actuales. */
    remount: () => Promise<void>;
    /** Keyframes de ejemplo para empezar. */
    seed: () => Keyframe[];
};

// se guarda con la duración: si la duración cambia, los keyframes guardados se estiran en proporción
const STORAGE_KEY = 'san-sebastian:intro-keyframes-v2';
const D = INTRO_SECONDS;
/** Distancia (m) a la que se coloca el punto de mira de cada keyframe. */
const LOOK_DISTANCE = 50;

let host: TimelineHost;
let kfs: Keyframe[] = [];
let selected: Keyframe | null = null;
let time = 0;
let dirty = false;
let busy = false;
let playing = false;
let raf = 0;
let render = () => {};
let setStatus = (_msg: string) => {};

/** Keyframes actuales: los usa el visor para crear la pista de vista previa. */
export const timelineKeyframes = () => kfs;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const snap = (t: number) => Math.round(t * 10) / 10;
const pct = (t: number) => `${(clamp(t, 0, D) / D) * 100}%`;

const persist = () => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ duration: D, keyframes: kfs }));
    } catch {
        // sin almacenamiento
    }
};

const loadSaved = (): Keyframe[] | null => {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { duration?: number; keyframes?: Keyframe[] } | null;
        if (!raw || !Array.isArray(raw.keyframes)) return null;
        const k = raw.duration && raw.duration > 0 ? D / raw.duration : 1;
        return raw.keyframes.map((f) => ({ ...f, t: Math.round(f.t * k * 100) / 100 }));
    } catch {
        return null;
    }
};

const seekNow = () => {
    const v = host.viewer();
    if (!v || !v.state.loaded || !v.state.hasAnimation) return;
    try {
        v.state.animationPaused = true;
        v.seek(time);
    } catch {
        // el visor aún no está listo
    }
};

const pause = () => {
    playing = false;
    cancelAnimationFrame(raf);
    const v = host.viewer();
    if (v) v.state.animationPaused = true;
    render();
};

/** Si hay cambios sin reflejar, vuelve a crear el visor con la pista nueva. */
const refresh = async () => {
    if (!dirty || busy) return;
    busy = true;
    pause();
    setStatus('Actualizando la vista previa…');
    dirty = false;
    await host.remount();
    busy = false;
    setStatus('');
};

const play = async () => {
    if (playing) {
        pause();
        return;
    }
    await refresh();
    const v = host.viewer();
    if (!v || !v.state.loaded || !v.state.hasAnimation) return;
    if (time >= D - 0.05) time = 0;
    try {
        v.seek(time);
        v.state.animationPaused = false;
    } catch {
        return;
    }
    playing = true;
    render();
    const tick = () => {
        if (!playing || host.viewer() !== v) return;
        const t = v.state.animationTime;
        time = clamp(t, 0, D);
        render();
        if (t >= D - 0.02) {
            time = D;
            pause();
            return;
        }
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
};

/** Lo llama la página cuando el visor terminó de cargar: se queda en pausa en el cabezal. */
export const timelineAfterMount = (v: ViewerHandle) => {
    v.state.animationPaused = true;
    seekNow();
    render();
};

export const setupTimeline = (h: TimelineHost, published: Keyframe[] | undefined) => {
    host = h;
    kfs = loadSaved() ?? (published?.length ? published.map((k) => ({ ...k })) : h.seed());
    kfs.sort((a, b) => a.t - b.t);

    document.body.classList.add('animar');
    const root = document.getElementById('timeline') as HTMLElement;
    root.hidden = false;
    root.replaceChildren();

    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text) e.textContent = text;
        return e;
    };

    const status = make('p', 'tl-status');
    status.hidden = true;
    let statusTimer = 0;
    setStatus = (msg: string) => {
        status.textContent = msg;
        status.hidden = !msg;
        window.clearTimeout(statusTimer);
        if (msg && !busy) statusTimer = window.setTimeout(() => (status.hidden = true), 2600);
    };

    const hint = make('p', 'tl-hint', 'Toca la línea · mueve la cámara · Añadir');

    // pista con regla, keyframes y cabezal
    const track = make('div', 'tl-track');
    track.append(make('div', 'tl-rail'));
    for (let s = 0; s <= D; s++) {
        const tick = make('div', 'tl-tick');
        tick.style.left = pct(s);
        tick.append(make('span', '', String(s)));
        track.append(tick);
    }
    const head = make('div', 'tl-head');
    track.append(head);

    // botones
    const row = make('div', 'tl-row');
    const playBtn = make('button', 'tl-play', '▶');
    playBtn.type = 'button';
    const timeLabel = make('span', 'tl-time');
    const addBtn = make('button', 'tl-add', 'Añadir');
    addBtn.type = 'button';
    const delBtn = make('button', '', 'Borrar');
    delBtn.type = 'button';
    const copyBtn = make('button', '', 'Copiar');
    copyBtn.type = 'button';
    const exampleBtn = make('button', 'tl-example', 'Ejemplo');
    exampleBtn.type = 'button';
    row.append(playBtn, timeLabel, addBtn, delBtn, copyBtn, exampleBtn);

    root.append(status, hint, track, row);

    render = () => {
        head.style.left = pct(time);
        timeLabel.textContent = `${time.toFixed(1)} s`;
        playBtn.textContent = playing ? '❚❚' : '▶';
        delBtn.disabled = !selected;
        hint.textContent = kfs.length
            ? `${kfs.length} keyframe${kfs.length === 1 ? '' : 's'} · toca la línea · mueve la cámara · Añadir`
            : 'Sin keyframes · mueve la cámara y pulsa Añadir';
        track.querySelectorAll('.tl-kf').forEach((e) => e.remove());
        kfs.forEach((k, i) => {
            const b = make('button', `tl-kf${k === selected ? ' on' : ''}`);
            b.type = 'button';
            b.dataset.i = String(i);
            b.style.left = pct(k.t);
            b.setAttribute('aria-label', `Keyframe en ${k.t.toFixed(1)} segundos`);
            track.append(b);
        });
    };

    // ---- cabezal y keyframes con el dedo
    type Drag = { kind: 'scrub' } | { kind: 'kf'; kf: Keyframe; moved: boolean };
    let drag: Drag | null = null;
    const timeAt = (x: number) => {
        const r = track.getBoundingClientRect();
        return snap(clamp((x - r.left) / r.width, 0, 1) * D);
    };
    const moveHead = (t: number) => {
        time = t;
        render();
        if (!dirty) seekNow(); // con cambios pendientes se actualiza al soltar
    };

    track.addEventListener('pointerdown', (e) => {
        track.setPointerCapture(e.pointerId);
        pause();
        const btn = (e.target as HTMLElement).closest<HTMLElement>('.tl-kf');
        if (btn) {
            const kf = kfs[Number(btn.dataset.i)];
            selected = kf;
            drag = { kind: 'kf', kf, moved: false };
            moveHead(kf.t);
        } else {
            drag = { kind: 'scrub' };
            moveHead(timeAt(e.clientX));
        }
    });

    track.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const t = timeAt(e.clientX);
        if (drag.kind === 'scrub') {
            if (t !== time) moveHead(t);
        } else if (t !== drag.kf.t) {
            drag.kf.t = t;
            drag.moved = true;
            dirty = true;
            time = t;
            kfs.sort((a, b) => a.t - b.t);
            render();
        }
    });

    const release = async () => {
        const d = drag;
        drag = null;
        if (!d) return;
        if (d.kind === 'kf' && d.moved) {
            // dos keyframes no pueden compartir instante: el que se soltó sustituye al otro
            kfs = kfs.filter((k) => k === d.kf || Math.abs(k.t - d.kf.t) >= 0.05);
            persist();
            render();
        }
        if (dirty) await refresh();
        seekNow();
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);

    // ---- botones
    playBtn.addEventListener('click', () => void play());

    addBtn.addEventListener('click', () => {
        pause();
        const pose = host.capture(LOOK_DISTANCE);
        if (!pose) {
            setStatus('El visor todavía no está listo');
            return;
        }
        const t = snap(time);
        const kf: Keyframe = { t, position: pose.position, target: pose.target, fov: pose.fov };
        const same = kfs.find((k) => Math.abs(k.t - t) < 0.05);
        if (same) {
            Object.assign(same, kf);
            selected = same;
            setStatus(`Keyframe actualizado en ${t.toFixed(1)} s`);
        } else {
            kfs.push(kf);
            kfs.sort((a, b) => a.t - b.t);
            selected = kf;
            setStatus(`Keyframe añadido en ${t.toFixed(1)} s`);
        }
        dirty = true;
        persist();
        render();
    });

    delBtn.addEventListener('click', () => {
        if (!selected) return;
        pause();
        const i = kfs.indexOf(selected);
        kfs.splice(i, 1);
        selected = kfs[Math.min(i, kfs.length - 1)] ?? null;
        dirty = true;
        persist();
        render();
        setStatus('Keyframe borrado');
    });

    copyBtn.addEventListener('click', async () => {
        const json = JSON.stringify({ intro: { duration: D, keyframes: kfs } }, null, 1);
        try {
            await navigator.clipboard.writeText(json);
            setStatus('Animación copiada: pégala en el chat');
        } catch {
            const box = document.getElementById('ed-export-box') as HTMLElement;
            const area = document.getElementById('ed-export') as HTMLTextAreaElement;
            area.value = json;
            box.hidden = false;
            area.focus();
            area.select();
        }
    });
    document.getElementById('ed-export-close')?.addEventListener('click', () => {
        (document.getElementById('ed-export-box') as HTMLElement).hidden = true;
    });

    exampleBtn.addEventListener('click', () => {
        pause();
        kfs = host.seed();
        selected = null;
        dirty = true;
        persist();
        render();
        setStatus('Ejemplo cargado');
    });

    render();
};
