// ---------------------------------------------------------------------------
// AR desde cero.
//
// Solo lo que pide el ejemplo oficial de 8th Wall para PlayCanvas
// (github.com/8thwall/web/blob/master/gettingstarted/playcanvas/scripts/xrcontroller.js):
//   XR8.XrController.configure(...) + XR8.PlayCanvas.run({pcCamera, pcApp}, [XR8.XrController.pipelineModule()], {canvas})
// con una aplicación estándar de PlayCanvas y la maqueta (scene.sog) que se coloca tocando la pantalla.
// Nada del código de ar.html: ni escala calculada, ni grabador, ni detección propia de superficies.
// Paso 2: el cubo del paso 1 se cambió por el Gaussian. Con instrucciones por fase y un círculo que marca dónde se
// coloca (hitTest de 8th Wall en el centro de la pantalla). Sin reveal ni pellizco.
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
camera.addComponent('camera', { nearClip: 0.01, farClip: 100 });
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
    if (phase === 'loading') setPhase('scan');
});
app.assets.add(asset);
app.assets.load(asset);

app.start();

// botón «Enviar resultado» (modelo, navegador, GPU, fps, seguimiento) para las pruebas en otros teléfonos
const report = createReport(canvas);

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
const target = new pc.Vec3();
let lastHitType = '';
let hitFrames = 0;
let missFrames = 0;
let pulse = 0;
app.on('update', (dt: number) => {
    if (phase !== 'scan' && phase !== 'ready') return;
    const XR = xr8();
    if (!XR) return;
    let hits: Hit[] = [];
    try {
        hits = XR.XrController.hitTest(0.5, 0.5, TYPES);
    } catch {
        hits = [];
    }
    if (hits.length) {
        missFrames = 0;
        hitFrames++;
        const h = hits[0];
        lastHitType = h.type;
        target.set(h.position.x, h.position.y, h.position.z);
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

$('start-btn').addEventListener('click', async () => {
    $('start').hidden = true;
    status.hidden = false;
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
});
