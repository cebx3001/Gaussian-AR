// ---------------------------------------------------------------------------
// Realidad aumentada de la plaza de San Sebastián (solo teléfonos).
//
// Motor de seguimiento: 8th Wall (binario con SLAM), que funciona en iPhone (Safari) y Android
// (Chrome) sin ARCore ni WebXR. Render: PlayCanvas, con el mismo splat del visor.
//
//   Comenzar → permisos (cámara y movimiento) → «apunta a una superficie plana»
//   → aparece un círculo sobre la superficie → se toca → la maqueta (~1 m) se expande con el
//   Radial Reveal de PlayCanvas, igual que en la entrada del visor.
//
// `?demo` salta la cámara y las superficies (para probar la maqueta y el efecto en una computadora).
// ---------------------------------------------------------------------------
import './ar.css';

import {
    AppBase,
    AppOptions,
    Asset,
    BLEND_NORMAL,
    BinaryHandler,
    CameraComponentSystem,
    Color,
    ContainerHandler,
    Entity,
    FILLMODE_FILL_WINDOW,
    GSplatComponentSystem,
    GSplatHandler,
    Mesh,
    MeshInstance,
    Quat,
    RESOLUTION_AUTO,
    RenderComponentSystem,
    ScriptComponentSystem,
    StandardMaterial,
    TextureHandler,
    TorusGeometry,
    Vec3,
    createGraphicsDevice
} from 'playcanvas';

import { createRecorder } from './ar-recorder';
import type { Recorder } from './ar-recorder';
import { AR_UI, LANG_KEY, detectLang } from './i18n';
import type { Lang } from './i18n';
import { REVEAL, startReveal } from './reveal';

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

/** Centro de la plaza sobre el suelo, en coordenadas del visor: es el punto que se «clava» en la superficie. */
const PLAZA_CENTER = new Vec3(15.8, 23, 4.6);
/** Diámetro de la maqueta en unidades de la escena (~135). */
const SCENE_DIAMETER = 135;
/**
 * Tamaño al colocarla: una fracción de la distancia a la que se coloca (en unidades del motor). El motor
 * trabaja con una escala relativa (ver `startTracking`), así que un «metro» fijo no sería un metro real; en
 * cambio, una maqueta tan ancha como una parte de la distancia se ve igual de cómoda en un piso a 1,5 m que
 * en una mesa a 0,8 m. Se ajusta después con el pellizco. `?size=1.3` la agranda un 30 % (para probar).
 */
const SIZE_FACTOR = 0.8 * (Number(params.get('size')) || 1);
const MIN_DIAMETER = 0.15;
const MAX_DIAMETER = 8;
/** Límites del pellizco: de un cuarto a cuatro veces el tamaño de partida. */
const MIN_PINCH = 0.25;
const MAX_PINCH = 4;
/** Radio del círculo que marca dónde se colocará la maqueta (m). */
const RING_RADIUS = 0.14;
/** Cuadros seguidos con (o sin) superficie antes de cambiar de estado: evita parpadeos. */
const FOUND_FRAMES = 4;
const LOST_FRAMES = 12;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('application-canvas');
const backLink = $<HTMLAnchorElement>('ar-back');
const langEl = $<HTMLElement>('ar-lang');
const startCard = $<HTMLElement>('ar-start');
const startKicker = $<HTMLElement>('ar-start-kicker');
const startTitle = $<HTMLElement>('ar-start-title');
const startText = $<HTMLElement>('ar-start-text');
const startBtn = $<HTMLButtonElement>('ar-start-btn');
const hint = $<HTMLElement>('ar-hint');
const againBtn = $<HTMLButtonElement>('ar-again');
const errorCard = $<HTMLElement>('ar-error');
const errorTitle = $<HTMLElement>('ar-error-title');
const errorText = $<HTMLElement>('ar-error-text');
const errorDetail = $<HTMLElement>('ar-error-detail');

// ---------------------------------------------------------------------------
// Idioma y estados de la interfaz
// ---------------------------------------------------------------------------
type Phase = 'start' | 'starting' | 'scanning' | 'ready' | 'revealing' | 'placed' | 'error';
type ErrorKind = 'notMobile' | 'camera' | 'device' | 'generic';

let lang: Lang = detectLang();
let phase: Phase = 'start';
let errorKind: ErrorKind = 'generic';
let errorInfo = '';
let sceneReady = false;

const t = () => AR_UI[lang];

const render = () => {
    const u = t();
    document.documentElement.lang = lang;
    backLink.textContent = u.back;
    startKicker.textContent = u.startKicker;
    startTitle.textContent = u.startTitle;
    startText.textContent = u.startText;
    startBtn.textContent = sceneReady ? u.start : u.loadingModel;
    startBtn.disabled = !sceneReady;
    againBtn.textContent = u.again;

    startCard.hidden = phase !== 'start';
    errorCard.hidden = phase !== 'error';
    againBtn.hidden = phase !== 'placed';

    const hintText: Partial<Record<Phase, string>> = {
        starting: u.starting,
        scanning: u.scanning,
        ready: u.ready,
        placed: u.placed
    };
    hint.textContent = hintText[phase] ?? '';
    hint.hidden = !hintText[phase];

    if (phase === 'error') {
        const msg = {
            notMobile: [u.notMobileTitle, u.notMobileText],
            camera: [u.errCamera, ''],
            device: [u.errDevice, ''],
            generic: [u.errGeneric, '']
        }[errorKind];
        errorTitle.textContent = errorKind === 'notMobile' ? msg[0] : u.startKicker;
        errorText.textContent = errorKind === 'notMobile' ? msg[1] : msg[0];
        errorDetail.textContent = errorInfo;
        errorDetail.hidden = !errorInfo;
    }
    langEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    document.title = `San Sebastián · ${u.startKicker}`;
};

const setPhase = (p: Phase) => {
    if (p === 'scanning') scanSince = performance.now();
    phase = p;
    render();
};

/** Muestra el error; `info` es el detalle técnico (qué falló) para poder reportarlo. */
const fail = (kind: ErrorKind, info: unknown = '') => {
    errorKind = kind;
    errorInfo = info instanceof Error ? `${info.name}: ${info.message}` : String(info ?? '').slice(0, 220);
    if (info) console.error('[AR]', info);
    setPhase('error');
};

langEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
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

// ---------------------------------------------------------------------------
// Escena: cámara transparente (sobre el video de la cámara), círculo y maqueta
// ---------------------------------------------------------------------------
const isMobile = window.matchMedia('(pointer: coarse)').matches;

let app: AppBase;
let camera: Entity;
let reticle: Entity;
let anchorRoot: Entity;
let model: Entity;
let stopReveal: (() => void) | null = null;

const buildReticle = (): Entity => {
    const device = app.graphicsDevice;
    const material = (color: Color) => {
        const m = new StandardMaterial();
        m.useLighting = false;
        m.diffuse = new Color(0, 0, 0);
        m.emissive = color;
        m.opacity = 0.95;
        m.blendType = BLEND_NORMAL;
        m.depthWrite = false;
        m.update();
        return m;
    };
    // un aro pequeño y un punto central: aparecen sobre la superficie encontrada
    const ring = Mesh.fromGeometry(device, new TorusGeometry({ ringRadius: RING_RADIUS, tubeRadius: 0.004, segments: 48, sides: 10 }));
    const dot = Mesh.fromGeometry(device, new TorusGeometry({ ringRadius: 0.012, tubeRadius: 0.006, segments: 20, sides: 8 }));
    const e = new Entity('reticle');
    e.addComponent('render', {
        meshInstances: [
            new MeshInstance(ring, material(new Color(0.906, 0.847, 0.839))),
            new MeshInstance(dot, material(new Color(0.84, 0.36, 0.31)))
        ]
    });
    e.enabled = false;
    app.root.addChild(e);
    return e;
};

/** Escala del modelo; su centro (el de la plaza, en coordenadas del visor) queda justo en el ancla. */
const applyModelScale = (s: number) => {
    model.setLocalScale(s, s, s);
    model.setLocalPosition(-s * PLAZA_CENTER.x, -s * PLAZA_CENTER.y, -s * PLAZA_CENTER.z);
};

const initScene = async () => {
    const device = await createGraphicsDevice(canvas, {
        deviceTypes: ['webgl2'],
        antialias: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance'
    });
    device.maxPixelRatio = Math.min(window.devicePixelRatio, 1.5);

    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [GSplatComponentSystem, CameraComponentSystem, ScriptComponentSystem, RenderComponentSystem];
    options.resourceHandlers = [TextureHandler, ContainerHandler, BinaryHandler, GSplatHandler];

    app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());

    camera = new Entity('camera');
    camera.addComponent('camera', {
        clearColor: new Color(0, 0, 0, 0), // transparente: se ve el video de la cámara de 8th Wall
        nearClip: 0.01,
        farClip: 100
    });
    app.root.addChild(camera);

    reticle = buildReticle();

    // la maqueta cuelga de un ancla que se coloca sobre la superficie al tocar
    anchorRoot = new Entity('anchor');
    app.root.addChild(anchorRoot);
    model = new Entity('model');
    model.setLocalEulerAngles(0, 0, 180); // misma orientación que en el visor
    applyModelScale(1 / SCENE_DIAMETER); // provisional; el tamaño real se fija al colocar
    model.enabled = false;
    anchorRoot.addChild(model);

    await new Promise<void>((resolve, reject) => {
        const asset = new Asset('scene.sog', 'gsplat', { url: './scene.sog', filename: 'scene.sog' });
        asset.once('load', () => {
            model.addComponent('gsplat', { asset, unified: true });
            resolve();
        });
        asset.once('error', (err: string) => reject(new Error(String(err))));
        app.assets.add(asset);
        app.assets.load(asset);
    });

    app.start();
    app.on('update', onUpdate);
    if (REC) {
        recorder = createRecorder({
            app,
            camera,
            anchorRoot,
            reticle,
            phase: () => phase,
            // de dónde sale el plano del círculo: superficie del motor (con su altura) o el piso del motor (Y = 0)
            placementInfo: () => ({
                source: phase === 'scanning' || phase === 'ready' ? hitKind : null,
                planeY: hitKind === 'surface' ? floorY : hitKind === 'ground' ? GROUND_Y : null,
                hits: lastHitRaw
            })
        });
        // el panel del grabador va arriba: la instrucción baja para no quedar tapada
        const s = document.createElement('style');
        s.textContent = '#ar-hint{top:auto!important;bottom:calc(max(8px, env(safe-area-inset-bottom)) + 116px)!important}';
        document.head.append(s);
    }
};

// ---------------------------------------------------------------------------
// Búsqueda de superficie y colocación
// ---------------------------------------------------------------------------
let foundFrames = 0;
let lostFrames = 0;
const target = new Vec3();
const normal = new Vec3();
const quat = new Quat();
let pulse = 0;

/**
 * El motor de 8th Wall solo admite consultas de superficie cuando ya procesó cuadros de la cámara: antes
 * de eso `hitTest` se cae por dentro (acceso fuera de memoria). Por eso se consulta únicamente dentro de su
 * propio ciclo (`onUpdate` del módulo) y solo desde el primer cuadro con datos; el resultado queda aquí.
 */
let engineReady = false;
let latestHit: Vec3 | null = null;
let hitErrors = 0;

// diagnóstico (qué ve el motor): se muestra solo si pasan unos segundos sin encontrar superficie, o con ?debug
let framesSeen = 0;
let realityFrames = 0;
let lastTypes = '–';
let scanSince = 0;
let hitKind: 'surface' | 'ground' | null = null;
/** Respuesta cruda de la última consulta de superficie (solo la lee el grabador ?rec). */
let lastHitRaw: { type: string; position: { x: number; y: number; z: number } }[] = [];
const DEBUG = params.has('debug');
/** `?rec`: grabador TEMPORAL de diagnóstico del seguimiento (ver ar-recorder.ts). No cambia el comportamiento. */
const REC = params.has('rec');
let recorder: Recorder | null = null;
/** Segundos sin superficie detectada antes de enseñar el diagnóstico. */
const DIAG_AFTER = 8;
/**
 * El piso en el sistema de coordenadas de 8th Wall: el plano Y = 0. Con la escala relativa la cámara arranca en
 * el origen que fija la integración (Y = 2 por defecto) y el suelo bajo ella queda en Y = 0 (documentación de
 * XrController.configure / xrweb: «the y-position will depend on the camera's physical height from the ground
 * plane»; foro oficial: «your camera's ground plane aligns with Y = 0»). Cualquier otra altura deja la maqueta
 * flotando o hundida respecto al piso real y, al caminar, se desliza por paralaje.
 */
const GROUND_Y = 0;

const TYPE_RANK: Record<string, number> = { DETECTED_SURFACE: 3, ESTIMATED_SURFACE: 2, FEATURE_POINT: 1 };

/**
 * Consulta al motor qué hay en el centro de la pantalla. Se aceptan los tres tipos de resultado, prefiriendo
 * plano detectado > superficie estimada > punto del seguimiento. Los FEATURE_POINT SÍ cuentan: en las pruebas
 * sobre una mesa el motor solo devolvió FEATURE_POINT (200 de 212 cuadros, todos a la altura de la mesa), y
 * descartarlos mandaba el círculo al piso del motor, tres veces más lejos que la mesa real.
 */
const queryHit = (): Vec3 | null => {
    const xr = window.XR8;
    if (!xr) return null;
    let best: { rank: number; pos: Vec3 } | null = null;
    const seen = new Set<string>();
    const raw = xr.XrController.hitTest(0.5, 0.5, []);
    lastHitRaw = raw.map((h) => ({ type: h.type, position: h.position }));
    for (const h of raw) {
        seen.add(h.type);
        const rank = TYPE_RANK[h.type] ?? 0;
        if (!rank) continue;
        if (h.type === 'DETECTED_SURFACE') {
            // un plano detectado casi vertical es una pared: no vale para colocar sobre él
            quat.set(h.rotation.x, h.rotation.y, h.rotation.z, h.rotation.w);
            quat.transformVector(Vec3.UP, normal);
            if (Math.abs(normal.y) < 0.35) continue;
        }
        if (!best || rank > best.rank) best = { rank, pos: new Vec3(h.position.x, h.position.y, h.position.z) };
    }
    lastTypes = seen.size ? [...seen].map((t) => t.replace('_SURFACE', '').replace('_POINT', '-PT')).join(',') : 'ninguno';
    return best ? best.pos : null;
};

// Altura del apoyo: mediana de las últimas lecturas. Los puntos sueltos que caen lejos de esa altura (otro
// objeto, ruido) se ignoran; si siguen llegando muchos seguidos es que se apunta a otra superficie y se adopta.
const floorSamples: number[] = [];
let floorY: number | null = null;
let rejectedInRow = 0;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
const OUTLIER = 0.3; // unidades del motor
let lastSurfaceAt = 0;

const addSurfaceSample = (y: number) => {
    if (floorY !== null && floorSamples.length >= 5 && Math.abs(y - floorY) > OUTLIER) {
        if (++rejectedInRow < 10) return;
        floorSamples.length = 0; // cambio de superficie: se empieza de nuevo
    }
    rejectedInRow = 0;
    floorSamples.push(y);
    if (floorSamples.length > 15) floorSamples.shift();
    floorY = median(floorSamples);
    lastSurfaceAt = performance.now();
};

/** Lo llama el motor en cada cuadro con datos de seguimiento. */
const onEngineFrame = (e: { processCpuResult?: { reality?: unknown } }) => {
    framesSeen++;
    if (!e.processCpuResult?.reality) return;
    realityFrames++;
    engineReady = true;
    // colocada la maqueta, la detección ya no participa en nada: el ancla quedó fijada en el mundo
    if (phase !== 'scanning' && phase !== 'ready') return;
    try {
        latestHit = queryHit();
        hitErrors = 0;
        if (latestHit) addSurfaceSample(latestHit.y);
    } catch {
        latestHit = null;
        if (++hitErrors > 60) fail('generic', 'hitTest: el motor falla de forma sostenida');
    }
};

/**
 * Dónde va el círculo: el punto donde el centro de la pantalla toca el plano de apoyo, en coordenadas del mundo
 * de 8th Wall (las mismas en que la integración coloca la cámara de PlayCanvas). El plano es la superficie que el
 * motor tiene en el centro de la pantalla (altura = mediana de sus lecturas recientes) o, solo si no devolvió
 * nada en 2 s, su piso (Y = 0).
 * Comprobación de profundidad: el círculo nunca queda más lejos que el punto real que el motor devuelve en esa
 * misma dirección; si el plano daría un punto más lejano, se usa la profundidad medida.
 */
const MAX_DEPTH_RATIO = 1.15;
const findSurface = (): { position: Vec3 } | null => {
    if (DEMO) return { position: target.set(0, 0, -1.4) };
    if (!engineReady) return null;
    const onSurface = floorY !== null && performance.now() - lastSurfaceAt < 2000;
    const y = onSurface ? (floorY as number) : GROUND_Y;
    hitKind = onSurface ? 'surface' : 'ground';
    const c = camera.getPosition();
    const f = camera.forward;
    if (f.y > -0.15) return null; // mirando al horizonte: no hay plano al frente
    let t = (y - c.y) / f.y;
    // solo con una lectura coherente con la superficie (no un punto atípico de otro objeto)
    if (latestHit && onSurface && Math.abs(latestHit.y - (floorY as number)) <= OUTLIER) {
        const measured = latestHit.distance(c);
        if (t > measured * MAX_DEPTH_RATIO) t = measured;
    }
    if (t < 0.25 || t > 8) return null;
    return { position: target.set(c.x + f.x * t, c.y + f.y * t, c.z + f.z * t) };
};

const debugEl = $<HTMLElement>('ar-debug');
let debugTick = 0;
let fps = 0;
const updateDebug = () => {
    if (DEMO) return;
    const waited = (performance.now() - scanSince) / 1000;
    const show = DEBUG || ((phase === 'scanning' || phase === 'ready') && !latestHit && waited > DIAG_AFTER);
    debugEl.hidden = !show;
    if (!show) return;
    if (debugEl.textContent && ++debugTick % 15) return; // se refresca cada ~15 cuadros
    const c = camera.getPosition();
    debugEl.textContent =
        `cuadros ${framesSeen} · con datos ${realityFrames} · tipos: ${lastTypes}` +
        ` · hit: ${hitKind ?? 'no'} · cámara y ${c.y.toFixed(2)} m · ${fps.toFixed(0)} fps`;
};

const onUpdate = (dt: number) => {
    if (dt > 0) fps = fps ? fps * 0.92 + (1 / dt) * 0.08 : 1 / dt;
    updateDebug();
    if (phase !== 'scanning' && phase !== 'ready') return;

    const hit = findSurface();
    if (hit) {
        lostFrames = 0;
        foundFrames++;
        // el círculo sigue a la superficie con un poco de suavizado
        if (!reticle.enabled) reticle.setPosition(hit.position);
        else reticle.setPosition(new Vec3().lerp(reticle.getPosition(), hit.position, 0.5));
        pulse += dt * 3;
        const s = 1 + Math.sin(pulse) * 0.025;
        reticle.setLocalScale(s, 1, s);
        reticle.enabled = true;
        if (phase === 'scanning' && foundFrames >= FOUND_FRAMES) setPhase('ready');
    } else {
        foundFrames = 0;
        lostFrames++;
        if (phase === 'ready' && lostFrames >= LOST_FRAMES) {
            reticle.enabled = false;
            setPhase('scanning');
        }
    }
};

const place = () => {
    if (phase !== 'ready') return;
    const base = reticle.getPosition().clone();
    // tamaño: una parte de la distancia a la que se coloca (en unidades del motor)
    const diameter = Math.min(MAX_DIAMETER, Math.max(MIN_DIAMETER, base.distance(camera.getPosition()) * SIZE_FACTOR));
    const scale = diameter / SCENE_DIAMETER;
    applyModelScale(scale);
    pinchFactor = 1;
    anchorRoot.setLocalScale(1, 1, 1);
    // el modelo se orienta con la mirada de quien lo coloca
    const f = camera.forward;
    const yaw = (Math.atan2(f.x, f.z) * 180) / Math.PI;
    anchorRoot.setPosition(base);
    anchorRoot.setEulerAngles(0, yaw, 0);
    recorder?.markPlacement(base);
    reticle.enabled = false;
    setPhase('revealing');

    // Radial Reveal: el efecto se aplica antes de mostrar la maqueta, así nace de la oscuridad
    stopReveal = startReveal(app, { center: [base.x, base.y, base.z], scale, ...REVEAL }, () => {
        stopReveal = null;
        if (phase === 'revealing') setPhase('placed');
    });
    model.enabled = true;
};

const again = () => {
    recorder?.addEvent('colocar de nuevo');
    stopReveal?.();
    stopReveal = null;
    model.enabled = false;
    pinchFactor = 1;
    anchorRoot.setLocalScale(1, 1, 1);
    floorSamples.length = 0;
    floorY = null;
    rejectedInRow = 0;
    foundFrames = 0;
    lostFrames = 0;
    setPhase('scanning');
};

// un toque en cualquier parte (menos en los controles) coloca la maqueta cuando el círculo está visible
window.addEventListener('pointerup', (e) => {
    if (phase !== 'ready') return;
    if ((e.target as HTMLElement).closest('a, button, #ar-lang')) return;
    place();
});
againBtn.addEventListener('click', again);

// Pellizco con dos dedos: cambia el tamaño de la maqueta ya colocada (crece o se encoge desde su centro,
// que es el ancla). Con la maqueta expandiéndose no se permite: el efecto está calculado para su tamaño.
let pinchFactor = 1;
const pinchPointers = new Map<number, { x: number; y: number }>();
let pinchStart: { dist: number; factor: number } | null = null;
const pinchDistance = () => {
    const [a, b] = [...pinchPointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
};
window.addEventListener('pointerdown', (e) => {
    if (phase !== 'placed' || (e.target as HTMLElement).closest('a, button, #ar-lang')) return;
    pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.size === 2) pinchStart = { dist: Math.max(1, pinchDistance()), factor: pinchFactor };
});
window.addEventListener('pointermove', (e) => {
    const p = pinchPointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinchPointers.size !== 2 || !pinchStart) return;
    pinchFactor = Math.min(MAX_PINCH, Math.max(MIN_PINCH, pinchStart.factor * (pinchDistance() / pinchStart.dist)));
    anchorRoot.setLocalScale(pinchFactor, pinchFactor, pinchFactor);
});
const endPinch = (e: PointerEvent) => {
    pinchPointers.delete(e.pointerId);
    if (pinchPointers.size < 2) pinchStart = null;
};
window.addEventListener('pointerup', endPinch);
window.addEventListener('pointercancel', endPinch);

// ---------------------------------------------------------------------------
// Arranque del seguimiento (8th Wall)
// ---------------------------------------------------------------------------
/** Pide los permisos de movimiento que iOS exige (deben pedirse dentro de un toque del usuario). */
const requestMotionPermission = async (): Promise<boolean> => {
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

const waitForEngine = () =>
    new Promise<Xr8Api>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('timeout')), 30000);
        const ok = () => {
            if (!window.XR8) return;
            window.clearTimeout(timer);
            resolve(window.XR8);
        };
        if (window.XR8) ok();
        else window.addEventListener('xrloaded', ok, { once: true });
    });

const startTracking = async () => {
    setPhase('starting');

    if (DEMO) {
        camera.setPosition(0, 1.3, 0);
        camera.lookAt(0, 0.4, -1.4);
        foundFrames = 0;
        setPhase('scanning');
        return;
    }

    if (!(await requestMotionPermission())) {
        fail('camera', 'permiso de movimiento denegado');
        return;
    }
    try {
        const xr = await waitForEngine();
        if (xr.loadChunk) await xr.loadChunk('slam');
        // Configuración del motor, explícita: seguimiento del mundo (SLAM) activo y escala RELATIVA, fija durante
        // toda la sesión. Con la escala «absoluta» el motor reestima los metros mientras uno camina y reajusta su
        // sistema de coordenadas: lo colocado se movería. El piso de este sistema es Y = 0 (ver GROUND_Y).
        // con ?rec se piden también los puntos del mundo del motor (worldPoints), solo para registrarlos
        xr.XrController.configure({ disableWorldTracking: false, scale: 'responsive', enableWorldPoints: REC });
        const modules: Xr8Module[] = [
            {
                name: 'san-sebastian-ar',
                onUpdate: onEngineFrame,
                onException: (err) => fail('generic', err),
                onDeviceIncompatible: (info) => fail('device', info),
                onCameraStatusChange: (e) => {
                    if (e.status === 'failed') fail('camera', 'la cámara no pudo abrirse');
                }
            }
        ];
        if (recorder) modules.push(recorder.module as Xr8Module);
        // La integración de 8th Wall toma la posición inicial de la cámara como referencia espacial.
        // Arrancamos en la altura documentada de 2 m antes de conectar el tracking.
        camera.setPosition(0, 2, 0);
        // la integración con PlayCanvas espera la ENTIDAD de la cámara (llama a getPosition y a camera.nearClip),
        // aunque su documentación diga «componente»
        xr.PlayCanvas.runXr({ pcCamera: camera, pcApp: app }, modules, {
            canvas,
            allowedDevices: xr.XrConfig.device().MOBILE
        });
        engineReady = false;
        latestHit = null;
        foundFrames = 0;
        lostFrames = 0;
        setPhase('scanning');
        recorder?.start();
    } catch (err) {
        fail('generic', err);
    }
};

startBtn.addEventListener('click', () => void startTracking());

// ---------------------------------------------------------------------------
render();
if (!isMobile && !DEMO) {
    // la realidad aumentada es solo para teléfonos
    fail('notMobile');
} else {
    initScene()
        .then(() => {
            sceneReady = true;
            render();
        })
        .catch(() => fail('generic'));
}
