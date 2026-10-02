// ---------------------------------------------------------------------------
// San Sebastián · visor patrimonial.
//
// Toda la navegación 3D es el visor oficial de SuperSplat (@playcanvas/supersplat-viewer),
// incrustado sin su interfaz. Encima va la capa editorial: capítulos, textos y botones.
//
//   lugar → `selectAnnotation()`: SuperSplat vuela a la pose y orbita alrededor del lugar (ancla)
//   si el usuario desplaza la cámara → modo vuelo de SuperSplat: gira sobre su propio eje
//
// `?editar`  muestra el editor: se navega con el visor, se captura la pose de su cámara,
//            se escriben los textos y se copian los datos para `src/story.json`.
// ---------------------------------------------------------------------------
import '@playcanvas/supersplat-viewer/viewer.css';
import './viewer.css';

import { createViewer } from '@playcanvas/supersplat-viewer/viewer';
import type { ViewerHandle } from '@playcanvas/supersplat-viewer/viewer';
import { defaultSettings } from '@playcanvas/supersplat-viewer/settings';
import type { ExperienceSettings } from '@playcanvas/supersplat-viewer/settings';
import { Vec3 } from 'playcanvas';
import type { CameraComponent, Entity } from 'playcanvas';

import { INTRO_SECONDS, autoKeyframes, trackFromKeyframes } from './intro';
import { startReveal } from './reveal';
import { defaultStory, round } from './story';
import { setupTimeline, timelineAfterMount, timelineKeyframes } from './timeline';
import type { Keyframe, Pose, Story } from './story';

const CONTENT_URL = './scene.sog';
const EDIT_KEY = 'san-sebastian:story-edit';
const EDIT_MODE = new URLSearchParams(location.search).has('editar');
/** `?animar`: línea de tiempo para crear la animación de entrada. */
const ANIMAR = new URLSearchParams(location.search).has('animar');
/** En cualquiera de los dos modos de edición no hay límites de cámara ni textos encima. */
const AUTHORING = EDIT_MODE || ANIMAR;
/** Animación de entrada al abrir (no al editar; `?sinintro` la salta). */
const INTRO = !AUTHORING && !new URLSearchParams(location.search).has('sinintro');
/** Altura (m) del suelo de la maqueta y zona (centro y radio, en planta) donde está el modelo. */
const GROUND_Y = 23;
const SCENE_CENTER: [number, number] = [15.8, 4.6];
const SCENE_RADIUS = 75;
/** La órbita no baja de la horizontal del ancla (0°): no se ve la maqueta desde abajo. */
const ORBIT_MAX_PITCH = 0;
/**
 * Radial Reveal de la entrada (ver reveal.ts): a 14 m/s la onda de puntos cubre la maqueta (~70 m de
 * radio) en 5 s y la de colores, 1,5 s detrás, en 6,5 s: dentro de los 8 s de la animación.
 * `radius` cubre toda la escena; `dotScale` agranda los puntos del efecto original para esta escala.
 */
const REVEAL = { radius: 120, speed: 14, delay: 1.5, lift: 3, band: 6, dotScale: 60 };
/** Suelo del modo vuelo (m): la cámara no puede quedar bajo la maqueta. */
const FLY_MIN_Y = GROUND_Y + 1.5;
/** Distancia (m) a la pose del lugar a la que se considera que el vuelo terminó. */
const ARRIVAL_DISTANCE = 0.6;
/** Si el vuelo no termina en este tiempo, se muestra el texto igual. */
const ARRIVAL_TIMEOUT_MS = 60000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $<HTMLElement>('stage');
const loader = $<HTMLElement>('loader');
const loaderFill = $<HTMLElement>('loader-fill');
const loaderMessage = $<HTMLElement>('loader-message');
const mastKicker = $<HTMLElement>('masthead-kicker');
const mastTitle = $<HTMLElement>('masthead-title');
const chapterEl = $<HTMLElement>('chapter');
const chKicker = $<HTMLElement>('chapter-kicker');
const chTitle = $<HTMLElement>('chapter-title');
const chText = $<HTMLElement>('chapter-text');
const indexEl = $<HTMLElement>('index');

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
let story: Story = defaultStory();
if (EDIT_MODE) {
    // Las poses guardadas en este navegador se reaplican por id sobre los lugares actuales,
    // así sobreviven si se agregan o quitan lugares (los textos siempre vienen de story.json).
    try {
        const saved = JSON.parse(localStorage.getItem(EDIT_KEY) ?? 'null') as Story | null;
        for (const c of story.chapters) {
            const old = saved?.chapters?.find((s) => s.id === c.id);
            if (old?.pose) c.pose = old.pose;
        }
    } catch {
        // sin almacenamiento: se usa story.json
    }
}

// Límites que lee el parche de SuperSplat (ver vite.config.ts). En edición no hay límites.
{
    const g = globalThis as unknown as Record<string, number>;
    g.__ORBIT_PITCH_MIN = -90;
    g.__ORBIT_PITCH_MAX = AUTHORING ? 90 : ORBIT_MAX_PITCH;
    g.__FLY_MIN_Y = AUTHORING ? -Infinity : FLY_MIN_Y;
}

const persist = () => {
    if (!EDIT_MODE) return;
    try {
        localStorage.setItem(EDIT_KEY, JSON.stringify(story));
    } catch {
        // ignorado
    }
};

/**
 * Punto del suelo al que apunta la cámara, si el rayo baja y cae dentro de la maqueta. Es el ancla
 * natural de un lugar: la órbita gira alrededor de lo que se ve en el centro de la pantalla.
 */
const groundHit = (origin: Vec3, dir: Vec3): Vec3 | null => {
    const d = dir.clone().normalize();
    if (d.y > -0.01) return null;
    const t = (GROUND_Y - origin.y) / d.y;
    if (t <= 0 || t > 160) return null;
    const hit = origin.clone().add(d.mulScalar(t));
    return Math.hypot(hit.x - SCENE_CENTER[0], hit.z - SCENE_CENTER[1]) <= SCENE_RADIUS ? hit : null;
};

/** Ancla de un lugar: donde su vista apunta al suelo; si no, el punto de mira guardado. */
const anchorOf = (pose: Pose): Pose['target'] => {
    const pos = new Vec3(...pose.position);
    const hit = groundHit(pos, new Vec3(...pose.target).sub(pos));
    return hit ? [round(hit.x), round(hit.y), round(hit.z)] : pose.target;
};

/** Índice de anotación de SuperSplat para cada lugar (solo los que tienen pose). */
let annotationOf: (number | undefined)[] = [];

/** True mientras suena la animación de entrada. */
let introActive = false;
/** Dónde termina la cámara en la entrada: al llegar ahí sale el texto. */
let introGoal: Pose['position'] | null = null;

/** Convierte los capítulos en los ajustes que lee el visor: cámara inicial + anotaciones. */
const buildSettings = (s: Story): ExperienceSettings => {
    const settings = defaultSettings();
    settings.background = { color: [0.059, 0.055, 0.047] };
    const withAnchor = (p: Pose): Pose => ({ ...p, target: anchorOf(p) });
    const first = s.chapters[0]?.pose;
    if (first) settings.cameras = [{ initial: withAnchor(first) }];
    annotationOf = [];
    settings.annotations = [];
    s.chapters.forEach((c, i) => {
        if (!c.pose) return;
        const cam = withAnchor(c.pose);
        annotationOf[i] = settings.annotations.length;
        settings.annotations.push({
            position: cam.target,
            title: c.nav.slice(0, 40),
            text: '',
            camera: { initial: cam }
        });
    });
    settings.startMode = 'default';
    introActive = false;
    introGoal = null;
    const lastOf = (ks: Keyframe[]) => [...ks].sort((a, b) => a.t - b.t)[ks.length - 1];
    if (ANIMAR) {
        // vista previa de la línea de tiempo: la pista con los keyframes actuales (quieta si hay menos de 2)
        const ks = timelineKeyframes();
        const still: Keyframe[] = first
            ? [0, INTRO_SECONDS].map((t) => ({ t, position: first.position, target: anchorOf(first), fov: first.fov }))
            : [];
        const use = ks.length >= 2 ? ks : still;
        if (use.length >= 2) {
            settings.animTracks = [trackFromKeyframes(use)];
            settings.startMode = 'animTrack';
        }
    } else if (INTRO && first) {
        // entrada hecha con la línea de tiempo (story.json) o, si no hay, la automática
        const custom = (s.intro?.keyframes?.length ?? 0) >= 2;
        const ks = custom ? (s.intro as NonNullable<Story['intro']>).keyframes : autoKeyframes(first, anchorOf(first), 33);
        settings.animTracks = [trackFromKeyframes(ks)];
        settings.startMode = 'animTrack';
        introActive = true;
        introGoal = lastOf(ks).position;
    }
    return settings;
};

// ---------------------------------------------------------------------------
// Visor SuperSplat
// ---------------------------------------------------------------------------
let viewer: ViewerHandle | null = null;
let active = 0;
/** Cancela la espera de llegada en curso (al cambiar de capítulo). */
let cancelArrival: (() => void) | null = null;

const setProgress = (p: number) => {
    loaderFill.style.transform = `scaleX(${Math.max(0, Math.min(1, p / 100))})`;
};

const mountViewer = async () => {
    viewer?.destroy();
    viewer = null;
    stage.replaceChildren();
    loader.dataset.hidden = 'false';
    loaderMessage.textContent = 'Cargando la plaza';
    setProgress(0);

    try {
        const v = await createViewer({
            container: stage,
            settings: buildSettings(story),
            contentUrl: CONTENT_URL,
            contentFilename: 'scene.sog',
            renderer: 'webgl',
            ui: false,
            lang: 'es'
        });
        viewer = v;
        v.state.showAnnotations = false;
        // SuperSplat guarda esta opción en el navegador: una visita anterior pudo dejarla activada
        v.state.gamingControls = false;
        v.events.on('progress:changed', (p: number) => setProgress(p));
        const onLoaded = () => {
            if (EDIT_MODE) updateModeButton();
            if (ANIMAR) {
                timelineAfterMount(v);
            } else if (introActive) {
                // el efecto se pone antes de mostrar la escena: nace de la oscuridad desde el primer cuadro
                const first = story.chapters[0]?.pose;
                const center = first ? anchorOf(first) : ([SCENE_CENTER[0], GROUND_Y, SCENE_CENTER[1]] as Pose['target']);
                startReveal(v, { center, ...REVEAL });
                playIntro(v);
            } else {
                goTo(active);
            }
            requestAnimationFrame(() => requestAnimationFrame(() => (loader.dataset.hidden = 'true')));
        };
        if (v.state.loaded) onLoaded();
        else v.events.once('loaded:changed', onLoaded);
    } catch (err) {
        console.error(err);
        loaderMessage.textContent = 'Este navegador no pudo abrir la escena 3D.';
    }
};

// ---------------------------------------------------------------------------
// Capítulos
// ---------------------------------------------------------------------------
const renderChapterText = (text: string) => {
    chText.replaceChildren();
    text.split(/\n\s*\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => {
            const p = document.createElement('p');
            p.textContent = t;
            chText.append(p);
        });
    chText.hidden = !chText.childElementCount;
};

const renderChapter = () => {
    const c = story.chapters[active];
    if (!c) return;
    chKicker.textContent = c.kicker;
    chKicker.hidden = !c.kicker;
    chTitle.textContent = c.title;
    renderChapterText(c.text);
    chapterEl.scrollTop = 0;
    indexEl.querySelectorAll<HTMLElement>('.chapter-link').forEach((el) => {
        el.classList.toggle('on', Number(el.dataset.index) === active);
    });
};

/**
 * Todas las descripciones usan el mismo tamaño de letra. Si un texto no cabe en el panel, el panel
 * se desplaza (y entonces recibe los toques en lugar de la escena).
 */
const markScrollable = () => {
    chapterEl.classList.toggle('scroll', chapterEl.scrollHeight > chapterEl.clientHeight + 1);
};
window.addEventListener('resize', markScrollable);

/** Oculta el texto mientras la cámara vuela: primero se ve el recorrido. */
const concealChapter = () => {
    chapterEl.classList.remove('shown', 'enter');
    chapterEl.hidden = false;
    document.body.classList.remove('reading');
};

/** Muestra el texto con un fundido cuando la cámara ya llegó. */
const revealChapter = () => {
    if (AUTHORING) return;
    chapterEl.hidden = false;
    document.body.classList.add('reading');
    chapterEl.classList.add('shown');
    chapterEl.classList.remove('enter');
    void chapterEl.offsetWidth;
    chapterEl.classList.add('enter');
};

/** Entrada: suena la animación y, al terminar en la vista general, se anuda el ancla y sale el texto. */
const playIntro = (v: ViewerHandle) => {
    const goal = introGoal ?? story.chapters[0]?.pose?.position;
    active = 0;
    renderChapter();
    concealChapter();
    markScrollable();
    if (!goal) {
        introActive = false;
        revealChapter();
        return;
    }
    cancelArrival = waitForArrival(v, goal, () => {
        cancelArrival = null;
        if (v !== viewer) return;
        // La entrada terminó: la vista general se vuelve el ancla. Si la animación acabó en otro
        // sitio, la cámara vuela hasta ella y el texto sale al llegar; si ya está, sale enseguida.
        goTo(0);
    });
};

const goTo = (i: number) => {
    const c = story.chapters[i];
    if (!c) return;
    introActive = false;
    active = i;
    cancelArrival?.();
    cancelArrival = null;
    renderChapter();
    concealChapter();
    markScrollable();
    if (EDIT_MODE) syncEditor();

    const v = viewer;
    if (!v || !v.state.loaded) {
        revealChapter();
        return;
    }

    // SuperSplat vuela a la pose del lugar y deja la cámara en órbita alrededor de su ancla.
    const ai = annotationOf[i];
    if (ai !== undefined) v.selectAnnotation(ai);
    else if (i === 0) v.frameScene();

    // El texto espera a que la cámara termine el vuelo.
    const arrived = () => {
        if (v !== viewer || active !== i) return;
        cancelArrival = null;
        revealChapter();
    };
    if (c.pose && ai !== undefined) cancelArrival = waitForArrival(v, c.pose.position, arrived);
    else arrived();
};

/**
 * Modo vuelo de SuperSplat: la cámara gira siempre sobre su propio eje, nunca alrededor de un ancla.
 * Los gestos son los nativos de SuperSplat: un dedo gira, dos dedos desplazan, pellizco acerca o
 * aleja; con ratón, arrastrar gira y W A S D mueve. No se usan los «controles de juego» (joystick),
 * que quitan el desplazamiento con dos dedos y el zoom.
 */
const enterFly = (v: ViewerHandle) => {
    if (AUTHORING || v.state.cameraMode === 'fly') return;
    v.state.cameraMode = 'fly';
};

/** Llama a `done` cuando la cámara del visor llega a `pose`, o queda quieta cerca de ella. */
const waitForArrival = (v: ViewerHandle, position: Pose['position'], done: () => void) => {
    const goal = new Vec3(...position);
    const last = new Vec3(1e9, 1e9, 1e9);
    const start = performance.now();
    let still = 0;
    let raf = 0;
    const tick = () => {
        const cam = (v.app.root.findComponents('camera') as CameraComponent[])[0];
        if (cam) {
            const p = cam.entity.getPosition();
            const d = p.distance(goal);
            still = p.distance(last) < 0.01 ? still + 1 : 0;
            last.copy(p);
            if (d < ARRIVAL_DISTANCE || (still > 30 && d < 3)) {
                done();
                return;
            }
        }
        if (performance.now() - start > ARRIVAL_TIMEOUT_MS) {
            done();
            return;
        }
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
};

const step = (d: number) => {
    const n = story.chapters.length;
    goTo((active + d + n) % n);
};

const renderIndex = () => {
    indexEl.replaceChildren();
    story.chapters.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chapter-link';
        b.dataset.index = String(i);
        b.textContent = c.nav;
        b.addEventListener('click', () => goTo(i));
        indexEl.append(b);
    });
};

const renderMasthead = () => {
    mastKicker.textContent = story.place.kicker;
    mastTitle.textContent = story.place.title;
    document.title = `${story.place.title} · Cuenca`;
};

$<HTMLButtonElement>('prev').addEventListener('click', () => step(-1));
$<HTMLButtonElement>('next').addEventListener('click', () => step(1));

// Al tocar la escena el texto desaparece y queda la vista libre. Si el toque llega en pleno vuelo,
// la cámara se detiene ahí y gira sobre su propio eje (aún no hay ancla a la que orbitar).
window.addEventListener(
    'pointerdown',
    (e) => {
        if (AUTHORING) return;
        if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) gesture = touchSpan();
        const target = e.target as HTMLElement;
        if (target.closest('#index, #chapter-nav, #chapter.scroll')) return;
        const flying = cancelArrival !== null;
        cancelArrival?.();
        cancelArrival = null;
        introActive = false;
        chapterEl.classList.remove('shown');
        document.body.classList.remove('reading');
        if (flying && viewer?.state.loaded) enterFly(viewer);
    },
    true
);

// «Mover» la escena (desplazarla, no orbitarla) pasa a modo vuelo: ya no hay ancla y la cámara gira
// sobre su propio eje. Desplazar = dos dedos que se mueven juntos, botón derecho/central o Mayús.
const touches = new Map<number, { x: number; y: number }>();
let gesture: { cx: number; cy: number; span: number } | null = null;

function touchSpan() {
    const [a, b] = [...touches.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y) };
}

window.addEventListener(
    'pointermove',
    (e) => {
        const v = viewer;
        if (AUTHORING || !v || v.state.cameraMode !== 'orbit') return;
        if (e.pointerType === 'touch') {
            const p = touches.get(e.pointerId);
            if (!p) return;
            p.x = e.clientX;
            p.y = e.clientY;
            if (touches.size !== 2 || !gesture) return;
            const now = touchSpan();
            const moved = Math.hypot(now.cx - gesture.cx, now.cy - gesture.cy);
            const pinched = Math.abs(now.span - gesture.span);
            if (moved > 10 && moved > pinched) enterFly(v); // los dedos se desplazan: es mover, no acercar
        } else if (e.buttons & 6 || (e.buttons & 1 && (e.shiftKey || e.ctrlKey || e.metaKey))) {
            enterFly(v);
        }
    },
    true
);

const endTouch = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    gesture = null;
};
window.addEventListener('pointerup', endTouch, true);
window.addEventListener('pointercancel', endTouch, true);

window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const v = viewer;
    // en vuelo las flechas mueven la cámara de SuperSplat
    if (v?.state.cameraMode === 'fly') return;
    // teclas de movimiento: mover la cámara = modo vuelo
    if (v?.state.loaded && /^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE)$/.test(e.code)) enterFly(v);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
});

// ---------------------------------------------------------------------------
// Modo edición: solo una barra mínima. Se navega con el visor de SuperSplat, se captura la pose
// de su cámara y se copian los datos. Los textos se editan en story.json.
// ---------------------------------------------------------------------------
let editIndex = 0;
const edSelect = $<HTMLSelectElement>('ed-select');
const edStatus = $<HTMLElement>('ed-status');
const edExportBox = $<HTMLElement>('ed-export-box');
const edExport = $<HTMLTextAreaElement>('ed-export');
const edMode = $<HTMLButtonElement>('ed-mode');
let posesDirty = false;
let statusTimer = 0;

const setStatus = (msg: string) => {
    edStatus.textContent = msg;
    edStatus.hidden = !msg;
    window.clearTimeout(statusTimer);
    if (msg) statusTimer = window.setTimeout(() => (edStatus.hidden = true), 2500);
};

const renderEditorSelect = () => {
    edSelect.replaceChildren();
    story.chapters.forEach((c, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${c.pose ? '✓' : '·'} ${c.nav}`;
        edSelect.append(o);
    });
    edSelect.value = String(editIndex);
};

function syncEditor() {
    editIndex = active;
    edSelect.value = String(editIndex);
}

/** Pose actual de la cámara del visor: posición, punto de mira y campo de visión. */
const currentViewerPose = (distance?: number): Pose | null => {
    const app = viewer?.app;
    if (!app) return null;
    const cams = app.root.findComponents('camera') as CameraComponent[];
    const cam = cams.find((c) => c.enabled) ?? cams[0];
    if (!cam) return null;
    const entity = cam.entity as Entity;
    const pos = entity.getPosition().clone();
    const fwd = entity.forward.clone().normalize();
    // punto de mira = donde la vista toca el suelo de la maqueta (el ancla de la órbita);
    // si mira al horizonte o fuera de la maqueta, 40 m al frente
    const target =
        distance !== undefined
            ? pos.clone().add(fwd.clone().mulScalar(distance))
            : (groundHit(pos, fwd) ?? pos.clone().add(fwd.clone().mulScalar(40)));
    return {
        position: [round(pos.x), round(pos.y), round(pos.z)],
        target: [round(target.x), round(target.y), round(target.z)],
        fov: round(cam.fov, 1)
    };
};

function updateModeButton() {
    edMode.textContent = viewer?.state.cameraMode === 'fly' ? 'Vuelo' : 'Órbita';
}

const setupEditor = () => {
    document.body.classList.add('edit');
    $<HTMLElement>('editor').hidden = false;
    chapterEl.hidden = true;
    renderEditorSelect();
    syncEditor();

    // elegir un lugar lleva la cámara a su pose (recargando el visor si hay poses nuevas)
    edSelect.addEventListener('change', async () => {
        editIndex = Number(edSelect.value);
        active = editIndex;
        if (posesDirty) {
            posesDirty = false;
            await mountViewer();
        } else {
            goTo(editIndex);
        }
    });

    edMode.addEventListener('click', () => {
        if (!viewer?.state.loaded) return;
        viewer.state.cameraMode = viewer.state.cameraMode === 'fly' ? 'orbit' : 'fly';
        updateModeButton();
        setStatus(viewer.state.cameraMode === 'fly' ? 'Vuelo: toca un punto para ir hasta allí' : 'Órbita');
    });

    $<HTMLButtonElement>('ed-capture').addEventListener('click', () => {
        const pose = currentViewerPose();
        if (!pose) {
            setStatus('El visor todavía no está listo');
            return;
        }
        story.chapters[editIndex].pose = pose;
        posesDirty = true;
        persist();
        renderEditorSelect();
        setStatus(`Capturado: ${story.chapters[editIndex].nav}`);
    });

    $<HTMLButtonElement>('ed-copy').addEventListener('click', async () => {
        const poses = Object.fromEntries(story.chapters.map((c) => [c.id, c.pose]));
        const json = JSON.stringify(poses, null, 1);
        try {
            await navigator.clipboard.writeText(json);
            setStatus('Poses copiadas: pégalas en el chat');
        } catch {
            edExport.value = json;
            edExportBox.hidden = false;
            edExport.focus();
            edExport.select();
        }
    });

    $<HTMLButtonElement>('ed-export-close').addEventListener('click', () => (edExportBox.hidden = true));
};

// ---------------------------------------------------------------------------
renderMasthead();
renderIndex();
if (EDIT_MODE) setupEditor();
if (ANIMAR) {
    setupTimeline(
        {
            viewer: () => viewer,
            capture: (distance) => currentViewerPose(distance),
            remount: () => mountViewer(),
            seed: () => {
                const p = story.chapters[0]?.pose;
                return p ? autoKeyframes(p, anchorOf(p), 6) : [];
            }
        },
        story.intro?.keyframes
    );
}
void mountViewer();
