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
/** Tamaño del modelo en la realidad (m) y de la maqueta en unidades de la escena (~135). */
const MODEL_METERS = 1;
const SCENE_DIAMETER = 135;
const SCALE = MODEL_METERS / SCENE_DIAMETER;
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

// ---------------------------------------------------------------------------
// Idioma y estados de la interfaz
// ---------------------------------------------------------------------------
type Phase = 'start' | 'starting' | 'scanning' | 'ready' | 'revealing' | 'placed' | 'error';
type ErrorKind = 'notMobile' | 'camera' | 'device' | 'generic';

let lang: Lang = detectLang();
let phase: Phase = 'start';
let errorKind: ErrorKind = 'generic';
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
    }
    langEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    document.title = `San Sebastián · ${u.startKicker}`;
};

const setPhase = (p: Phase) => {
    phase = p;
    render();
};

const fail = (kind: ErrorKind) => {
    errorKind = kind;
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
    model.setLocalScale(SCALE, SCALE, SCALE);
    // el centro de la plaza (en coordenadas del visor) queda justo en el ancla
    model.setLocalPosition(-SCALE * PLAZA_CENTER.x, -SCALE * PLAZA_CENTER.y, -SCALE * PLAZA_CENTER.z);
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

/** Punto de una superficie horizontal en el centro de la pantalla, o null. */
const findSurface = (): { position: Vec3 } | null => {
    if (DEMO) return { position: target.set(0, 0, -1.4) };
    const xr = window.XR8;
    if (!xr) return null;
    const hits = xr.XrController.hitTest(0.5, 0.5, ['ESTIMATED_SURFACE', 'DETECTED_SURFACE']);
    for (const h of hits) {
        if (h.type !== 'ESTIMATED_SURFACE' && h.type !== 'DETECTED_SURFACE') continue;
        // solo superficies planas y horizontales (piso, mesa): su normal apunta hacia arriba
        quat.set(h.rotation.x, h.rotation.y, h.rotation.z, h.rotation.w);
        quat.transformVector(Vec3.UP, normal);
        if (normal.y < 0.7) continue;
        return { position: target.set(h.position.x, h.position.y, h.position.z) };
    }
    return null;
};

const onUpdate = (dt: number) => {
    if (phase !== 'scanning' && phase !== 'ready') return;

    const hit = findSurface();
    if (hit) {
        lostFrames = 0;
        foundFrames++;
        // el círculo sigue a la superficie con un poco de suavizado
        if (!reticle.enabled) reticle.setPosition(hit.position);
        else reticle.setPosition(new Vec3().lerp(reticle.getPosition(), hit.position, 0.35));
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
    // el modelo se orienta con la mirada de quien lo coloca
    const f = camera.forward;
    const yaw = (Math.atan2(f.x, f.z) * 180) / Math.PI;
    anchorRoot.setPosition(base);
    anchorRoot.setEulerAngles(0, yaw, 0);
    reticle.enabled = false;
    setPhase('revealing');

    // Radial Reveal: el efecto se aplica antes de mostrar la maqueta, así nace de la oscuridad
    stopReveal = startReveal(app, { center: [base.x, base.y, base.z], scale: SCALE, ...REVEAL }, () => {
        stopReveal = null;
        if (phase === 'revealing') setPhase('placed');
    });
    model.enabled = true;
};

const again = () => {
    stopReveal?.();
    stopReveal = null;
    model.enabled = false;
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
        fail('camera');
        return;
    }
    try {
        const xr = await waitForEngine();
        if (xr.loadChunk) await xr.loadChunk('slam');
        // escala en metros reales: sin esto, «1 metro» del modelo sería una unidad arbitraria del motor
        xr.XrController.configure({ scale: 'absolute' });
        const modules: Xr8Module[] = [
            {
                name: 'san-sebastian-ar',
                onException: () => fail('generic'),
                onDeviceIncompatible: () => fail('device'),
                onCameraStatusChange: (e) => {
                    if (e.status === 'failed') fail('camera');
                }
            }
        ];
        xr.PlayCanvas.runXr({ pcCamera: camera.camera, pcApp: app }, modules, {
            canvas,
            allowedDevices: xr.XrConfig.device().MOBILE
        });
        foundFrames = 0;
        lostFrames = 0;
        setPhase('scanning');
    } catch {
        fail('generic');
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
