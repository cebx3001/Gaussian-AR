import { appendDestinationLabel } from './navigation-labels';
// ---------------------------------------------------------------------------
// San Sebastián · historia con scroll (scrollytelling).
//
// La maqueta queda fija de fondo y los textos pasan por encima. El scroll mueve la cámara: toda la
// historia es una sola pista de cámara de SuperSplat y el scroll decide en qué instante de la pista
// está (`seek`). Por cada lugar:
//
//   viaje    el texto entra desde abajo y la cámara viaja a la pose del lugar
//   lectura  el texto sigue subiendo hasta salir; la cámara queda quieta
//   respiro  pantalla sin texto: la cámara gira despacio ~30° alrededor del lugar
//
// Al abrir, primero la entrada (reveal + animación de 6 s) y luego empieza el scroll en la Vista general.
// Al final, «Explorar libremente» suelta la cámara (órbita normal del visor).
// ---------------------------------------------------------------------------
import '@playcanvas/supersplat-viewer/viewer.css';
import './viewer.css';
import './historia.css';

import { createViewer } from '@playcanvas/supersplat-viewer/viewer';
import type { ViewerHandle } from '@playcanvas/supersplat-viewer/viewer';
import { defaultSettings } from '@playcanvas/supersplat-viewer/settings';

import { trackFromKeyframes } from './intro';
import { REVEAL_SECONDS, revealFor, startReveal } from './reveal';
import { AR_UI, LANG_KEY, UI, detectLang } from './i18n';
import type { Lang } from './i18n';
import { defaultStory, round } from './story';
import type { Chapter, Keyframe, Pose, Vec3Tuple } from './story';
import { revealOrigin, waitUntilDrawn } from './splat-util';

const MODEL_CENTER: Vec3Tuple = [-1.5, 23, 8.4];

// Límites que lee el parche de SuperSplat (vite.config.ts), como en las herramientas de edición: al explorar no se puede mirar
// por debajo de la maqueta, el vuelo no baja del suelo y un toque no cambia el centro de giro.
{
    const g = globalThis as unknown as Record<string, number>;
    g.__ORBIT_PITCH_MIN = -90;
    g.__ORBIT_PITCH_MAX = 0;
    g.__FLY_MIN_Y = 23 + 1.5;
    g.__NO_PICK = 1;
}

// ---- tiempos de la pista (segundos de pista, no de reloj: el scroll los recorre)
/** Viaje de un lugar al siguiente. */
const TRAVEL = 4;
/** Lectura: la cámara queda quieta. */
const READ = 1;
/** Respiro sin texto: giro alrededor del lugar. */
const ORBIT = 3;
const ORBIT_DEG = 30;
/** Separación entre muestras de la pista: con muestras densas la curva es exactamente la calculada aquí. */
const STEP = 0.1;
/** Largo del respiro sin texto, en pantallas de scroll. */
const PAUSE_SCREENS = 0.9;
/**
 * Lugares con giro propio. La fuente es una roseta vista desde arriba: gira 180° y empieza a girar en cuanto la
 * cámara llega (durante la lectura), con un respiro más largo para que el giro sea lento.
 */
const SPIN: Record<string, { deg: number; fromArrival: boolean; pause: number }> = {
    fuente: { deg: 180, fromArrival: true, pause: 1.8 }
};
const pauseScreens = (i: number) => SPIN[chapters[i]?.id]?.pause ?? PAUSE_SCREENS;

// ---- textos de esta página
type PageText = {
    cue: string;
    /** Bienvenida: sustituye en esta página al texto de la Vista general (que en el visor explica el uso). */
    welcome: { kicker: string; title: string; text: string };
    endKicker: string;
    endTitle: string;
    explore: string;
    back: string;
    storyMode: string;
    tourMode: string;
};
const TEXT: Record<Lang, PageText> = {
    es: {
        cue: 'Desliza hacia abajo',
        welcome: {
            kicker: 'Recorrido en tres dimensiones',
            title: 'Patrimonio que se recorre',
            text:
                'Frente a ti está el espacio tal como existe, capturado en tres dimensiones a partir de fotografías del lugar. Cada fachada, cada árbol y cada camino ocupan su sitio real, listos para recorrerse como si estuvieras allí.\n\n' +
                'Esta historia te lleva por sus rincones, uno a uno, y por lo que guardan. Avanza a tu ritmo: la cámara te acompaña.'
        },
        endKicker: 'Fin del recorrido',
        endTitle: 'Ahora, explórala a tu manera',
        explore: 'Explorar libremente',
        back: '← Volver a la historia',
        storyMode: 'Historia',
        tourMode: 'Recorrido libre'
    },
    en: {
        cue: 'Scroll down to explore',
        welcome: {
            kicker: 'A three-dimensional tour',
            title: 'Heritage you can walk through',
            text:
                'Before you is the space as it exists, captured in three dimensions from photographs of the place. Every façade, every tree and every path sits where it really is, ready to be explored as if you were there.\n\n' +
                'This story takes you through its corners, one by one, and through what they hold. Move at your own pace: the camera comes with you.'
        },
        endKicker: 'End of the tour',
        endTitle: 'Now explore it your own way',
        explore: 'Explore freely',
        back: '← Back to the story',
        storyMode: 'Story mode',
        tourMode: 'Tour mode'
    }
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLElement>('stage');
const veil = $<HTMLElement>('veil');
const howEl = $<HTMLElement>('how');
const scroller = $<HTMLElement>('scroller');
const storyEl = $<HTMLElement>('story');
const indexEl = $<HTMLElement>('index');
const loader = $<HTMLElement>('loader');
const loaderFill = $<HTMLElement>('loader-fill');
const loaderMessage = $<HTMLElement>('loader-message');
const backStory = $<HTMLButtonElement>('back-story');
const arLink = $<HTMLAnchorElement>('ar-link');
const storyMode = $<HTMLButtonElement>('story-mode');
const tourMode = $<HTMLButtonElement>('tour-mode');
const tourCaption = $<HTMLElement>('tour-caption');

const story = defaultStory();
const chapters: (Chapter & { pose: Pose })[] = story.chapters.filter((c): c is Chapter & { pose: Pose } => !!c.pose);
let lang: Lang = detectLang();
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------------------
// La pista de cámara
// ---------------------------------------------------------------------------
type Seg = { kind: 'intro' | 'travel' | 'read' | 'orbit'; i: number; t0: number; t1: number };

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerp3 = (a: Vec3Tuple, b: Vec3Tuple, u: number): Vec3Tuple => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const r3 = (v: Vec3Tuple): Vec3Tuple => [round(v[0]), round(v[1]), round(v[2])];

/** Gira la posición alrededor del eje vertical que pasa por el punto de mira. */
const orbitPose = (p: Pose, deg: number): Pose => {
    const a = (deg * Math.PI) / 180;
    const x = p.position[0] - p.target[0];
    const z = p.position[2] - p.target[2];
    return {
        position: [p.target[0] + x * Math.cos(a) - z * Math.sin(a), p.position[1], p.target[2] + x * Math.sin(a) + z * Math.cos(a)],
        target: p.target,
        fov: p.fov
    };
};

/**
 * Vista cenital (justo encima, mirando abajo): girar alrededor del eje vertical no cambiaría nada. Se inclina unos
 * grados hacia el lado desde donde llega la cámara; casi no se nota, pero así el giro hace rotar la vista.
 */
const tiltIfOverhead = (p: Pose, from: Pose): Pose => {
    const dx = p.position[0] - p.target[0];
    const dz = p.position[2] - p.target[2];
    const h = Math.abs(p.position[1] - p.target[1]);
    if (Math.hypot(dx, dz) > h * 0.05) return p;
    let ux = from.position[0] - p.target[0];
    let uz = from.position[2] - p.target[2];
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    const off = h * 0.08;
    return { ...p, position: [p.target[0] + ux * off, p.position[1], p.target[2] + uz * off] };
};

/** Viaje entre dos vistas: curva suave que sube un poco a mitad de camino para pasar por encima de la plaza. */
const travelPose = (a: Pose, b: Pose, u: number): Pose => {
    const e = easeInOut(u);
    const d = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]);
    const lift = Math.min(25, d * 0.15) * Math.sin(Math.PI * u);
    const pos = lerp3(a.position, b.position, e);
    pos[1] += lift;
    return { position: pos, target: lerp3(a.target, b.target, e), fov: lerp(a.fov, b.fov, e) };
};

const segs: Seg[] = [];
const keyframes: Keyframe[] = [];
const sample = (seg: Seg, at: (u: number) => Pose) => {
    const n = Math.max(1, Math.round((seg.t1 - seg.t0) / STEP));
    for (let k = keyframes.length ? 1 : 0; k <= n; k++) {
        const p = at(k / n);
        keyframes.push({ t: round(seg.t0 + (k / n) * (seg.t1 - seg.t0), 2), position: r3(p.position), target: r3(p.target), fov: round(p.fov, 1) });
    }
};

const buildTrack = () => {
    // entrada: los keyframes de story.json (línea de tiempo), con su último cuadro en la Vista general
    const first = chapters[0].pose;
    const intro = [...(story.intro?.keyframes ?? [])].sort((a, b) => a.t - b.t);
    let t = 0;
    if (intro.length >= 2) {
        const last = intro[intro.length - 1];
        intro[intro.length - 1] = { t: last.t, position: [...first.position], target: [...first.target], fov: first.fov };
        keyframes.push(...intro);
        t = last.t;
    } else {
        keyframes.push({ t: 0, position: [...first.position], target: [...first.target], fov: first.fov });
    }
    segs.push({ kind: 'intro', i: 0, t0: 0, t1: t });

    let from: Pose = first;
    chapters.forEach((c, i) => {
        const spin = SPIN[c.id];
        const pose = spin ? tiltIfOverhead(c.pose, from) : c.pose;
        if (i > 0) {
            const seg: Seg = { kind: 'travel', i, t0: t, t1: t + TRAVEL };
            const a = from;
            sample(seg, (u) => travelPose(a, pose, u));
            segs.push(seg);
            t = seg.t1;
        }
        // el giro alterna de lado en cada lugar
        const deg = (i % 2 ? -1 : 1) * (spin?.deg ?? ORBIT_DEG);
        const read: Seg = { kind: 'read', i, t0: t, t1: t + READ };
        if (spin?.fromArrival) {
            // gira desde que llega: la primera mitad mientras se lee (arranca suave), la otra en el respiro
            sample(read, (u) => orbitPose(pose, deg * 0.5 * u * u));
        } else {
            sample(read, () => pose);
        }
        segs.push(read);
        t = read.t1;
        const orbitLen = spin ? ORBIT * 2 : ORBIT;
        const orbit: Seg = { kind: 'orbit', i, t0: t, t1: t + orbitLen };
        if (spin?.fromArrival) sample(orbit, (u) => orbitPose(pose, deg * (0.5 + 0.5 * (1 - (1 - u) * (1 - u)))));
        else sample(orbit, (u) => orbitPose(pose, deg * easeInOut(u)));
        segs.push(orbit);
        t = orbit.t1;
        from = orbitPose(pose, deg);
    });
    return trackFromKeyframes(keyframes, t);
};

const track = buildTrack();
const INTRO_END = segs[0].t1;

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------
const textOf = (c: Chapter) => (lang === 'en' && c.en ? c.en : { nav: c.nav, kicker: c.kicker, title: c.title, text: c.text });
/** Texto de cada bloque: el primero es la bienvenida de esta página. */
const blockText = (c: Chapter, i: number) => (i === 0 ? { ...textOf(c), ...TEXT[lang].welcome } : textOf(c));
/** `**negrita**` → <strong>, sobre texto ya escapado. */
const bold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let blocks: HTMLElement[] = [];
let pauses: HTMLElement[] = [];

const renderStory = () => {
    const u = UI[lang];
    const tx = TEXT[lang];
    storyEl.replaceChildren();
    blocks = [];
    pauses = [];
    chapters.forEach((c, i) => {
        const t = blockText(c, i);
        const art = document.createElement('article');
        art.className = 'block';
        const body = t.text.replace('{tap}', coarsePointer ? u.tapTouch : u.tapMouse);
        art.innerHTML =
            `<div class="rule" aria-hidden="true"></div><p class="kicker" data-chapter="${String(i + 1).padStart(2, '0')} / ${String(chapters.length).padStart(2, '0')}">${esc(t.kicker)}</p><h2 class="title" id="chapter-${c.id}">${esc(t.title)}</h2>` +
            `<div class="text story-description">${body
                .split(/\n\n+/)
                .map((p) => `<p>${esc(p)}</p>`)
                .join('')}</div>`;
        art.setAttribute('aria-labelledby', `chapter-${c.id}`);
        const pause = document.createElement('div');
        pause.className = 'pause';
        storyEl.append(art, pause);
        blocks.push(art);
        pauses.push(pause);
    });
    const end = document.createElement('section');
    end.className = 'end';
    // las instrucciones de uso van aquí, cuando de verdad se usan
    end.innerHTML =
        `<p class="kicker">${esc(tx.endKicker)}</p><h2 class="title">${esc(tx.endTitle)}</h2>` +
        `<button type="button" class="explore">${esc(tx.explore)}</button>`;
    // instrucciones de uso: salen al entrar en «Explorar libremente» y se van con el primer toque
    howEl.innerHTML = (coarsePointer ? u.howTouch : u.howMouse).map((h) => `<p>${bold(esc(h))}</p>`).join('');
    end.querySelector('button')!.addEventListener('click', () => explore(true));
    storyEl.append(end);
    backStory.textContent = tx.back;
    $<HTMLElement>('scroll-cue-text').textContent = tx.cue;
};

const renderIndex = () => {
    indexEl.replaceChildren();
    chapters.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chapter-link';
        appendDestinationLabel(b, textOf(c).nav, i, lang);
        b.disabled = !ready;
        b.addEventListener('click', () => {
            if (!ready) return;
            if (exploring) selectTourChapter(i);
            else goTo(i);
        });
        indexEl.append(b);
    });
    indexEl.setAttribute('aria-label', UI[lang].places);
};

const renderMasthead = () => {
    const p = lang === 'en' && story.place.en ? story.place.en : story.place;
    $<HTMLElement>('masthead-kicker').textContent = p.kicker;
    const title = $<HTMLElement>('masthead-title');
    title.replaceChildren();
    p.title.split(' ').forEach((word, i) => {
        if (i) title.append(document.createTextNode(' '));
        const line = document.createElement('span');
        line.className = 'identity-line';
        line.textContent = word;
        title.append(line);
    });
    $<HTMLElement>('loader-kicker').textContent = p.kicker;
    document.title = `${p.title} · Cuenca`;
};

const applyLang = () => {
    document.documentElement.lang = lang;
    renderMasthead();
    renderStory();
    renderIndex();
    if (loader.dataset.hidden !== 'true') loaderMessage.textContent = UI[lang].loading;
    $<HTMLElement>('lang').querySelectorAll<HTMLElement>('button').forEach((b) => {
        b.classList.toggle('on', b.dataset.lang === lang);
        b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
    arLink.textContent = AR_UI[lang].button;
    arLink.setAttribute('aria-label', AR_UI[lang].buttonLabel);
    arLink.hidden = !coarsePointer;
    layout();
    updateIndex();
    updateMode();
    if (exploring && !tourCaption.hidden) renderTourCaption();
};

$<HTMLElement>('lang')
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) =>
        b.addEventListener('click', () => {
            const next = b.dataset.lang as Lang;
            if (next === lang) return;
            const keep = activeChapter;
            lang = next;
            try {
                localStorage.setItem(LANG_KEY, lang);
            } catch {
                // sin almacenamiento
            }
            applyLang();
            // los textos cambian de largo: se vuelve al mismo lugar
            scroller.scrollTop = readStart(keep);
            if (exploring) storyScrollOnTour = readStart(storyChapterOnTour);
        })
    );

// ---------------------------------------------------------------------------
// Del scroll al instante de la pista
// ---------------------------------------------------------------------------
/** Puntos (scroll, instante) entre los que se interpola en línea recta. */
let map: { s: number; t: number; i: number }[] = [];
/** Dónde queda la parte de arriba del texto al terminar el viaje (px desde arriba del área de scroll). */
const READ_TOP = 8;

const readStart = (i: number) => (i === 0 ? 0 : (blocks[i]?.offsetTop ?? 0) - READ_TOP);

const layout = () => {
    const vh = scroller.clientHeight;
    storyEl.style.paddingTop = `${READ_TOP}px`;
    pauses.forEach((p, i) => (p.style.height = `${Math.round(vh * (1 + pauseScreens(i)))}px`));
    map = [];
    const segOf = (kind: Seg['kind'], i: number) => segs.find((g) => g.kind === kind && g.i === i)!;
    blocks.forEach((b, i) => {
        const top = b.offsetTop;
        const bottom = top + b.offsetHeight;
        if (i > 0) {
            const tr = segOf('travel', i);
            map.push({ s: top - vh, t: tr.t0, i: i - 1 }, { s: top - READ_TOP, t: tr.t1, i });
        }
        const rd = segOf('read', i);
        map.push({ s: i === 0 ? 0 : top - READ_TOP, t: rd.t0, i }, { s: bottom, t: rd.t1, i });
        const ob = segOf('orbit', i);
        map.push({ s: bottom, t: ob.t0, i }, { s: bottom + vh * pauseScreens(i), t: ob.t1, i });
    });
    map.sort((a, b) => a.s - b.s);
};

const timeAt = (s: number) => {
    if (!map.length) return INTRO_END;
    if (s <= map[0].s) return map[0].t;
    for (let k = 1; k < map.length; k++) {
        const a = map[k - 1];
        const b = map[k];
        if (s <= b.s) return b.s > a.s ? a.t + ((s - a.s) / (b.s - a.s)) * (b.t - a.t) : b.t;
    }
    return map[map.length - 1].t;
};

let activeChapter = 0;
const chapterAt = (s: number) => {
    // el lugar cuyo viaje ya pasó de la mitad
    let i = 0;
    blocks.forEach((b, k) => {
        if (k > 0 && s >= b.offsetTop - scroller.clientHeight * 0.5) i = k;
    });
    return i;
};

const goTo = (i: number) => {
    scroller.scrollTo({ top: readStart(i), behavior: 'smooth' });
};

// ---------------------------------------------------------------------------
// Visor
// ---------------------------------------------------------------------------
let viewer: ViewerHandle | null = null;
let ready = false; // terminó la entrada: el scroll manda
let exploring = false;
let tNow = INTRO_END;
let storyScrollOnTour = 0;
let storyChapterOnTour = 0;

const mount = async () => {
    loader.dataset.hidden = 'false';
    loaderMessage.textContent = UI[lang].loading;
    const settings = defaultSettings();
    settings.background = { color: [0, 0, 0, 0] as unknown as [number, number, number] }; // transparente (alfa premultiplicado)
    const general = chapters[0].pose;
    settings.cameras = [{ initial: { ...general, target: MODEL_CENTER } }];
    // Cada pose conserva sus coordenadas originales; su target es el ancla de la órbita libre.
    settings.annotations = chapters.map((c, i) => {
        const target = i === 0 ? MODEL_CENTER : c.pose.target;
        return { position: target, title: c.id, text: '', camera: { initial: { ...c.pose, target } } };
    });
    settings.animTracks = [track];
    settings.startMode = 'animTrack';
    try {
        const v = await createViewer({
            container: stage,
            settings,
            contentUrl: './scene.sog',
            contentFilename: 'scene.sog',
            renderer: 'webgl',
            ui: false,
            lang: 'es'
        });
        viewer = v;
        v.state.showAnnotations = false;
        v.state.gamingControls = false;
        v.events.on('progress:changed', (p: number) => (loaderFill.style.transform = `scaleX(${Math.max(0, Math.min(1, p / 100))})`));
        const onLoaded = () => {
            v.state.animationPaused = true;
            const k0 = keyframes[0];
            const origin = revealOrigin(v, k0.position, k0.target);
            const radius = Math.hypot(origin[0] - MODEL_CENTER[0], origin[1] - MODEL_CENTER[1], origin[2] - MODEL_CENTER[2]) + 100;
            const opts = { center: origin, ...revealFor(radius, REVEAL_SECONDS, 15, 0.7) };
            let stop = startReveal(v.app, opts);
            waitUntilDrawn(v, () => {
                stop();
                stop = startReveal(v.app, opts);
                loader.dataset.hidden = 'true';
                if (INTRO_END > 0) {
                    v.seek(0);
                    v.state.animationPaused = false;
                    const wait = () => {
                        if (v.state.animationTime >= INTRO_END - 0.03) finishIntro(v);
                        else requestAnimationFrame(wait);
                    };
                    requestAnimationFrame(wait);
                } else {
                    finishIntro(v);
                }
            });
        };
        if (v.state.loaded) onLoaded();
        else v.events.once('loaded:changed', onLoaded);
    } catch (err) {
        console.error(err);
        loaderMessage.textContent = UI[lang].loadError;
    }
};

const finishIntro = (v: ViewerHandle) => {
    v.state.animationPaused = true;
    v.seek(INTRO_END);
    tNow = INTRO_END;
    ready = true;
    document.body.classList.remove('locked');
    document.body.classList.add('ready');
    layout();
    updateMode();
};

// Cada cuadro: el instante de la pista sigue al scroll con un poco de suavizado (el dedo da saltos).
const tick = () => {
    requestAnimationFrame(tick);
    const v = viewer;
    if (!v || !ready || exploring) return;
    // un toque del teclado puede sacar al visor de la pista: se vuelve a ella
    if (v.state.cameraMode !== 'anim') v.state.cameraMode = 'anim';
    v.state.animationPaused = true;
    const s = scroller.scrollTop;
    const goal = timeAt(s);
    const d = goal - tNow;
    if (Math.abs(d) > 1e-4) {
        tNow = Math.abs(d) < 0.002 ? goal : tNow + d * 0.18;
        v.seek(tNow);
        v.app.renderNextFrame = true;
    }
    // velo: tanto como texto haya en pantalla
    const vh = scroller.clientHeight;
    let cover = 0;
    for (const b of [...blocks, storyEl.querySelector<HTMLElement>('.end')].filter((e): e is HTMLElement => !!e)) {
        const r = b.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        const vis = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
        cover = Math.max(cover, Math.min(1, Math.max(0, vis) / (vh * 0.35)));
    }
    veil.style.opacity = String(cover);
    // el aviso de scroll se va en cuanto se empieza a bajar
    document.body.classList.toggle('scrolled', s > 40);
    // lugar activo en la barra
    const i = chapterAt(s);
    if (i !== activeChapter) {
        activeChapter = i;
        updateIndex();
    }
};

const updateIndex = () => {
    $<HTMLElement>('chapter-position').textContent = `${String(activeChapter + 1).padStart(2, '0')} / ${String(chapters.length).padStart(2, '0')}`;
    indexEl.querySelectorAll<HTMLElement>('.chapter-link').forEach((b, k) => {
        b.classList.toggle('on', k === activeChapter);
        if (k === activeChapter) b.setAttribute('aria-current', 'location');
        else b.removeAttribute('aria-current');
    });
};

// ---- explorar libremente: la cámara se suelta y la historia se esconde
function updateMode() {
    storyMode.textContent = TEXT[lang].storyMode;
    tourMode.textContent = TEXT[lang].tourMode;
    storyMode.setAttribute('aria-pressed', String(!exploring));
    tourMode.setAttribute('aria-pressed', String(exploring));
    storyMode.disabled = tourMode.disabled = !ready;
    indexEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = !ready));
}

function renderTourCaption() {
    const article = blocks[activeChapter].cloneNode(true) as HTMLElement;
    const title = article.querySelector<HTMLElement>('.title')!;
    title.id = 'tour-chapter-title';
    article.setAttribute('aria-labelledby', title.id);
    tourCaption.replaceChildren(article);
    tourCaption.hidden = false;
    tourCaption.scrollTop = 0;
    requestAnimationFrame(markTourScrollable);
}

function markTourScrollable() {
    tourCaption.classList.toggle('scroll', tourCaption.scrollHeight > tourCaption.clientHeight + 1);
}

function selectTourChapter(i: number) {
    const v = viewer;
    if (!v || !ready) return;
    activeChapter = i;
    howEl.hidden = true;
    howEl.classList.remove('shown');
    v.selectAnnotation(i);
    updateIndex();
    renderTourCaption();
}

function explore(showHelp = false) {
    const v = viewer;
    if (!v || !ready || exploring) return;
    storyScrollOnTour = scroller.scrollTop;
    storyChapterOnTour = activeChapter;
    exploring = true;
    document.body.classList.add('exploring');
    // El cambio de modo permanece arriba, alineado bajo AR.
    backStory.hidden = true;
    veil.style.opacity = '0';
    selectTourChapter(activeChapter);
    updateMode();
    // instrucciones: se van con el primer toque o clic (que ya mueve la maqueta)
    if (showHelp) {
        tourCaption.hidden = true;
        howEl.hidden = false;
        requestAnimationFrame(() => howEl.classList.add('shown'));
    }
}

function backToStory() {
    const v = viewer;
    howEl.classList.remove('shown');
    exploring = false;
    document.body.classList.remove('exploring');
    backStory.hidden = true;
    tourCaption.hidden = true;
    layout();
    scroller.scrollTop = activeChapter === storyChapterOnTour ? storyScrollOnTour : readStart(activeChapter);
    updateMode();
    if (v) {
        v.state.cameraMode = 'anim';
        v.state.animationPaused = true;
        tNow = timeAt(scroller.scrollTop);
        v.seek(tNow);
    }
}
backStory.addEventListener('click', backToStory);
storyMode.addEventListener('click', () => {
    if (exploring) backToStory();
});
tourMode.addEventListener('click', () => explore());

// El primer gesto sobre la escena deja libre la vista sin cambiar el ancla orbital.
let captionTap: { x: number; y: number; t: number } | null = null;
window.addEventListener('pointerdown', (e) => {
    if (!exploring || (e.target as HTMLElement).closest('#index, #lang, #top-links, #logo-link')) return;
    if ((e.target as HTMLElement).closest('#tour-caption.scroll')) {
        captionTap = { x: e.clientX, y: e.clientY, t: performance.now() };
        return;
    }
    tourCaption.hidden = true;
    howEl.classList.remove('shown');
}, true);
window.addEventListener('pointerup', (e) => {
    const tap = captionTap;
    captionTap = null;
    if (tap && performance.now() - tap.t < 400 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) {
        tourCaption.hidden = true;
        stage.querySelector('canvas')?.focus();
    }
}, true);
window.addEventListener('pointercancel', () => (captionTap = null));

window.addEventListener('resize', () => {
    layout();
    if (!tourCaption.hidden) markTourScrollable();
});
document.fonts?.ready.then(() => layout());

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
applyLang();
updateIndex();
requestAnimationFrame(tick);
void mount();
