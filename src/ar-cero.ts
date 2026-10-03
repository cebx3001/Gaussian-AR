// ---------------------------------------------------------------------------
// AR desde cero.
//
// Solo lo que pide el ejemplo oficial de 8th Wall para PlayCanvas
// (github.com/8thwall/web/blob/master/gettingstarted/playcanvas/scripts/xrcontroller.js):
//   XR8.XrController.configure(...) + XR8.PlayCanvas.run({pcCamera, pcApp}, [XR8.XrController.pipelineModule()], {canvas})
// con una aplicación estándar de PlayCanvas y la maqueta (scene.sog) que se coloca tocando la pantalla.
// Nada del código de ar.html: ni escala calculada, ni grabador, ni detección propia de superficies.
// Paso 2: el cubo del paso 1 se cambió por el Gaussian. Con instrucciones por fase y un círculo que marca dónde se
// coloca. Sin reveal ni pellizco.
// Paso 3: dos formas de seguir al teléfono, elegidas solas, sin que la persona configure nada:
//   - «nativo»: ARCore a través de WebXR (Chrome en Android que lo soporte). Seguimiento nativo, mucho más preciso.
//   - «web»: 8th Wall (iPhone, Instagram, WhatsApp, Huawei, Samsung Internet, etc.).
//   Si el nativo falla al arrancar (por ejemplo la persona cancela un aviso para instalar algo), se pasa solo al web
//   y el teléfono lo recuerda para la próxima vez.
// ---------------------------------------------------------------------------
import * as pc from 'playcanvas';

import { createReport } from './ar-report';

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
const hint = $('hint');
const status = $('status');

// ---- escena: aplicación estándar de PlayCanvas
const app = new pc.Application(canvas, {
    mouse: new pc.Mouse(canvas),
    touch: new pc.TouchDevice(canvas)
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());

// La altura inicial de la cámara fija la escala (escala relativa de 8th Wall): con 1,5 una unidad equivale más o
// menos a un metro si el teléfono está a esa altura del piso.
const camera = new pc.Entity('camera');
camera.addComponent('camera', { nearClip: 0.01, farClip: 100, clearColor: new pc.Color(0, 0, 0, 0) });
camera.setPosition(0, 1.5, 0);
app.root.addChild(camera);

// ---- la maqueta: el mismo scene.sog del visor. Con la rotación de 180° del visor, el centro de la plaza (a ras de
// su suelo) está en PLAZA_CENTER; se lleva al punto tocado. La escena mide unos 135 de diámetro.
const PLAZA_CENTER = new pc.Vec3(15.8, 23, 4.6);
const SCENE_DIAMETER = 135;
const anchor = new pc.Entity('anchor');
const model = new pc.Entity('model');
model.setLocalEulerAngles(0, 0, 180);
anchor.addChild(model);
anchor.enabled = false;
app.root.addChild(anchor);
const setSize = (diameter: number) => {
    const s = diameter / SCENE_DIAMETER;
    model.setLocalScale(s, s, s);
    model.setLocalPosition(-s * PLAZA_CENTER.x, -s * PLAZA_CENTER.y, -s * PLAZA_CENTER.z);
};
let modelReady = false;
// fases: start (pantalla de inicio) → loading (cámara o maqueta cargando) → scan (buscando superficie) →
// ready (círculo sobre una superficie: tocar coloca) → placed
type Phase = 'start' | 'loading' | 'scan' | 'ready' | 'placed';
let phase: Phase = 'start';
let cameraOn = false;
// eslint-disable-next-line prefer-const
let setPhase: (p: Phase) => void = () => {};
const asset = new pc.Asset('scene.sog', 'gsplat', { url: './scene.sog', filename: 'scene.sog' });
asset.once('load', () => {
    model.addComponent('gsplat', { asset });
    modelReady = true;
    if (phase === 'loading' && cameraOn) setPhase('scan');
});
app.assets.add(asset);
app.assets.load(asset);

app.start();

// botón «Enviar resultado» (modelo, navegador, GPU, fps, seguimiento) para las pruebas en otros teléfonos
const ui = $('ui');
const report = createReport(canvas, ui);

// ---- estado en pantalla: seguimiento y cuadros por segundo
let tracking = '—';
let fps = 0;
app.on('update', (dt: number) => {
    if (dt > 0) fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
    report.frame();
});
setInterval(() => {
    status.textContent = `${tracking} · ${fps.toFixed(0)} fps`;
}, 500);

// ---- círculo que indica dónde va a quedar la maqueta: sigue lo que 8th Wall tiene en el centro de la pantalla
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
// modo de seguimiento y último resultado del hit test nativo (WebXR)
let mode: 'nativo' | 'web' | '' = '';
let xrHit: pc.Vec3 | null = null;
let xrHitAt = 0;
const target = new pc.Vec3();
let lastHitType = '';
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
        lastHitType = hit.type;
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

// ---- textos de cada fase
const again = $('again');
setPhase = (p: Phase) => {
    phase = p;
    hint.hidden = p === 'start';
    again.hidden = p !== 'placed';
    if (p === 'loading') hint.innerHTML = cameraOn ? '<b>Cargando la maqueta…</b>' : '<b>Abriendo la cámara…</b>';
    if (p === 'scan')
        hint.innerHTML =
            '<b>Apunta a una mesa o al piso</b><br>Mueve el teléfono despacio de lado a lado hasta que aparezca un círculo.';
    if (p === 'ready') hint.innerHTML = '<b>Toca la pantalla</b><br>La maqueta aparecerá donde está el círculo.';
    if (p === 'placed')
        hint.innerHTML =
            '<b>¡Listo!</b> Camina alrededor y agáchate para verla.<br>Luego toca <b>Enviar resultado</b> (arriba a la derecha).';
};

// ---- tocar para colocar la maqueta donde está el círculo
const place = () => {
    if (phase !== 'ready' || !modelReady || !reticle.enabled) return;
    const p = reticle.getPosition().clone();
    // tamaño: 0,8 veces la distancia a la que se coloca (escala relativa: así siempre cabe a la vista)
    setSize(Math.min(4, Math.max(0.3, p.distance(camera.getPosition()) * 0.8)));
    anchor.setPosition(p);
    // de frente a quien la coloca
    const f = camera.forward;
    anchor.setEulerAngles(0, (Math.atan2(f.x, f.z) * 180) / Math.PI, 0);
    anchor.enabled = true;
    reticle.enabled = false;
    report.placed(lastHitType || '?');
    setPhase('placed');
};
canvas.addEventListener('click', place);
// en AR nativa la pantalla la toma el navegador: el toque llega como «select» de WebXR
app.xr?.input.on('select', place);
for (const el of [again]) el.addEventListener('beforexrselect', (e) => e.preventDefault());
again.addEventListener('click', () => {
    anchor.enabled = false;
    hitFrames = 0;
    setPhase('scan');
});

// ---- arranque de 8th Wall, como en el ejemplo oficial
const waitXr8 = () =>
    new Promise<XR8>((resolve) => {
        const x = xr8();
        if (x) resolve(x);
        else window.addEventListener('xrloaded', () => resolve(xr8() as XR8), { once: true });
    });

const fail = (msg: string) => {
    hint.hidden = false;
    hint.innerHTML = `<b>No se pudo iniciar</b><br>${msg}`;
};

// ---- ¿hay seguimiento nativo? (se pregunta en silencio al cargar; no muestra nada a la persona)
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

// ---- modo web: 8th Wall, como en el ejemplo oficial
const startWeb = async (why = '') => {
    mode = 'web';
    report.setMode(why ? `web (el nativo no arrancó: ${why})` : 'web');
    setPhase('loading');
    const XR = await waitXr8();
    const errors: Module = {
        name: 'ar-cero',
        onException: (e) => fail(String((e as Error)?.message ?? e)),
        onDeviceIncompatible: () => fail('Este teléfono o navegador no es compatible. Prueba abrir el enlace en Chrome (Android) o Safari (iPhone).'),
        onCameraStatusChange: (e) => {
            if (e.status === 'failed') fail('No se pudo abrir la cámara. Revisa que hayas dado permiso a la cámara.');
            if (e.status === 'hasVideo') {
                cameraOn = true;
                report.start();
                setPhase(modelReady ? 'scan' : 'loading');
            }
        },
        listeners: [
            {
                event: 'reality.trackingstatus',
                process: (e) => {
                    tracking = `${e.detail.status ?? '?'}${e.detail.reason ? ' / ' + e.detail.reason : ''}`;
                    report.tracking(e.detail.status ?? '?', e.detail.reason);
                }
            }
        ]
    };
    XR.XrController.configure({ disableWorldTracking: false });
    XR.PlayCanvas.run({ pcCamera: camera, pcApp: app }, [XR.XrController.pipelineModule(), errors], { canvas });
};

// ---- modo nativo: ARCore a través de WebXR
const startNative = () => {
    mode = 'nativo';
    report.setMode('nativo');
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
        report.start();
        report.tracking('NORMAL');
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
        anchor.enabled = false;
        reticle.enabled = false;
        status.hidden = true;
        setPhase('start');
        $('start').hidden = false;
    });
    camera.camera!.startXr(pc.XRTYPE_AR, pc.XRSPACE_LOCALFLOOR, {
        optionalFeatures: ['hit-test', 'dom-overlay'],
        callback: (err) => {
            if (err) fallback(err.message || String(err));
        }
    });
};

$('start-btn').addEventListener('click', async () => {
    $('start').hidden = true;
    status.hidden = false;
    setPhase('loading');
    // si la consulta silenciosa aún no terminó, se espera un instante (sigue contando como el toque de la persona)
    await Promise.race([nativeCheck, new Promise((r) => setTimeout(r, 1500))]);
    if (nativeSupported) {
        startNative();
        return;
    }
    if (!(await requestMotionPermission())) {
        fail('Hace falta permitir el acceso al movimiento del teléfono. Recarga la página, toca Comenzar y luego Permitir.');
        return;
    }
    void startWeb();
});
