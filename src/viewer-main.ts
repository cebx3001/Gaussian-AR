// ---------------------------------------------------------------------------
// Visor 3D de la plaza de San Sebastián (Cuenca).
//
//   maqueta completa a ~45° → animación de entrada → botones 1…5 que vuelan
//   la cámara a cada punto y abren su texto (narrativa espacial).
//
// `?editar`   modo edición: se navega, se captura la pose de cada punto y se
//             copian los datos (para pegarlos en src/story.json).
// `?sinintro` salta la animación de entrada.
// ---------------------------------------------------------------------------
import './viewer.css';

import {
    AppBase,
    AppOptions,
    Asset,
    BinaryHandler,
    CameraComponentSystem,
    Color,
    ContainerHandler,
    Entity,
    FILLMODE_FILL_WINDOW,
    GSplatComponentSystem,
    GSplatHandler,
    RESOLUTION_AUTO,
    TextureHandler,
    Vec3,
    createGraphicsDevice
} from 'playcanvas';
import type { BoundingBox } from 'playcanvas';

import { defaultStory, round } from './story';
import type { Pose, Story } from './story';

const SCENE_URL = 'scene.sog';
const EDIT_KEY = 'gaussian-ar:story-edit';

const params = new URLSearchParams(location.search);
const EDIT_MODE = params.has('editar');
const SKIP_INTRO = params.has('sinintro');

const DEG = Math.PI / 180;
const OVERVIEW_FOV = 60;
const OVERVIEW_PITCH = 45;
const OVERVIEW_YAW = 35;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const loader = $<HTMLElement>('loader');
const loaderMessage = $<HTMLElement>('loader-message');
const loaderFill = $<HTMLElement>('loader-fill');
const brandKicker = $<HTMLElement>('brand-kicker');
const brandTitle = $<HTMLElement>('brand-title');
const arLink = $<HTMLAnchorElement>('ar-link');
const panel = $<HTMLElement>('panel');
const panelKicker = $<HTMLElement>('panel-kicker');
const panelTitle = $<HTMLElement>('panel-title');
const panelText = $<HTMLElement>('panel-text');
const panelCount = $<HTMLElement>('panel-count');
const prevBtn = $<HTMLButtonElement>('prev');
const nextBtn = $<HTMLButtonElement>('next');
const stopsEl = $<HTMLElement>('stops');
const editor = $<HTMLElement>('editor');

// ---------------------------------------------------------------------------
// Datos de la narrativa
// ---------------------------------------------------------------------------
let story: Story = defaultStory();

if (EDIT_MODE) {
    try {
        const saved = localStorage.getItem(EDIT_KEY);
        if (saved) story = JSON.parse(saved) as Story;
    } catch {
        // sin almacenamiento: se usa story.json tal cual
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

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------
// WebGPU si existe; si no, WebGL2 (la mayoría de los teléfonos).
const device = await createGraphicsDevice(canvas, {
    deviceTypes: ['webgpu', 'webgl2'],
    antialias: false
});
device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

const options = new AppOptions();
options.graphicsDevice = device;
options.componentSystems = [CameraComponentSystem, GSplatComponentSystem];
options.resourceHandlers = [TextureHandler, ContainerHandler, BinaryHandler, GSplatHandler];

const app = new AppBase(canvas);
app.init(options);
app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
app.setCanvasResolution(RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());
app.start();

const camera = new Entity('camera');
camera.addComponent('camera', {
    clearColor: new Color(0.02, 0.025, 0.035),
    fov: OVERVIEW_FOV,
    nearClip: 0.05,
    farClip: 1000
});
app.root.addChild(camera);

// ---------------------------------------------------------------------------
// Cámara orbital: objetivo + yaw + pitch + distancia. Una pose guardada
// (posición, objetivo, fov) se convierte a estos parámetros y viceversa.
// ---------------------------------------------------------------------------
type Orbit = { tx: number; ty: number; tz: number; yaw: number; pitch: number; distance: number; fov: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const target = new Vec3();
const camPos = new Vec3();
let yaw = OVERVIEW_YAW;
let pitch = OVERVIEW_PITCH;
let distance = 10;
let fov = OVERVIEW_FOV;
let sceneRadius = 5;
const sceneCenter = new Vec3();

const getOrbit = (): Orbit => ({ tx: target.x, ty: target.y, tz: target.z, yaw, pitch, distance, fov });

const setOrbit = (o: Orbit) => {
    target.set(o.tx, o.ty, o.tz);
    yaw = o.yaw;
    pitch = o.pitch;
    distance = o.distance;
    fov = o.fov;
};

const applyOrbit = () => {
    const yawRad = yaw * DEG;
    const pitchRad = pitch * DEG;
    const cosPitch = Math.cos(pitchRad);
    camPos.set(
        target.x + distance * Math.sin(yawRad) * cosPitch,
        target.y + distance * Math.sin(pitchRad),
        target.z + distance * Math.cos(yawRad) * cosPitch
    );
    camera.setPosition(camPos);
    camera.lookAt(target);
    if (camera.camera) camera.camera.fov = fov;
};

const poseFromOrbit = (o: Orbit): Pose => {
    const yawRad = o.yaw * DEG;
    const pitchRad = o.pitch * DEG;
    const cosPitch = Math.cos(pitchRad);
    return {
        position: [
            o.tx + o.distance * Math.sin(yawRad) * cosPitch,
            o.ty + o.distance * Math.sin(pitchRad),
            o.tz + o.distance * Math.cos(yawRad) * cosPitch
        ],
        target: [o.tx, o.ty, o.tz],
        fov: o.fov
    };
};

const orbitFromPose = (p: Pose): Orbit | null => {
    const dx = p.position[0] - p.target[0];
    const dy = p.position[1] - p.target[1];
    const dz = p.position[2] - p.target[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!Number.isFinite(d) || d < 1e-6) return null;
    return {
        tx: p.target[0],
        ty: p.target[1],
        tz: p.target[2],
        yaw: Math.atan2(dx, dz) / DEG,
        pitch: Math.asin(clamp(dy / d, -1, 1)) / DEG,
        distance: d,
        fov: p.fov
    };
};

const roundPose = (p: Pose): Pose => ({
    position: [round(p.position[0]), round(p.position[1]), round(p.position[2])],
    target: [round(p.target[0]), round(p.target[1]), round(p.target[2])],
    fov: round(p.fov, 1)
});

/** Maqueta completa: la pose guardada o, si no hay, un encuadre automático a ~45°. */
const getOverview = (): Orbit => {
    const saved = story.overview ? orbitFromPose(story.overview) : null;
    if (saved) return saved;
    return {
        tx: sceneCenter.x,
        ty: sceneCenter.y,
        tz: sceneCenter.z,
        yaw: OVERVIEW_YAW,
        pitch: OVERVIEW_PITCH,
        distance: (sceneRadius / Math.sin((OVERVIEW_FOV * DEG) / 2)) * 0.85,
        fov: OVERVIEW_FOV
    };
};

/** Pose de un punto: la guardada o una vista provisional alrededor de la maqueta. */
const getPointOrbit = (i: number): Orbit => {
    const saved = story.points[i]?.pose ? orbitFromPose(story.points[i].pose as Pose) : null;
    if (saved) return saved;
    const o = getOverview();
    return { ...o, yaw: o.yaw + 72 * (i + 1), pitch: 28, distance: o.distance * 0.55 };
};

// ---------------------------------------------------------------------------
// Animaciones
// ---------------------------------------------------------------------------
type Anim = { t: number; dur: number; step: (k: number) => void };
let anim: Anim | null = null;

app.on('update', (dt: number) => {
    if (!anim) return;
    anim.t += dt;
    const k = Math.min(1, anim.t / anim.dur);
    anim.step(k);
    if (k >= 1) anim = null;
});

const interrupt = () => {
    anim = null;
};

/** Vuelo suave de la cámara actual a otra vista, con un pequeño arco hacia arriba. */
const flyTo = (to: Orbit, dur: number) => {
    const a = poseFromOrbit(getOrbit());
    const b = poseFromOrbit(to);
    const span = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]);
    const arc = Math.min(sceneRadius * 0.25, span * 0.2);

    anim = {
        t: 0,
        dur,
        step: (k) => {
            const e = easeInOut(k);
            const pose: Pose = {
                position: [
                    lerp(a.position[0], b.position[0], e),
                    lerp(a.position[1], b.position[1], e) + Math.sin(Math.PI * e) * arc,
                    lerp(a.position[2], b.position[2], e)
                ],
                target: [
                    lerp(a.target[0], b.target[0], e),
                    lerp(a.target[1], b.target[1], e),
                    lerp(a.target[2], b.target[2], e)
                ],
                fov: lerp(a.fov, b.fov, e)
            };
            const o = orbitFromPose(pose);
            if (o) {
                setOrbit(o);
                applyOrbit();
            }
        }
    };
};

/** Entra desde más cerca y más bajo, girando hasta la vista de la maqueta completa. */
const playIntro = () => {
    const end = getOverview();
    const start: Orbit = { ...end, yaw: end.yaw - 150, pitch: 12, distance: end.distance * 0.5 };
    setOrbit(start);
    applyOrbit();
    anim = {
        t: 0,
        dur: 8,
        step: (k) => {
            const e = easeOut(k);
            setOrbit({
                ...end,
                yaw: lerp(start.yaw, end.yaw, e),
                pitch: lerp(start.pitch, end.pitch, e),
                distance: lerp(start.distance, end.distance, e)
            });
            applyOrbit();
        }
    };
};

// ---------------------------------------------------------------------------
// Controles: arrastrar = orbitar, rueda / pellizco = zoom, clic derecho o
// dos dedos = desplazar.
// ---------------------------------------------------------------------------
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart = 0;

const pinchSpan = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
};

const zoomBy = (factor: number) => {
    distance = clamp(distance * factor, sceneRadius * 0.05, sceneRadius * 6);
    applyOrbit();
};

const pan = (dx: number, dy: number) => {
    const k = (2 * distance * Math.tan((fov * DEG) / 2)) / (canvas.clientHeight || window.innerHeight);
    const r = camera.right;
    const u = camera.up;
    target.set(
        target.x + (-dx * r.x + dy * u.x) * k,
        target.y + (-dx * r.y + dy * u.y) * k,
        target.z + (-dx * r.z + dy * u.z) * k
    );
    applyOrbit();
};

canvas.addEventListener('pointerdown', (e) => {
    interrupt();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) pinchStart = pinchSpan();
});

canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (pointers.size === 1) {
        if (e.buttons & 2 || e.shiftKey) {
            pan(dx, dy);
        } else {
            yaw -= dx * 0.3;
            pitch = clamp(pitch + dy * 0.3, -89, 89);
            applyOrbit();
        }
    } else if (pointers.size === 2) {
        const span = pinchSpan();
        if (pinchStart > 0 && span > 0) zoomBy(pinchStart / span);
        pinchStart = span;
        pan(dx / 2, dy / 2);
    }
});

const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinchStart = 0;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
    'wheel',
    (e) => {
        e.preventDefault();
        interrupt();
        zoomBy(1 + e.deltaY * 0.001);
    },
    { passive: false }
);

// ---------------------------------------------------------------------------
// Narrativa: botones, panel y navegación
// ---------------------------------------------------------------------------
let active = -1; // -1 = maqueta completa

const pad = (n: number) => String(n).padStart(2, '0');

const updatePanel = () => {
    const i = active;
    if (EDIT_MODE || i < 0 || !story.points[i]) {
        panel.hidden = true;
        return;
    }
    const p = story.points[i];
    panelKicker.textContent = p.kicker;
    panelKicker.hidden = !p.kicker;
    panelTitle.textContent = p.title;
    panelText.textContent = p.text;
    panelText.hidden = !p.text;
    panelCount.textContent = `${pad(i + 1)} / ${pad(story.points.length)}`;
    panel.hidden = false;
    panel.scrollTop = 0;
};

const updateStops = () => {
    stopsEl.querySelectorAll<HTMLElement>('.stop').forEach((el) => {
        el.classList.toggle('on', Number(el.dataset.index) === active);
    });
};

const goTo = (i: number) => {
    active = i;
    updateStops();
    updatePanel();
    flyTo(i < 0 ? getOverview() : getPointOrbit(i), i < 0 ? 2.4 : 2.8);
    if (EDIT_MODE) syncEditorToActive();
};

const step = (delta: number) => {
    const n = story.points.length;
    if (!n) return;
    goTo(active < 0 ? (delta > 0 ? 0 : n - 1) : (active + delta + n) % n);
};

const makeStop = (index: number, num: string, name: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stop';
    b.dataset.index = String(index);
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = num;
    const t = document.createElement('span');
    t.className = 'name';
    t.textContent = name;
    b.append(n, t);
    b.addEventListener('click', () => goTo(index));
    return b;
};

const renderStops = () => {
    stopsEl.replaceChildren(makeStop(-1, '◎', 'Plaza'));
    story.points.forEach((p, i) => stopsEl.append(makeStop(i, String(i + 1), p.title)));
    updateStops();
};

const renderBrand = () => {
    brandKicker.textContent = story.place.kicker;
    brandTitle.textContent = story.place.title;
    document.title = `${story.place.title} · Cuenca`;
};

prevBtn.addEventListener('click', () => step(-1));
nextBtn.addEventListener('click', () => step(1));

window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    interrupt();
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Escape') goTo(-1);
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= story.points.length) goTo(Number(e.key) - 1);
});

// Botón «Ver en AR» solo si el dispositivo lo soporta.
if (navigator.xr?.isSessionSupported) {
    navigator.xr
        .isSessionSupported('immersive-ar')
        .then((ok) => {
            arLink.hidden = !ok;
        })
        .catch(() => {
            arLink.hidden = true;
        });
}

// ---------------------------------------------------------------------------
// Modo edición
// ---------------------------------------------------------------------------
let editIndex = -1;

const edSelect = $<HTMLSelectElement>('ed-select');
const edKicker = $<HTMLInputElement>('ed-kicker');
const edTitle = $<HTMLInputElement>('ed-title');
const edText = $<HTMLTextAreaElement>('ed-text');
const edStatus = $<HTMLElement>('ed-status');
const edExport = $<HTMLTextAreaElement>('ed-export');

const setStatus = (msg: string) => {
    edStatus.textContent = msg;
};

const renderEditorSelect = () => {
    edSelect.replaceChildren();
    const first = document.createElement('option');
    first.value = '-1';
    first.textContent = 'Plaza completa (vista inicial)';
    edSelect.append(first);
    story.points.forEach((p, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${i + 1}. ${p.title}`;
        edSelect.append(o);
    });
    edSelect.value = String(editIndex);
};

const fillEditorFields = () => {
    const plaza = editIndex < 0;
    const p = plaza ? null : story.points[editIndex];
    edKicker.disabled = plaza;
    edTitle.disabled = plaza;
    edText.disabled = plaza;
    edKicker.value = p?.kicker ?? '';
    edTitle.value = p?.title ?? '';
    edText.value = p?.text ?? '';
};

function syncEditorToActive() {
    editIndex = active;
    edSelect.value = String(editIndex);
    fillEditorFields();
}

const setupEditor = () => {
    document.body.classList.add('edit');
    editor.hidden = false;
    renderEditorSelect();
    fillEditorFields();

    $<HTMLButtonElement>('ed-toggle').addEventListener('click', () => editor.classList.toggle('collapsed'));

    edSelect.addEventListener('change', () => goTo(Number(edSelect.value)));

    const onFieldInput = () => {
        const p = story.points[editIndex];
        if (!p) return;
        p.kicker = edKicker.value;
        p.title = edTitle.value;
        p.text = edText.value;
        persist();
        renderStops();
        const option = edSelect.options[editIndex + 1];
        if (option) option.textContent = `${editIndex + 1}. ${p.title}`;
    };
    edKicker.addEventListener('input', onFieldInput);
    edTitle.addEventListener('input', onFieldInput);
    edText.addEventListener('input', onFieldInput);

    $<HTMLButtonElement>('ed-capture').addEventListener('click', () => {
        const pose = roundPose(poseFromOrbit(getOrbit()));
        if (editIndex < 0) {
            story.overview = pose;
            setStatus('Pose de la plaza completa guardada.');
        } else {
            story.points[editIndex].pose = pose;
            setStatus(`Pose del punto ${editIndex + 1} guardada.`);
        }
        persist();
    });

    $<HTMLButtonElement>('ed-go').addEventListener('click', () => goTo(editIndex));

    $<HTMLButtonElement>('ed-copy').addEventListener('click', async () => {
        const json = JSON.stringify(story, null, 2);
        try {
            await navigator.clipboard.writeText(json);
            edExport.hidden = true;
            setStatus('Datos copiados. Pégalos en el chat.');
        } catch {
            edExport.hidden = false;
            edExport.value = json;
            edExport.focus();
            edExport.select();
            setStatus('Copia el texto de abajo.');
        }
    });

    $<HTMLButtonElement>('ed-reset').addEventListener('click', () => {
        try {
            localStorage.removeItem(EDIT_KEY);
        } catch {
            // ignorado
        }
        story = defaultStory();
        editIndex = -1;
        renderBrand();
        renderStops();
        renderEditorSelect();
        fillEditorFields();
        goTo(-1);
        setStatus('Cambios descartados: vuelve a los datos publicados.');
    });
};

// ---------------------------------------------------------------------------
// Carga de la escena
// ---------------------------------------------------------------------------
renderBrand();
renderStops();
if (EDIT_MODE) setupEditor();

setOrbit({ tx: 0, ty: 0, tz: 0, yaw, pitch, distance, fov });
applyOrbit();

const asset = new Asset('plaza', 'gsplat', { url: SCENE_URL, filename: SCENE_URL });

asset.on('progress', (received: number, length: number) => {
    if (length > 0) {
        const p = clamp(received / length, 0, 1);
        loaderMessage.textContent = `Cargando la plaza… ${Math.floor(p * 100)}%`;
        loaderFill.style.transform = `scaleX(${p})`;
    }
});

asset.on('error', (err: unknown) => {
    console.error(err);
    loaderMessage.textContent = 'No se pudo cargar la escena.';
});

asset.on('load', () => {
    const splat = new Entity('plaza');
    splat.setLocalEulerAngles(0, 0, 180);
    splat.addComponent('gsplat', { asset });
    app.root.addChild(splat);

    const aabb = (asset.resource as unknown as { aabb?: BoundingBox } | null)?.aabb;
    if (aabb) {
        splat.getWorldTransform().transformPoint(aabb.center, sceneCenter);
        sceneRadius = Math.max(aabb.halfExtents.length(), 0.5);
    }

    loader.dataset.hidden = 'true';

    if (story.intro && !SKIP_INTRO && !EDIT_MODE) {
        playIntro();
    } else {
        setOrbit(getOverview());
        applyOrbit();
    }
});

app.assets.add(asset);
app.assets.load(asset);
