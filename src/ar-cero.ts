// ---------------------------------------------------------------------------
// Realidad aumentada (página nueva, hecha desde cero).
//
// Dos formas de seguir al teléfono, elegidas solas, sin que la persona configure nada:
//   - «nativo»: ARCore a través de WebXR (Chrome en Android que lo soporte). Seguimiento nativo, preciso.
//   - «web»: 8th Wall, con su integración oficial para PlayCanvas
//     (github.com/8thwall/web/blob/master/gettingstarted/playcanvas/scripts/xrcontroller.js):
//     XR8.XrController.configure(...) + XR8.PlayCanvas.run({pcCamera, pcApp}, [XR8.XrController.pipelineModule()], {canvas})
//     para iPhone, Instagram, WhatsApp, Huawei, Samsung Internet, etc.
//   Si el nativo no arranca (p. ej. la persona cancela un aviso para instalar algo), se pasa solo al web y el teléfono
//   lo recuerda para la próxima vez.
//
// Flujo: inicio → cámara → círculo sobre la superficie (hit test en el centro de la pantalla) → tocar coloca la
// maqueta (scene.sog) con el Radial Reveal → pellizco para el tamaño. Textos en español e inglés.
// ---------------------------------------------------------------------------
import * as pc from 'playcanvas';

import { AR_CERO } from './ar-cero-text';
import { LANG_KEY, detectLang } from './i18n';
import type { Lang } from './i18n';
import { REVEAL, startReveal } from './reveal';

type Hit = { type: string; position: { x: number; y: number; z: number } };
type Module = {
    name: string;
    onException?: (e: unknown) => void;
    onDeviceIncompatible?: () => void;
    onCameraStatusChange?: (e: { status: string }) => void;
    listeners?: { event: string; process: (e: { detail: { status?: string; reason?: string } }) => void }[];
};
type XR8 = {
    XrController: {
        configure: (o: Record<string, unknown>) => void;
        pipelineModule: () => unknown;
        hitTest: (x: number, y: number, types?: string[]) => Hit[];
    };
    PlayCanvas: { run: (scene: { pcCamera: pc.Entity; pcApp: pc.AppBase }, modules: unknown[], config: { canvas: HTMLCanvasElement }) => void };
};
const xr8 = () => (window as unknown as { XR8?: XR8 }).XR8;

// la integración de 8th Wall con PlayCanvas usa el objeto global `pc` (en el editor de PlayCanvas ya existe)
(window as unknown as { pc: typeof pc }).pc = pc;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('application-canvas') as HTMLCanvasElement;
const ui = $('ui');
const hint = $('hint');
const again = $('again');
const status = $('status');
const DEBUG = new URLSearchParams(location.search).has('debug');

// ---- escena: aplicación estándar de PlayCanvas
const app = new pc.Application(canvas, {
    mouse: new pc.Mouse(canvas),
    touch: new pc.TouchDevice(canvas)
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());

// La altura inicial de la cámara fija la escala de 8th Wall (escala relativa): con 1,5 una unidad equivale más o
// menos a un metro. En el modo nativo las unidades ya son metros.
const camera = new pc.Entity('camera');
camera.addComponent('camera', { nearClip: 0.01, farClip: 100, clearColor: new pc.Color(0, 0, 0, 0) });
camera.setPosition(0, 1.5, 0);
app.root.addChild(camera);

// ---- la maqueta: el mismo scene.sog del visor. Con la rotación de 180° del visor, el centro de la plaza (a ras de
// su suelo) está en PLAZA_CENTER; se lleva al punto tocado. El 95 % de los splats está a menos de 93,5 del centro:
// ese diámetro (187) es el «tamaño» de la maqueta.
const PLAZA_CENTER = new pc.Vec3(15.8, 23, 4.6);
const SCENE_DIAMETER = 187;
/** Tamaño al colocarla: 1 m (en el modo nativo las unidades son metros; en el web, aproximadamente). */
const SIZE_M = 1;
const anchor = new pc.Entity('anchor'); // posición y giro; su escala es el pellizco
const model = new pc.Entity('model');
model.setLocalEulerAngles(0, 0, 180);
anchor.addChild(model);
anchor.enabled = false;
app.root.addChild(anchor);
let modelScale = 1 / SCENE_DIAMETER;
const setSize = (diameter: number) => {
    modelScale = diameter / SCENE_DIAMETER;
    model.setLocalScale(modelScale, modelScale, modelScale);
    model.setLocalPosition(-modelScale * PLAZA_CENTER.x, -modelScale * PLAZA_CENTER.y, -modelScale * PLAZA_CENTER.z);
};

// fases: start → loading (cámara o maqueta cargando) → scan (buscando superficie) → ready (círculo: tocar coloca)
// → placed; error en cualquier momento
type Phase = 'start' | 'loading' | 'scan' | 'ready' | 'placed' | 'error';
let phase: Phase = 'start';
let cameraOn = false;
let modelReady = false;
let errorText = '';
let lang: Lang = detectLang();
const t = () => AR_CERO[lang];

const asset = new pc.Asset('scene.sog', 'gsplat', { url: './scene.sog', filename: 'scene.sog' });
asset.once('load', () => {
    model.addComponent('gsplat', { asset });
    modelReady = true;
    if (phase === 'loading' && cameraOn) setPhase('scan');
});
app.assets.add(asset);
app.assets.load(asset);

app.start();


// modo de seguimiento y último resultado del hit test nativo (WebXR)
let mode: 'nativo' | 'web' | '' = '';
let xrHit: pc.Vec3 | null = null;
let xrHitAt = 0;

// ---- cuadros por segundo y línea de estado (solo con ?debug)
let tracking = '—';
let fps = 0;
app.on('update', (dt: number) => {
    if (dt > 0) fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
});
if (DEBUG) setInterval(() => (status.textContent = `${mode || '—'} · ${tracking} · ${fps.toFixed(0)} fps`), 500);

// ---- textos de la página según el idioma y la fase
const render = () => {
    const u = t();
    document.documentElement.lang = lang;
    document.title = `San Sebastián · ${u.kicker}`;
    $('back').textContent = u.back;
    $('kicker').textContent = u.kicker;
    $('intro').textContent = u.intro;
    $('steps').innerHTML = u.steps.map((s) => `<li>${s}</li>`).join('');
    $('install-note').innerHTML = u.installNote;
    $('start-btn').textContent = u.start;
    again.textContent = u.again;
    document.querySelectorAll<HTMLElement>('#lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));

    $('start').hidden = phase !== 'start';
    $('top').hidden = phase !== 'start' && phase !== 'error';
    $('logo-ar').hidden = !$('top').hidden;
    again.hidden = phase !== 'placed';
    status.hidden = !DEBUG || phase === 'start';
    const msg: Partial<Record<Phase, string>> = {
        loading: `<b>${cameraOn ? u.loadingModel : u.openingCamera}</b>`,
        scan: `<b>${u.scan}</b><br>${u.scanTip}`,
        ready: `<b>${u.ready}</b><br>${u.readyTip}`,
        placed: `<b>${u.placed}</b> ${u.placedTip}`,
        error: `<b>${u.errTitle}</b><br>${errorText}`
    };
    hint.innerHTML = msg[phase] ?? '';
    hint.hidden = !msg[phase];
};
const setPhase = (p: Phase) => {
    phase = p;
    render();
};
const fail = (text: string) => {
    errorText = text;
    setPhase('error');
};
document.querySelectorAll<HTMLButtonElement>('#lang button').forEach((b) =>
    b.addEventListener('click', () => {
        lang = b.dataset.lang as Lang;
        try {
            localStorage.setItem(LANG_KEY, lang);
        } catch {
            // sin almacenamiento
        }
        render();
    })
);
render();

// ---- círculo que indica dónde va a quedar la maqueta: sigue la superficie que hay en el centro de la pantalla
const reticle = new pc.Entity('reticle');
const ringMat = new pc.StandardMaterial();
ringMat.useLighting = false;
ringMat.emissive = new pc.Color(1, 1, 1);
ringMat.diffuse = new pc.Color(0, 0, 0);
ringMat.opacity = 0.9;
ringMat.blendType = pc.BLEND_NORMAL;
ringMat.update();
const ring = new pc.Entity('ring');
ring.addComponent('render', { type: 'torus', material: ringMat });
ring.setLocalScale(1, 0.02, 1);
reticle.addChild(ring);
const dotMat = ringMat.clone();
dotMat.emissive = new pc.Color(0.15, 0.85, 0.45);
dotMat.update();
const dot = new pc.Entity('dot');
dot.addComponent('render', { type: 'cylinder', material: dotMat });
dot.setLocalScale(0.25, 0.005, 0.25);
reticle.addChild(dot);
reticle.enabled = false;
app.root.addChild(reticle);

const TYPES = ['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT'];
const target = new pc.Vec3();
let hitFrames = 0;
let missFrames = 0;
let pulse = 0;
app.on('update', (dt: number) => {
    if (phase !== 'scan' && phase !== 'ready') return;
    let hit: { pos: { x: number; y: number; z: number }; type: string } | null = null;
    if (mode === 'nativo') {
        // el resultado de hit test de WebXR llega por evento en cada cuadro; vale si es reciente
        if (xrHit && performance.now() - xrHitAt < 200) hit = { pos: xrHit, type: 'nativo' };
    } else {
        const XR = xr8();
        if (!XR) return;
        try {
            const hits = XR.XrController.hitTest(0.5, 0.5, TYPES);
            if (hits.length) hit = { pos: hits[0].position, type: hits[0].type };
        } catch {
            hit = null;
        }
    }
    if (hit) {
        missFrames = 0;
        hitFrames++;
        target.set(hit.pos.x, hit.pos.y, hit.pos.z);
        if (!reticle.enabled) reticle.setPosition(target);
        else reticle.setPosition(new pc.Vec3().lerp(reticle.getPosition(), target, 0.35));
        // tamaño del círculo: proporcional a la distancia, como la maqueta
        const d = reticle.getPosition().distance(camera.getPosition());
        pulse += dt * 3;
        const k = Math.max(0.1, d * 0.12) * (1 + Math.sin(pulse) * 0.06);
        reticle.setLocalScale(k, k, k);
        reticle.enabled = true;
        if (phase === 'scan' && hitFrames > 5) setPhase('ready');
    } else {
        hitFrames = 0;
        if (++missFrames > 20) {
            reticle.enabled = false;
            if (phase === 'ready') setPhase('scan');
        }
    }
});

// ---- pellizco con dos dedos: tamaño de la maqueta (de ¼ a 4 veces)
let pinchFactor = 1;
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: { dist: number; factor: number } | null = null;
const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
};
ui.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinchStart = { dist: Math.max(1, pinchDist()), factor: pinchFactor };
});
ui.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (phase !== 'placed' || pointers.size !== 2 || !pinchStart) return;
    pinchFactor = Math.min(4, Math.max(0.25, pinchStart.factor * (pinchDist() / pinchStart.dist)));
    anchor.setLocalScale(pinchFactor, pinchFactor, pinchFactor);
});
const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
};
ui.addEventListener('pointerup', endPointer);
ui.addEventListener('pointercancel', endPointer);

// ---- tocar para colocar la maqueta donde está el círculo, con el Radial Reveal del visor
let stopReveal: (() => void) | null = null;
const place = () => {
    if (phase !== 'ready' || !modelReady || !reticle.enabled) return;
    const p = reticle.getPosition().clone();
    // tamaño fijo de 1 m; el pellizco lo ajusta
    setSize(SIZE_M);
    pinchFactor = 1;
    anchor.setLocalScale(1, 1, 1);
    anchor.setPosition(p);
    // de frente a quien la coloca
    const f = camera.forward;
    anchor.setEulerAngles(0, (Math.atan2(f.x, f.z) * 180) / Math.PI, 0);
    reticle.enabled = false;
    stopReveal?.();
    stopReveal = startReveal(app, { center: [p.x, p.y, p.z], scale: modelScale, ...REVEAL }, () => (stopReveal = null));
    anchor.enabled = true;
    setPhase('placed');
};
// toque en la pantalla (modo web) y «select» de WebXR (modo nativo: la pantalla la toma el navegador)
ui.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    place();
});
app.xr?.input.on('select', place);
again.addEventListener('click', () => {
    stopReveal?.();
    stopReveal = null;
    anchor.enabled = false;
    hitFrames = 0;
    setPhase('scan');
});
// en AR nativa, tocar los botones no debe colocar la maqueta
for (const el of [again, $('top')]) el.addEventListener('beforexrselect', (e) => e.preventDefault());

// ---- arranque
const waitXr8 = () =>
    new Promise<XR8>((resolve) => {
        const x = xr8();
        if (x) resolve(x);
        else window.addEventListener('xrloaded', () => resolve(xr8() as XR8), { once: true });
    });

// ¿hay seguimiento nativo? (se pregunta en silencio al cargar; no muestra nada a la persona)
const NATIVE_FAILED_KEY = 'ar-nativo-fallo';
const nativeFailedBefore = (() => {
    try {
        return localStorage.getItem(NATIVE_FAILED_KEY) === '1';
    } catch {
        return false;
    }
})();
let nativeSupported = false;
let nativeCheck: Promise<unknown> = Promise.resolve();
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const xrApi = (navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }).xr;
if (!isIOS && !nativeFailedBefore && xrApi && app.xr) {
    nativeCheck = xrApi
        .isSessionSupported('immersive-ar')
        .then((ok) => {
            nativeSupported = ok;
            if (ok) $('install-note').hidden = false;
        })
        .catch(() => (nativeSupported = false));
}

// iPhone: el permiso de movimiento debe pedirse desde el toque en «Comenzar»
const requestMotionPermission = async () => {
    for (const ev of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
        const req = (ev as unknown as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission;
        if (typeof req === 'function') {
            try {
                if ((await req.call(ev)) !== 'granted') return false;
            } catch {
                return false;
            }
        }
    }
    return true;
};

// modo web: 8th Wall, como en el ejemplo oficial
const startWeb = async (why = '') => {
    mode = 'web';
    if (why) console.warn('[AR] el modo nativo no arrancó:', why);
    setPhase('loading');
    const XR = await waitXr8();
    const errors: Module = {
        name: 'ar-cero',
        onException: () => fail(t().errGeneric),
        onDeviceIncompatible: () => fail(t().errDevice),
        onCameraStatusChange: (e) => {
            if (e.status === 'failed') fail(t().errCamera);
            if (e.status === 'hasVideo') {
                cameraOn = true;
                setPhase(modelReady ? 'scan' : 'loading');
            }
        },
        listeners: [
            {
                event: 'reality.trackingstatus',
                process: (e) => {
                    tracking = `${e.detail.status ?? '?'}${e.detail.reason ? ' / ' + e.detail.reason : ''}`;
                }
            }
        ]
    };
    XR.XrController.configure({ disableWorldTracking: false });
    XR.PlayCanvas.run({ pcCamera: camera, pcApp: app }, [XR.XrController.pipelineModule(), errors], { canvas });
};

// modo nativo: ARCore a través de WebXR
const startNative = () => {
    mode = 'nativo';
    const xr = app.xr!;
    xr.domOverlay.root = ui; // instrucciones y botones encima de la cámara
    const fallback = (why: string) => {
        try {
            localStorage.setItem(NATIVE_FAILED_KEY, '1');
        } catch {
            // sin almacenamiento: se volverá a intentar la próxima vez
        }
        void startWeb(why);
    };
    xr.once('start', () => {
        cameraOn = true;
        tracking = 'nativo';
        setPhase(modelReady ? 'scan' : 'loading');
        xr.hitTest.start({
            spaceType: pc.XRSPACE_VIEWER,
            entityTypes: [pc.XRTRACKABLE_PLANE, pc.XRTRACKABLE_POINT],
            callback: (err, source) => {
                if (err || !source) return;
                source.on('result', (position: pc.Vec3) => {
                    xrHit = (xrHit ?? new pc.Vec3()).copy(position);
                    xrHitAt = performance.now();
                });
            }
        });
    });
    xr.once('end', () => {
        // la persona salió de la AR (botón atrás): vuelve a la pantalla de inicio
        stopReveal?.();
        stopReveal = null;
        anchor.enabled = false;
        reticle.enabled = false;
        cameraOn = false;
        setPhase('start');
    });
    camera.camera!.startXr(pc.XRTYPE_AR, pc.XRSPACE_LOCALFLOOR, {
        optionalFeatures: ['hit-test', 'dom-overlay'],
        callback: (err) => {
            if (err) fallback(err.message || String(err));
        }
    });
};

$('start-btn').addEventListener('click', async () => {
    setPhase('loading');
    // si la consulta silenciosa aún no terminó, se espera un instante (sigue contando como el toque de la persona);
    // en iPhone no se espera nada: el permiso de movimiento debe pedirse en el mismo toque
    if (!isIOS) await Promise.race([nativeCheck, new Promise((r) => setTimeout(r, 1500))]);
    if (nativeSupported) {
        startNative();
        return;
    }
    if (!(await requestMotionPermission())) {
        fail(t().errMotion);
        return;
    }
    void startWeb();
});
