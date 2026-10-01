// ---------------------------------------------------------------------------
// San Sebastián · visor patrimonial.
//
// Toda la navegación 3D es el visor oficial de SuperSplat (@playcanvas/supersplat-viewer),
// incrustado sin su interfaz. Encima va la capa editorial: capítulos, textos y botones.
//
//   capítulo → `selectAnnotation()` (SuperSplat vuela a la pose)
//   capítulo «walk» → además activa el modo caminata de SuperSplat
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

import { defaultStory, round } from './story';
import type { Pose, Story } from './story';

const CONTENT_URL = './scene.sog';
const EDIT_KEY = 'san-sebastian:story-edit';
const EDIT_MODE = new URLSearchParams(location.search).has('editar');
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
const walkHint = $<HTMLElement>('walk-hint');
const indexEl = $<HTMLElement>('index');

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
let story: Story = defaultStory();
if (EDIT_MODE) {
    try {
        const saved = localStorage.getItem(EDIT_KEY);
        if (saved) story = JSON.parse(saved) as Story;
    } catch {
        // sin almacenamiento: se usa story.json
    }
}

const persist = () => {
    if (!EDIT_MODE) return;
    try {
        localStorage.setItem(EDIT_KEY, JSON.stringify(story));
    } catch {
        // ignorado
    }
};

/** Índice de anotación de SuperSplat para cada capítulo (solo los que tienen pose). */
let annotationOf: (number | undefined)[] = [];

/** Convierte los capítulos en los ajustes que lee el visor: cámara inicial + anotaciones. */
const buildSettings = (s: Story): ExperienceSettings => {
    const settings = defaultSettings();
    settings.background = { color: [0.059, 0.055, 0.047] };
    const first = s.chapters[0]?.pose;
    if (first) settings.cameras = [{ initial: first }];
    annotationOf = [];
    settings.annotations = [];
    s.chapters.forEach((c, i) => {
        if (!c.pose) return;
        annotationOf[i] = settings.annotations.length;
        settings.annotations.push({
            position: c.pose.target,
            title: c.nav.slice(0, 40),
            text: '',
            camera: { initial: c.pose }
        });
    });
    settings.startMode = 'default';
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
            collisionUrl: story.collision || undefined,
            renderer: 'webgl',
            ui: false,
            lang: 'es'
        });
        viewer = v;
        v.state.showAnnotations = false;
        v.events.on('progress:changed', (p: number) => setProgress(p));
        const onLoaded = () => {
            loader.dataset.hidden = 'true';
            if (EDIT_MODE) updateModeButton();
            goTo(active);
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
    chapterEl.classList.toggle('walk', c.mode === 'walk');
    chapterEl.scrollTop = 0;
    indexEl.querySelectorAll<HTMLElement>('.chapter-link').forEach((el) => {
        el.classList.toggle('on', Number(el.dataset.index) === active);
    });
};

/**
 * Ajusta el tamaño de letra para que el texto quepa completo: parte de 18 px y no baja de 14 px
 * (13.5 px solo en horizontal, con poca altura). Si aun así no cabe, el texto se puede desplazar.
 */
const shortLandscape = window.matchMedia('(orientation: landscape) and (max-height: 600px)');
const fitChapter = () => {
    const min = shortLandscape.matches ? 13.5 : 14;
    chapterEl.classList.remove('scroll');
    for (let fs = 18; fs >= min; fs -= 0.5) {
        chapterEl.style.setProperty('--fs', `${fs}px`);
        if (chapterEl.scrollHeight <= chapterEl.clientHeight + 1) return;
    }
    chapterEl.classList.add('scroll');
};
window.addEventListener('resize', fitChapter);

/** Oculta el texto mientras la cámara vuela: primero se ve el recorrido. */
const concealChapter = () => {
    chapterEl.classList.remove('shown', 'enter');
    chapterEl.hidden = false;
    document.body.classList.remove('reading');
};

/** Muestra el texto con un fundido cuando la cámara ya llegó. */
const revealChapter = () => {
    if (EDIT_MODE) return;
    chapterEl.hidden = false;
    document.body.classList.add('reading');
    chapterEl.classList.add('shown');
    chapterEl.classList.remove('enter');
    void chapterEl.offsetWidth;
    chapterEl.classList.add('enter');
};

const showWalkHint = (msg: string) => {
    walkHint.textContent = msg;
    walkHint.hidden = false;
};

const goTo = (i: number) => {
    const c = story.chapters[i];
    if (!c) return;
    active = i;
    cancelArrival?.();
    cancelArrival = null;
    walkHint.hidden = true;
    renderChapter();
    concealChapter();
    fitChapter();
    if (EDIT_MODE) syncEditor();

    const v = viewer;
    if (!v || !v.state.loaded) {
        revealChapter();
        return;
    }

    const ai = annotationOf[i];
    if (ai !== undefined) v.selectAnnotation(ai);
    else if (i === 0) v.frameScene();

    // El texto (y la caminata, en ese lugar) esperan a que la cámara termine el vuelo.
    const arrived = () => {
        if (v !== viewer || active !== i) return;
        cancelArrival = null;
        revealChapter();
        if (c.mode !== 'walk') {
            enterLookAround(v);
            return;
        }
        // El modo caminata de SuperSplat busca suelo cerca de la cámara: solo funciona al llegar.
        if (v.state.walkAllowed) {
            v.state.gamingControls = false; // en caminata, tocar el suelo camina hasta allí
            v.state.cameraMode = 'walk';
            showWalkHint('Toca el suelo para caminar · arrastra para mirar');
        } else {
            showWalkHint(
                EDIT_MODE ? 'Modo caminata: falta el archivo de colisión de la escena.' : 'Arrastra para mirar alrededor'
            );
        }
    };
    if (c.pose && ai !== undefined) cancelArrival = waitForArrival(v, c.pose, arrived);
    else arrived();
};

/**
 * Al llegar a un lugar, la cámara gira siempre sobre su propio eje: modo de vuelo de SuperSplat
 * con «controles de juego» en pantallas táctiles (un dedo gira; el toque no la lleva a ningún
 * punto ni el pellizco la desplaza). Así nunca orbita alrededor de un punto lejano o cercano.
 */
const enterLookAround = (v: ViewerHandle) => {
    if (EDIT_MODE) return;
    v.state.gamingControls = navigator.maxTouchPoints > 0;
    v.state.cameraMode = 'fly';
};

/** Llama a `done` cuando la cámara del visor llega a `pose`, o queda quieta cerca de ella. */
const waitForArrival = (v: ViewerHandle, pose: Pose, done: () => void) => {
    const goal = new Vec3(...pose.position);
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

// Al tocar la escena (o el texto) el texto desaparece: se queda la vista libre para mirar.
// Si el toque llega en pleno vuelo, la cámara se detiene ahí y gira sobre su propio eje.
window.addEventListener(
    'pointerdown',
    (e) => {
        if (EDIT_MODE) return;
        // SuperSplat solo sabe si es un dedo o un ratón tras el primer toque: se lo indicamos ya
        if (viewer?.state.cameraMode === 'fly') viewer.state.gamingControls = e.pointerType === 'touch';
        if ((e.target as HTMLElement).closest('#index, #chapter-nav, #chapter.scroll')) return;
        const flying = cancelArrival !== null;
        cancelArrival?.();
        cancelArrival = null;
        chapterEl.classList.remove('shown');
        document.body.classList.remove('reading');
        walkHint.hidden = true;
        if (flying && viewer?.state.loaded) enterLookAround(viewer);
    },
    true
);

window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    // en caminata/vuelo las flechas mueven la cámara de SuperSplat
    if (viewer && (viewer.state.cameraMode === 'walk' || viewer.state.cameraMode === 'fly')) return;
    if (e.key === 'ArrowRight') step(1);
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
const currentViewerPose = (): Pose | null => {
    const app = viewer?.app;
    if (!app) return null;
    const cams = app.root.findComponents('camera') as CameraComponent[];
    const cam = cams.find((c) => c.enabled) ?? cams[0];
    if (!cam) return null;
    const entity = cam.entity as Entity;
    const pos = entity.getPosition().clone();
    const fwd = entity.forward.clone().normalize();
    // distancia al punto de mira: la del lugar si ya tenía pose, si no hasta el centro de la plaza
    const prev = story.chapters[editIndex]?.pose ?? story.chapters[0]?.pose;
    const center = prev ? new Vec3(...prev.target) : new Vec3(0, 0, 0);
    const dist = Math.max(1, center.sub(pos).dot(fwd));
    const target = pos.clone().add(fwd.mulScalar(dist));
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
void mountViewer();
