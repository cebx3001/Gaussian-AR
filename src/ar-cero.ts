// ---------------------------------------------------------------------------
// AR desde cero — paso 1.
//
// Solo lo que pide el ejemplo oficial de 8th Wall para PlayCanvas
// (github.com/8thwall/web/blob/master/gettingstarted/playcanvas/scripts/xrcontroller.js):
//   XR8.XrController.configure(...) + XR8.PlayCanvas.run({pcCamera, pcApp}, [XR8.XrController.pipelineModule()], {canvas})
// con una aplicación estándar de PlayCanvas y la maqueta (scene.sog) que se coloca tocando la pantalla.
// Nada del código de ar.html: ni escala calculada, ni grabador, ni detección propia de superficies.
// Paso 2: el cubo del paso 1 se cambió por el Gaussian, sin reveal, pellizco ni nada más.
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
const asset = new pc.Asset('scene.sog', 'gsplat', { url: './scene.sog', filename: 'scene.sog' });
asset.once('load', () => {
    model.addComponent('gsplat', { asset });
    modelReady = true;
    if (hint.dataset.waiting) {
        delete hint.dataset.waiting;
        hint.textContent = 'Mueve el teléfono despacio y toca una superficie plana para colocar la maqueta.';
    }
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

// ---- tocar para colocar: lo que 8th Wall tiene en ese punto de la pantalla; si no devuelve nada, su piso (Y = 0)
const place = (sx: number, sy: number) => {
    const XR = xr8();
    if (!XR || !modelReady) return;
    const x = sx / window.innerWidth;
    const y = sy / window.innerHeight;
    const hits = XR.XrController.hitTest(x, y, ['FEATURE_POINT', 'ESTIMATED_SURFACE', 'DETECTED_SURFACE']);
    let p: pc.Vec3 | null = hits.length ? new pc.Vec3(hits[0].position.x, hits[0].position.y, hits[0].position.z) : null;
    if (!p) {
        const cam = camera.camera as pc.CameraComponent;
        const from = cam.screenToWorld(sx, sy, cam.nearClip);
        const to = cam.screenToWorld(sx, sy, cam.farClip);
        const dir = to.clone().sub(from);
        if (dir.y >= 0) return; // el toque no apunta al piso
        const t = -from.y / dir.y;
        p = from.clone().add(dir.mulScalar(t));
    }
    // tamaño: 0,8 veces la distancia a la que se coloca (escala relativa: así siempre cabe a la vista)
    setSize(Math.min(4, Math.max(0.3, p.distance(camera.getPosition()) * 0.8)));
    anchor.setPosition(p);
    // de frente a quien la coloca
    const f = camera.forward;
    anchor.setEulerAngles(0, (Math.atan2(f.x, f.z) * 180) / Math.PI, 0);
    anchor.enabled = true;
    report.placed(hits.length ? hits[0].type : 'piso Y=0');
    hint.textContent = 'Maqueta colocada. Camina alrededor y agáchate; luego toca «Enviar resultado» arriba a la derecha.';
};

let touchStart: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
    else touchStart = null;
});
canvas.addEventListener('touchend', (e) => {
    const s = touchStart;
    touchStart = null;
    const t = e.changedTouches[0];
    if (!s || !t || performance.now() - s.t > 500 || Math.hypot(t.clientX - s.x, t.clientY - s.y) > 20) return;
    place(t.clientX, t.clientY);
});
canvas.addEventListener('click', (e) => place(e.clientX, e.clientY));

// ---- arranque de 8th Wall, como en el ejemplo oficial
const waitXr8 = () =>
    new Promise<XR8>((resolve) => {
        const x = xr8();
        if (x) resolve(x);
        else window.addEventListener('xrloaded', () => resolve(xr8() as XR8), { once: true });
    });

const fail = (msg: string) => {
    hint.hidden = false;
    hint.textContent = `Error: ${msg}`;
};

$('start-btn').addEventListener('click', async () => {
    $('start').hidden = true;
    hint.hidden = false;
    status.hidden = false;
    hint.textContent = 'Cargando el motor de AR…';
    const XR = await waitXr8();
    const errors: Module = {
        name: 'ar-cero',
        onException: (e) => fail(String((e as Error)?.message ?? e)),
        onDeviceIncompatible: () => fail('dispositivo o navegador no compatible'),
        onCameraStatusChange: (e) => {
            if (e.status === 'failed') fail('no se pudo abrir la cámara');
            if (e.status === 'hasVideo') report.start();
            if (e.status === 'hasVideo') {
                if (modelReady) hint.textContent = 'Mueve el teléfono despacio y toca una superficie plana para colocar la maqueta.';
                else {
                    hint.dataset.waiting = '1';
                    hint.textContent = 'Cargando la maqueta…';
                }
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
