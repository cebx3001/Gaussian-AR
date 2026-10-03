// ---------------------------------------------------------------------------
// AR desde cero — paso 1.
//
// Solo lo que pide el ejemplo oficial de 8th Wall para PlayCanvas
// (github.com/8thwall/web/blob/master/gettingstarted/playcanvas/scripts/xrcontroller.js):
//   XR8.XrController.configure(...) + XR8.PlayCanvas.run({pcCamera, pcApp}, [XR8.XrController.pipelineModule()], {canvas})
// con una aplicación estándar de PlayCanvas, una luz y un cubo que se coloca tocando la pantalla.
// Nada del código de ar.html: ni escala calculada, ni grabador, ni detección propia de superficies.
// Si el cubo se ve fijo, esta es la base; en el paso 2 el cubo se cambia por el Gaussian.
// ---------------------------------------------------------------------------
import * as pc from 'playcanvas';

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

const light = new pc.Entity('light');
light.addComponent('light', { type: 'directional', intensity: 1.2 });
light.setEulerAngles(45, 30, 0);
app.root.addChild(light);
app.scene.ambientLight = new pc.Color(0.45, 0.45, 0.45);

// cubo de 0,3 de lado, con la base en su punto de apoyo
const SIZE = 0.3;
const cube = new pc.Entity('cube');
const box = new pc.Entity('box');
const mat = new pc.StandardMaterial();
mat.diffuse = new pc.Color(0.85, 0.2, 0.2);
mat.update();
box.addComponent('render', { type: 'box', material: mat });
box.setLocalScale(SIZE, SIZE, SIZE);
box.setLocalPosition(0, SIZE / 2, 0);
cube.addChild(box);
cube.enabled = false;
app.root.addChild(cube);

app.start();

// ---- estado en pantalla: seguimiento y cuadros por segundo
let tracking = '—';
let fps = 0;
app.on('update', (dt: number) => {
    if (dt > 0) fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
});
setInterval(() => {
    status.textContent = `${tracking} · ${fps.toFixed(0)} fps`;
}, 500);

// ---- tocar para colocar: lo que 8th Wall tiene en ese punto de la pantalla; si no devuelve nada, su piso (Y = 0)
const place = (sx: number, sy: number) => {
    const XR = xr8();
    if (!XR) return;
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
    cube.setPosition(p);
    cube.enabled = true;
    hint.textContent = `Cubo colocado (${hits.length ? hits[0].type : 'piso Y=0'}). Camina alrededor: ¿se queda fijo? Toca de nuevo para moverlo.`;
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
            if (e.status === 'hasVideo') hint.textContent = 'Mueve el teléfono despacio y toca el piso o una mesa para colocar el cubo.';
        },
        listeners: [{ event: 'reality.trackingstatus', process: (e) => (tracking = `${e.detail.status ?? '?'}${e.detail.reason ? ' / ' + e.detail.reason : ''}`) }]
    };
    XR.XrController.configure({ disableWorldTracking: false });
    XR.PlayCanvas.run({ pcCamera: camera, pcApp: app }, [XR.XrController.pipelineModule(), errors], { canvas });
});
