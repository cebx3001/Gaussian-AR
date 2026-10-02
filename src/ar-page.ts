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
    device.maxPixelRatio = 1; // la maqueta tiene ~360 mil splats: menos píxeles = más cuadros por segundo

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
let hitKind: 'surface' | 'point' | 'estimated' | null = null;
let startCameraY: number | null = null;
const DEBUG = params.has('debug');
/** Segundos sin superficie antes de enseñar el diagnóstico y de ofrecer un plano estimado. */
const DIAG_AFTER = 8;
const FALLBACK_AFTER = 12;
/** Altura típica (m) del teléfono sobre el suelo al sostenerlo de pie: para el plano estimado. */
const HAND_HEIGHT = 1.25;

const TYPE_RANK: Record<string, number> = { DETECTED_SURFACE: 3, ESTIMATED_SURFACE: 2, FEATURE_POINT: 1 };
/** Puntos de la pantalla donde se busca: el centro y la zona de abajo, donde suele estar el piso. */
const PROBES: [number, number][] = [
    [0.5, 0.5],
    [0.5, 0.62],
    [0.5, 0.75],
    [0.35, 0.62],
    [0.65, 0.62]
];

/**
 * Busca una superficie en el centro de la pantalla (y en su zona baja). Se pide al motor todos los tipos de
 * resultado y se elige el mejor: superficie detectada, superficie estimada y, pasados unos segundos, puntos
 * del seguimiento. No se descarta por la orientación de la superficie: la rotación que da el motor para las
 * superficies estimadas no es fiable y filtrarla dejaba sin círculo.
 */
const queryHit = (): Vec3 | null => {
    const xr = window.XR8;
    if (!xr) return null;
    const waited = (performance.now() - scanSince) / 1000;
    let best: { rank: number; type: string; pos: Vec3 } | null = null;
    const seen = new Set<string>();
    for (const [x, y] of PROBES) {
        for (const h of xr.XrController.hitTest(x, y, [])) {
            seen.add(h.type);
            const rank = TYPE_RANK[h.type] ?? 0;
            if (!rank) continue;
            if (rank === 1 && waited < 4) continue; // los puntos sueltos solo como último recurso
            if (h.type === 'DETECTED_SURFACE') {
                // un plano detectado casi vertical es una pared: no vale para colocar sobre él
                quat.set(h.rotation.x, h.rotation.y, h.rotation.z, h.rotation.w);
                quat.transformVector(Vec3.UP, normal);
                if (Math.abs(normal.y) < 0.35) continue;
            }
            if (!best || rank > best.rank) best = { rank, type: h.type, pos: new Vec3(h.position.x, h.position.y, h.position.z) };
        }
        if (best && best.rank >= 2) break;
    }
    lastTypes = seen.size ? [...seen].map((t) => t.replace('_SURFACE', '').replace('_POINT', '-PT')).join(',') : 'ninguno';
    hitKind = best ? (best.rank === 1 ? 'point' : 'surface') : null;
    return best ? best.pos : null;
};

/** Plano estimado: el suelo a una altura de mano por debajo de donde empezó la cámara (último recurso). */
const estimatedFloor = (): Vec3 | null => {
    const f = camera.forward;
    if (startCameraY === null || f.y > -0.25) return null;
    const c = camera.getPosition();
    const t = (startCameraY - HAND_HEIGHT - c.y) / f.y;
    if (t < 0.6 || t > 4) return null;
    hitKind = 'estimated';
    return new Vec3(c.x + f.x * t, c.y + f.y * t, c.z + f.z * t);
};

/** Lo llama el motor en cada cuadro con datos de seguimiento. */
const onEngineFrame = (e: { processCpuResult?: { reality?: unknown } }) => {
    framesSeen++;
    if (!e.processCpuResult?.reality) return;
    realityFrames++;
    engineReady = true;
    if (startCameraY === null) startCameraY = camera.getPosition().y;
    try {
        latestHit = queryHit();
        hitErrors = 0;
    } catch {
        latestHit = null;
        if (++hitErrors > 60) fail('generic', 'hitTest: el motor falla de forma sostenida');
    }
};

/** Punto de una superficie horizontal en el centro de la pantalla, o null. */
const recentHits: Vec3[] = [];
let lastRealHitAt = 0;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

/** Mediana de las últimas superficies encontradas: quita el temblor del círculo. */
const smoothedHit = (hit: Vec3): Vec3 => {
    recentHits.push(hit.clone());
    if (recentHits.length > 7) recentHits.shift();
    return new Vec3(median(recentHits.map((p) => p.x)), median(recentHits.map((p) => p.y)), median(recentHits.map((p) => p.z)));
};

const findSurface = (): { position: Vec3 } | null => {
    if (DEMO) return { position: target.set(0, 0, -1.4) };
    if (!engineReady) return null;
    if (latestHit) {
        lastRealHitAt = performance.now();
        return { position: smoothedHit(latestHit) };
    }
    // un instante sin resultado no hace saltar el círculo: se conserva el último unos segundos
    if (recentHits.length && performance.now() - lastRealHitAt < 1500) return { position: recentHits[recentHits.length - 1] };
    // sin superficie después de un buen rato: se ofrece un plano estimado para poder colocar la maqueta
    if ((performance.now() - scanSince) / 1000 > FALLBACK_AFTER) {
        const p = estimatedFloor();
        if (p) return { position: p };
    }
    return null;
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
        else reticle.setPosition(new Vec3().lerp(reticle.getPosition(), hit.position, 0.22));
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
    stopReveal?.();
    stopReveal = null;
    model.enabled = false;
    pinchFactor = 1;
    anchorRoot.setLocalScale(1, 1, 1);
    recentHits.length = 0;
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
        // Escala RELATIVA (la predeterminada del motor): fija durante toda la sesión, así lo colocado se queda
        // quieto. La escala «absoluta» (metros) se reestima mientras uno camina y, cuando el motor corrige su
        // cálculo, todo su sistema de coordenadas se reajusta de golpe: la maqueta parecía caminar y saltar.
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
