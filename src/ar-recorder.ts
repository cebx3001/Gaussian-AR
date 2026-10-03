// ---------------------------------------------------------------------------
// AR Tracking Recorder — diagnóstico TEMPORAL del seguimiento (solo con `ar.html?rec`).
//
// No corrige nada: registra, cuadro a cuadro, cada eslabón de la cadena
//   8th Wall (reality) → cámara de PlayCanvas → anchorRoot → retícula → proyección en pantalla
// para poder distinguir, contra una grabación de pantalla, qué componente se mueve cuando se ve el salto:
//   A) 8th Wall cambia/salta la pose de cámara           → columnas r_* (y track_status/reason)
//   B) la pose de 8th Wall es estable pero PlayCanvas no → d_pos_m / d_ang_deg (PlayCanvas vs reality)
//   C) la cámara es estable pero cambia el ancla        → anchor_*
//   D) los datos son estables pero lo visual se mueve   → anchor_scr_* + vídeo (proyección, fov/aspect)
//
// Fuentes (verificadas en el motor, no supuestas):
//   - processCpuResult.reality: position, rotation, intrinsics, trackingStatus, trackingReason, worldPoints
//     (worldPoints = [{id, confidence, position}], vacío mientras trackingReason = INITIALIZING)
//   - frameStartResult.videoTime: tiempo del cuadro de cámara (s)
//   - evento 'reality.trackingstatus' → {status, reason}
// Cada fila es un cuadro DIBUJADO por PlayCanvas (evento 'frameend'), con los datos del último cuadro del
// motor y su antigüedad. Aparte se guardan todos los cuadros del motor, los eventos y muestras de worldPoints.
//
// PRUEBA DE CONTROL (protocolo «control-v1»): además de lo anterior, esta versión registra
//   E) las matrices de vista/proyección que usa realmente la cámara (vm*, pm*, vm_err, pm_err) y su coherencia
//      con el transform del nodo; cuándo se escribe la pose respecto al render (upd_to_pre_dpos, pre_to_end_dpos)
//   F) el transform mundial de `model` (el GSplat) y de un OBJETO DE CONTROL (malla simple colgada del MISMO
//      anchorRoot): ctrl_*, model_*; la proyección del control y una lectura de píxel real (ctrl_px_*)
//   G) los world points: puntos dibujados sobre la imagen (PTS), un punto «pinchado» en coordenadas del mundo
//      (PIN: pin_*) y su estabilidad por id a lo largo del tiempo (wp_stability en el JSON)
// Y botones GS / CTRL / PTS / PIN para ver cada cosa por separado durante UNA sesión.
// ---------------------------------------------------------------------------
import { Mat4, Quat, Vec3 } from 'playcanvas';
import type { AppBase, CameraComponent, Entity } from 'playcanvas';

type V3 = [number, number, number];
type Q4 = [number, number, number, number];

type Reality = {
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    intrinsics?: number[];
    trackingStatus?: string;
    trackingReason?: string;
    worldPoints?: { id: number; confidence: number; position: { x: number; y: number; z: number } }[];
};

type EngineFrame = {
    i: number;
    t_ms: number;
    epoch_ms: number;
    video_time_s: number | null;
    track_status: string;
    track_reason: string;
    r_pos: V3 | null;
    r_rot: Q4 | null;
    fov_deg: number | null;
    aspect: number | null;
    wp_count: number;
    wp_mean_conf: number | null;
    /** Profundidad y altura (medianas) de los puntos del mapa a <4° del eje de la cámara: dónde está de verdad lo que hay en el centro de la pantalla. */
    wp_c_n: number;
    wp_c_depth: number | null;
    wp_c_y: number | null;
};

type RenderRow = Record<string, string | number | boolean | null>;

export type RecorderDeps = {
    app: AppBase;
    camera: Entity;
    anchorRoot: Entity;
    reticle: Entity;
    /** El GSplat (entidad `model`, hija de anchorRoot) y el objeto de control (hijo del mismo anchorRoot; null si no existe). */
    model: Entity;
    control: Entity | null;
    /** Posición de la cámara de PlayCanvas justo antes de `runXr` (la que 8th Wall toma como origen). */
    cameraStart: () => V3 | null;
    phase: () => string;
    /** Origen del plano de la retícula y respuesta cruda de hitTest (antes de colocar). */
    placementInfo: () => { source: string | null; planeY: number | null; hits: { type: string; position: { x: number; y: number; z: number } }[] };
};

/** Altura (en el espacio local del objeto de control, de diámetro 1) del cubo magenta de su cima: el que se busca en los píxeles. */
export const CONTROL_TOP_Y = 0.535;

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v3 = (p: { x: number; y: number; z: number }): V3 => [r4(p.x), r4(p.y), r4(p.z)];
const q4 = (q: { x: number; y: number; z: number; w: number }): Q4 => [r4(q.x), r4(q.y), r4(q.z), r4(q.w)];
const epochNow = () => performance.timeOrigin + performance.now();
const clock = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
/** Euler (grados) solo para leer en pantalla; el registro guarda cuaterniones. */
const eulerOf = (q: Q4 | null) => {
    if (!q) return '—';
    const e = new Quat(q[0], q[1], q[2], q[3]).getEulerAngles();
    return `${e.x.toFixed(1)}, ${e.y.toFixed(1)}, ${e.z.toFixed(1)}`;
};
const fmt = (v: V3 | null) => (v ? v.map((n) => (n >= 0 ? '+' : '') + n.toFixed(3)).join(', ') : '—');
const angleDeg = (a: Q4, b: Q4) => {
    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
};

export const createRecorder = (deps: RecorderDeps) => {
    const { app, camera, anchorRoot, reticle, model, control, phase, placementInfo } = deps;
    let startEpoch = 0;
    let recording = false;
    let engineIndex = -1;
    let lastEngine: EngineFrame | null = null;
    let lastStatus = '—';
    let lastReason = '—';
    let placement: Record<string, unknown> | null = null;
    let markCount = 0;
    let lastMark = '';
    let frameAt = 0;
    let fps = 0;
    const engineFrames: EngineFrame[] = [];
    const rows: RenderRow[] = [];
    const events: Record<string, unknown>[] = [];
    const wpSnapshots: Record<string, unknown>[] = [];
    const MAX_ROWS = 120000;

    // ---- world points: último conjunto completo, estabilidad por id y punto «pinchado»
    type WP = { id: number; confidence: number; position: { x: number; y: number; z: number } };
    let allWp: WP[] = [];
    let topWp: WP[] = [];
    const wpFirst = new Map<number, V3>(); // posición de cada id la primera vez que se vio
    const wpAtPlace = new Map<number, V3>(); // posición de cada id en el momento de colocar
    let wpPrevIds = new Set<number>();
    let lastStabMs = -1e9;
    const wpStability: Record<string, unknown>[] = [];
    const quantile = (a: number[], q: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : null);
    const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const updateStability = (wp: WP[], tMs: number, engineI: number) => {
        const ids = new Set<number>();
        const dFirst: number[] = [];
        const dPlace: number[] = [];
        for (const p of wp) {
            ids.add(p.id);
            const cur: V3 = [p.position.x, p.position.y, p.position.z];
            const f0 = wpFirst.get(p.id);
            if (f0) dFirst.push(dist3(f0, cur));
            else wpFirst.set(p.id, cur);
            const f1 = wpAtPlace.get(p.id);
            if (f1) dPlace.push(dist3(f1, cur));
        }
        if (tMs - lastStabMs >= 1000) {
            lastStabMs = tMs;
            let nNew = 0;
            let nLost = 0;
            ids.forEach((id) => !wpPrevIds.has(id) && nNew++);
            wpPrevIds.forEach((id) => !ids.has(id) && nLost++);
            const m = (a: number[], q: number) => {
                const v = quantile(a, q);
                return v === null ? null : r4(v);
            };
            wpStability.push({
                t_ms: tMs,
                engine_i: engineI,
                n_points: wp.length,
                new_ids: nNew,
                lost_ids: nLost,
                n_vs_first: dFirst.length,
                disp_first_med: m(dFirst, 0.5),
                disp_first_p95: m(dFirst, 0.95),
                disp_first_max: m(dFirst, 1),
                n_vs_place: dPlace.length,
                disp_place_med: m(dPlace, 0.5),
                disp_place_p95: m(dPlace, 0.95),
                disp_place_max: m(dPlace, 1)
            });
            wpPrevIds = ids;
        }
    };
    let pin: { id: number; pos: V3; conf: number } | null = null;
    let ptsOn = true;
    const PTS_MAX = 80;
    const pinPoint = () => {
        const cp = camera.getPosition();
        const fwd = camera.forward;
        const cosMin = Math.cos((10 * Math.PI) / 180);
        let best: WP | null = null;
        for (const p of allWp) {
            const dx = p.position.x - cp.x, dy = p.position.y - cp.y, dz = p.position.z - cp.z;
            const d = Math.hypot(dx, dy, dz);
            if (d < 0.3 || d > 8) continue;
            if ((dx * fwd.x + dy * fwd.y + dz * fwd.z) / d < cosMin) continue;
            if (!best || p.confidence > best.confidence) best = p;
        }
        if (!best) {
            addEvent('PIN: sin world points a <10° del centro', { n_points: allWp.length });
            return false;
        }
        pin = { id: best.id, pos: v3(best.position), conf: r4(best.confidence) };
        addEvent('PIN', { ...pin, camera: v3(cp) });
        return true;
    };

    const t = () => Math.round((epochNow() - startEpoch) * 10) / 10;
    const addEvent = (kind: string, detail: unknown = null) => {
        if (!recording) return;
        events.push({ t_ms: t(), epoch_ms: Math.round(epochNow()), clock: clock(epochNow()), kind, detail, phase: phase() });
    };

    // ---- datos del motor (módulo de la tubería de cámara de 8th Wall)
    const module = {
        name: 'san-sebastian-recorder',
        onUpdate: (e: { frameStartResult?: { videoTime?: number }; processCpuResult?: { reality?: unknown } }) => {
            if (!recording) return;
            const r = e.processCpuResult?.reality as Reality | undefined;
            if (!r) return;
            const o = r.intrinsics;
            const wp = r.worldPoints ?? [];
            // puntos del mapa en el centro de la pantalla (eje −Z de la cámara de 8th Wall)
            let wpC: { d: number; y: number }[] = [];
            if (r.position && r.rotation && wp.length) {
                const fwd = new Quat(r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w).transformVector(new Vec3(0, 0, -1));
                const c = r.position;
                wpC = wp
                    .map((p) => {
                        const dx = p.position.x - c.x, dy = p.position.y - c.y, dz = p.position.z - c.z;
                        const d = Math.hypot(dx, dy, dz);
                        const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (d || 1);
                        return { d, y: p.position.y, cos };
                    })
                    .filter((p) => p.cos > Math.cos((4 * Math.PI) / 180))
                    .map(({ d, y }) => ({ d, y }));
            }
            const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
            const f: EngineFrame = {
                i: ++engineIndex,
                t_ms: t(),
                epoch_ms: Math.round(epochNow()),
                video_time_s: e.frameStartResult?.videoTime ?? null,
                track_status: r.trackingStatus ?? '?',
                track_reason: r.trackingReason ?? '?',
                r_pos: r.position ? v3(r.position) : null,
                r_rot: r.rotation ? q4(r.rotation) : null,
                fov_deg: o ? r4((2 * Math.atan(1 / o[5]) * 180) / Math.PI) : null,
                aspect: o ? r4(o[5] / o[0]) : null,
                wp_count: wp.length,
                wp_mean_conf: wp.length ? r4(wp.reduce((s, p) => s + p.confidence, 0) / wp.length) : null,
                wp_c_n: wpC.length,
                wp_c_depth: wpC.length ? r4(med(wpC.map((p) => p.d)) as number) : null,
                wp_c_y: wpC.length ? r4(med(wpC.map((p) => p.y)) as number) : null
            };
            lastEngine = f;
            allWp = wp;
            topWp = wp.length > PTS_MAX ? [...wp].sort((a, b) => b.confidence - a.confidence).slice(0, PTS_MAX) : wp;
            updateStability(wp, f.t_ms, f.i);
            lastStatus = f.track_status;
            lastReason = f.track_reason;
            if (engineFrames.length < MAX_ROWS) engineFrames.push(f);
            // muestra de puntos del mundo cada 10 cuadros del motor: los 60 de mayor confianza (id + posición),
            // para ver si el mapa del motor se desplaza (el mismo id cambiando de posición)
            if (engineIndex % 10 === 0 && wp.length) {
                const top = [...wp].sort((a, b) => b.confidence - a.confidence).slice(0, 60);
                wpSnapshots.push({ engine_i: f.i, t_ms: f.t_ms, points: top.map((p) => [p.id, r4(p.confidence), ...v3(p.position)]) });
            }
        },
        listeners: [
            {
                event: 'reality.trackingstatus',
                process: (e: { detail: unknown }) => addEvent('reality.trackingstatus', e.detail)
            }
        ]
    };

    // ---- cuándo se escribe la pose respecto al render: este oyente de 'update' se registra ANTES de que 8th Wall
    // conecte el suyo (runXr), así que ve la pose del cuadro anterior; 'prerender' la ve ya escrita para este cuadro
    const updPos = new Vec3();
    const prePos = new Vec3();
    let updToPre: number | null = null;
    let frameDtMs: number | null = null;
    app.on('update', (dt: number) => {
        updPos.copy(camera.getPosition());
        frameDtMs = Math.round(dt * 1e4) / 10;
    });
    app.on('prerender', () => {
        prePos.copy(camera.getPosition());
        updToPre = r4(prePos.distance(updPos));
    });

    const invWorld = new Mat4();
    const matErr = (a: ArrayLike<number>, b: ArrayLike<number>) => {
        let m = 0;
        for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
        return m;
    };
    /** Lee un parche de píxeles del framebuffer por defecto alrededor de (sx, sy) en px CSS y cuenta los magenta (el cubo de control). */
    const probeMagenta = (sx: number, sy: number): { n: number; rgb: string } | null => {
        try {
            const dev = app.graphicsDevice as unknown as { gl: WebGL2RenderingContext; canvas: HTMLCanvasElement };
            const gl = dev.gl;
            const cv = dev.canvas;
            const rect = cv.getBoundingClientRect();
            const k = cv.width / rect.width;
            const R = 4;
            const x = Math.round(sx * k);
            const y = cv.height - Math.round(sy * k);
            if (!isFinite(x) || !isFinite(y) || x < R || y < R || x > cv.width - R - 1 || y > cv.height - R - 1) return null;
            const side = 2 * R + 1;
            const buf = new Uint8Array(side * side * 4);
            const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.readPixels(x - R, y - R, side, side, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
            let n = 0;
            for (let i = 0; i < buf.length; i += 4) if (buf[i] > 170 && buf[i + 2] > 170 && buf[i + 1] < 110) n++;
            const c = (R * side + R) * 4;
            return { n, rgb: `${buf[c]}/${buf[c + 1]}/${buf[c + 2]}` };
        } catch {
            return null;
        }
    };
    const ctrlTop = new Vec3();
    const ctrlTopScr = new Vec3();
    const modelScale = new Vec3();
    const tmp = new Vec3();
    const pinScreen = new Vec3();
    const ptScreen = new Vec3();
    let frameNo = 0;

    // ---- cada cuadro dibujado por PlayCanvas
    const camPos = new Vec3();
    const anchorScreen = new Vec3();
    app.on('frameend', () => {
        if (!recording) return;
        const now = epochNow();
        if (frameAt) {
            const dt = (now - frameAt) / 1000;
            fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
        }
        frameAt = now;
        const cc = camera.camera as CameraComponent;
        camPos.copy(camera.getPosition());
        const cRot = q4(camera.getRotation());
        const cPos = v3(camPos);
        const aPos = v3(anchorRoot.getPosition());
        const aRot = q4(anchorRoot.getRotation());
        const placed = !!placement;
        let scr: [number, number] | null = null;
        if (placed) {
            cc.worldToScreen(anchorRoot.getPosition(), anchorScreen);
            scr = [Math.round(anchorScreen.x * 10) / 10, Math.round(anchorScreen.y * 10) / 10];
        }
        frameNo++;
        const fwd = camera.forward;
        // matrices que la cámara de PlayCanvas usa de verdad (las mismas que leen worldToScreen y el renderer de GSplat)
        const cam = cc.camera;
        const vm = cam.viewMatrix.data;
        const pm = cam.projectionMatrix.data;
        invWorld.copy(camera.getWorldTransform()).invert();
        const vmErr = r4(matErr(vm, invWorld.data));
        const fy = 1 / Math.tan((cc.fov * Math.PI) / 360);
        const pmErr = r4(Math.max(Math.abs(pm[5] - fy), Math.abs(pm[0] - fy / cc.aspectRatio)));
        // GSplat (entidad `model`) y objeto de control, ambos colgados del mismo anchorRoot
        const mp = model.getPosition();
        const mlp = model.getLocalPosition();
        model.getWorldTransform().getScale(modelScale);
        const ctrlOn = !!control && control.enabled;
        let ctrlWp: V3 | null = null;
        let ctrlScr: [number, number] | null = null;
        let ctrlDepth: number | null = null;
        let probe: { n: number; rgb: string } | null = null;
        if (control && ctrlOn) {
            ctrlWp = v3(control.getPosition());
            control.getWorldTransform().transformPoint(tmp.set(0, CONTROL_TOP_Y, 0), ctrlTop);
            cc.worldToScreen(ctrlTop, ctrlTopScr);
            ctrlScr = [Math.round(ctrlTopScr.x * 10) / 10, Math.round(ctrlTopScr.y * 10) / 10];
            ctrlDepth = r4((ctrlTop.x - camPos.x) * fwd.x + (ctrlTop.y - camPos.y) * fwd.y + (ctrlTop.z - camPos.z) * fwd.z);
            // lectura de píxel real (cada 5 cuadros, para no frenar el teléfono): ¿hay magenta donde la proyección dice que está el cubo?
            if (frameNo % 5 === 0 && ctrlDepth > 0.05) probe = probeMagenta(ctrlTopScr.x, ctrlTopScr.y);
        }
        // punto del mundo «pinchado»: posición fija vs posición actual del MISMO id en el mapa del motor
        const pinCurWp = pin ? allWp.find((p) => p.id === pin!.id) : undefined;
        const pinCur: V3 | null = pinCurWp ? v3(pinCurWp.position) : null;
        let pinScr: [number, number] | null = null;
        if (pin) {
            cc.worldToScreen(tmp.set(pin.pos[0], pin.pos[1], pin.pos[2]), pinScreen);
            pinScr = [Math.round(pinScreen.x * 10) / 10, Math.round(pinScreen.y * 10) / 10];
        }
        const e = lastEngine;
        const pinfo = placementInfo();
        const dPos = e?.r_pos ? r4(Math.hypot(cPos[0] - e.r_pos[0], cPos[1] - e.r_pos[1], cPos[2] - e.r_pos[2])) : null;
        const dAng = e?.r_rot ? r4(angleDeg(cRot, e.r_rot)) : null;
        const row: RenderRow = {
            t_ms: t(),
            epoch_ms: Math.round(now),
            clock: clock(now),
            phase: phase(),
            placed,
            engine_i: e?.i ?? null,
            engine_age_ms: e ? Math.round((now - e.epoch_ms) * 10) / 10 : null,
            video_time_s: e?.video_time_s ?? null,
            track_status: e?.track_status ?? null,
            track_reason: e?.track_reason ?? null,
            r_px: e?.r_pos?.[0] ?? null,
            r_py: e?.r_pos?.[1] ?? null,
            r_pz: e?.r_pos?.[2] ?? null,
            r_qx: e?.r_rot?.[0] ?? null,
            r_qy: e?.r_rot?.[1] ?? null,
            r_qz: e?.r_rot?.[2] ?? null,
            r_qw: e?.r_rot?.[3] ?? null,
            r_fov_deg: e?.fov_deg ?? null,
            r_aspect: e?.aspect ?? null,
            pc_px: cPos[0],
            pc_py: cPos[1],
            pc_pz: cPos[2],
            pc_qx: cRot[0],
            pc_qy: cRot[1],
            pc_qz: cRot[2],
            pc_qw: cRot[3],
            pc_fov_deg: r4(cc.fov),
            pc_aspect: r4(app.graphicsDevice.width / app.graphicsDevice.height),
            d_pos_m: dPos,
            d_ang_deg: dAng,
            anchor_px: aPos[0],
            anchor_py: aPos[1],
            anchor_pz: aPos[2],
            anchor_qx: aRot[0],
            anchor_qy: aRot[1],
            anchor_qz: aRot[2],
            anchor_qw: aRot[3],
            anchor_scale: r4(anchorRoot.getLocalScale().x),
            anchor_scr_x: scr?.[0] ?? null,
            anchor_scr_y: scr?.[1] ?? null,
            reticle_on: reticle.enabled,
            reticle_px: reticle.enabled ? r4(reticle.getPosition().x) : null,
            reticle_py: reticle.enabled ? r4(reticle.getPosition().y) : null,
            reticle_pz: reticle.enabled ? r4(reticle.getPosition().z) : null,
            wp_count: e?.wp_count ?? null,
            wp_mean_conf: e?.wp_mean_conf ?? null,
            wp_c_n: e?.wp_c_n ?? null,
            wp_c_depth: e?.wp_c_depth ?? null,
            wp_c_y: e?.wp_c_y ?? null,
            reticle_depth: reticle.enabled ? r4(reticle.getPosition().distance(camera.getPosition())) : null,
            plane_source: pinfo.source,
            plane_y: pinfo.planeY === null ? null : r4(pinfo.planeY),
            hit_n: pinfo.source ? pinfo.hits.length : null,
            hit_types: pinfo.source ? pinfo.hits.map((h) => h.type).join('|') : null,
            hit0_px: pinfo.source && pinfo.hits[0] ? r4(pinfo.hits[0].position.x) : null,
            hit0_py: pinfo.source && pinfo.hits[0] ? r4(pinfo.hits[0].position.y) : null,
            hit0_pz: pinfo.source && pinfo.hits[0] ? r4(pinfo.hits[0].position.z) : null,
            fps: r4(fps),
            frame_dt_ms: frameDtMs,
            upd_to_pre_dpos: updToPre,
            pre_to_end_dpos: r4(camPos.distance(prePos)),
            cam_aspect: r4(cc.aspectRatio),
            cam_aspect_mode: cc.aspectRatioMode,
            cam_hfov: cc.horizontalFov ? 1 : 0,
            cam_near: r4(cc.nearClip),
            cam_far: r4(cc.farClip),
            vm_err: vmErr,
            pm_err: pmErr,
            pm0: r4(pm[0]),
            pm5: r4(pm[5]),
            pm8: r4(pm[8]),
            pm9: r4(pm[9]),
            pm10: r4(pm[10]),
            pm14: r4(pm[14]),
            ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`vm${i}`, Math.round(vm[i] * 1e5) / 1e5])),
            anchor_lpx: r4(anchorRoot.getLocalPosition().x),
            anchor_lpy: r4(anchorRoot.getLocalPosition().y),
            anchor_lpz: r4(anchorRoot.getLocalPosition().z),
            model_on: model.enabled,
            model_gs_on: !!model.gsplat?.enabled,
            model_wpx: r4(mp.x),
            model_wpy: r4(mp.y),
            model_wpz: r4(mp.z),
            model_wscale: r4(modelScale.x),
            model_lpx: r4(mlp.x),
            model_lpy: r4(mlp.y),
            model_lpz: r4(mlp.z),
            model_lscale: r4(model.getLocalScale().x),
            ctrl_on: ctrlOn,
            ctrl_wpx: ctrlWp?.[0] ?? null,
            ctrl_wpy: ctrlWp?.[1] ?? null,
            ctrl_wpz: ctrlWp?.[2] ?? null,
            ctrl_wscale: control && ctrlOn ? r4(control.getLocalScale().x) : null,
            ctrl_top_scr_x: ctrlScr?.[0] ?? null,
            ctrl_top_scr_y: ctrlScr?.[1] ?? null,
            ctrl_depth: ctrlDepth,
            ctrl_px_n: probe?.n ?? null,
            ctrl_px_rgb: probe?.rgb ?? null,
            pts_on: ptsOn,
            pin_id: pin?.id ?? null,
            pin_x: pin?.pos[0] ?? null,
            pin_y: pin?.pos[1] ?? null,
            pin_z: pin?.pos[2] ?? null,
            pin_cur_x: pinCur?.[0] ?? null,
            pin_cur_y: pinCur?.[1] ?? null,
            pin_cur_z: pinCur?.[2] ?? null,
            pin_drift: pin && pinCur ? r4(dist3(pin.pos, pinCur)) : null,
            pin_scr_x: pinScr?.[0] ?? null,
            pin_scr_y: pinScr?.[1] ?? null,
            mark: lastMark
        };
        lastMark = '';
        if (rows.length < MAX_ROWS) rows.push(row);
        renderOverlay(row, cPos, cRot, aPos, aRot);
        drawPoints(cc);
    });

    // ---- overlay en vivo + botones
    const style = document.createElement('style');
    style.textContent = `
#rec-box{position:fixed;left:6px;right:6px;top:calc(max(6px, env(safe-area-inset-top)) + 40px);z-index:50;margin:0;padding:6px 8px;
 font:10px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#e7d8d6;background:rgba(20,19,17,.78);border:1px solid rgba(166,71,62,.7);
 border-radius:8px;pointer-events:none;white-space:pre-wrap;word-break:break-all;overflow:hidden}
#rec-box b{color:#fff}
#rec-placed{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);z-index:51;padding:10px 16px;font:700 15px/1.2 ui-monospace,monospace;
 color:#fff;background:#a6473e;border-radius:10px;pointer-events:none}
#rec-bar{position:fixed;left:6px;right:6px;bottom:calc(max(8px, env(safe-area-inset-bottom)) + 64px);z-index:52;display:flex;gap:6px;justify-content:center}
#rec-bar button{height:40px;padding:0 12px;font:600 13px/1 ui-monospace,monospace;color:#e7d8d6;background:rgba(20,19,17,.85);
 border:1px solid rgba(166,71,62,.8);border-radius:999px}
#rec-bar button.mark{background:#a6473e;color:#fff}
#rec-bar2{position:fixed;left:6px;right:6px;bottom:calc(max(8px, env(safe-area-inset-bottom)) + 112px);z-index:52;display:flex;gap:6px;justify-content:center}
#rec-bar2 button{height:40px;padding:0 12px;font:600 13px/1 ui-monospace,monospace;color:#e7d8d6;background:rgba(20,19,17,.85);
 border:1px solid rgba(80,200,200,.8);border-radius:999px}
#rec-ov{position:fixed;left:0;top:0;width:100%;height:100%;z-index:40;pointer-events:none}`;
    document.head.append(style);
    const box = document.createElement('pre');
    box.id = 'rec-box';
    box.textContent = 'REC — esperando el inicio del seguimiento';
    const banner = document.createElement('div');
    banner.id = 'rec-placed';
    banner.hidden = true;
    const bar = document.createElement('div');
    bar.id = 'rec-bar';
    const mkBtn = (label: string, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (cls) b.className = cls;
        bar.append(b);
        return b;
    };
    const markBtn = mkBtn('MARCA', 'mark');
    const jsonBtn = mkBtn('JSON');
    const csvBtn = mkBtn('CSV');
    const shareBtn = mkBtn('Compartir');
    // segunda fila: qué se ve (para aislar la causa) y el punto del mundo fijado
    const bar2 = document.createElement('div');
    bar2.id = 'rec-bar2';
    const mkBtn2 = (label: string) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        bar2.append(b);
        return b;
    };
    const gsBtn = mkBtn2('GS');
    const ctrlBtn = mkBtn2('CTRL');
    const ptsBtn = mkBtn2('PTS');
    const pinBtn = mkBtn2('PIN');
    const ov = document.createElement('canvas');
    ov.id = 'rec-ov';
    document.body.append(ov, box, banner, bar, bar2);
    const octx = ov.getContext('2d');

    let lastLabels = '';
    const refreshLabels = () => {
        const l = [`GS ${model.enabled ? 'sí' : 'no'}`, control ? `CTRL ${control.enabled ? 'sí' : 'no'}` : 'CTRL —', `PTS ${ptsOn ? 'sí' : 'no'}`, pin ? `PIN #${pin.id}` : 'PIN'];
        const key = l.join('|');
        if (key === lastLabels) return;
        lastLabels = key;
        [gsBtn.textContent, ctrlBtn.textContent, ptsBtn.textContent, pinBtn.textContent] = l;
    };
    gsBtn.addEventListener('click', () => {
        if (phase() !== 'placed') return addEvent('GS: botón ignorado (solo con el reveal ya terminado)', { phase: phase() });
        model.enabled = !model.enabled;
        addEvent(model.enabled ? 'GS visible' : 'GS oculto');
        refreshLabels();
    });
    ctrlBtn.addEventListener('click', () => {
        if (!control) return addEvent('CTRL: no existe');
        if (phase() !== 'placed' && phase() !== 'revealing') return addEvent('CTRL: botón ignorado (aún no colocado)', { phase: phase() });
        control.enabled = !control.enabled;
        addEvent(control.enabled ? 'CTRL visible' : 'CTRL oculto');
        refreshLabels();
    });
    ptsBtn.addEventListener('click', () => {
        ptsOn = !ptsOn;
        addEvent(ptsOn ? 'PTS visibles' : 'PTS ocultos');
        refreshLabels();
    });
    pinBtn.addEventListener('click', () => {
        pinPoint();
        refreshLabels();
    });

    /** Dibuja sobre la imagen (con la MISMA cámara de PlayCanvas) los world points de mayor confianza y el punto fijado. */
    const drawPoints = (cc: CameraComponent) => {
        if (!octx) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) {
            ov.width = Math.round(w * dpr);
            ov.height = Math.round(h * dpr);
        }
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.clearRect(0, 0, w, h);
        const cp = camera.getPosition();
        const fwd = camera.forward;
        const inFront = (x: number, y: number, z: number) => (x - cp.x) * fwd.x + (y - cp.y) * fwd.y + (z - cp.z) * fwd.z > 0.05;
        if (ptsOn) {
            octx.fillStyle = 'rgba(120,255,120,0.9)';
            for (const p of topWp) {
                const { x, y, z } = p.position;
                if (!inFront(x, y, z)) continue;
                cc.worldToScreen(tmp.set(x, y, z), ptScreen);
                if (ptScreen.x < 0 || ptScreen.y < 0 || ptScreen.x > w || ptScreen.y > h) continue;
                octx.beginPath();
                octx.arc(ptScreen.x, ptScreen.y, 2.5, 0, Math.PI * 2);
                octx.fill();
            }
        }
        if (pin) {
            const cur = allWp.find((p) => p.id === pin!.id);
            const mark = (x: number, y: number, z: number, color: string, r: number, label: string) => {
                if (!inFront(x, y, z)) return;
                cc.worldToScreen(tmp.set(x, y, z), ptScreen);
                octx.strokeStyle = color;
                octx.fillStyle = color;
                octx.lineWidth = 2;
                octx.beginPath();
                octx.arc(ptScreen.x, ptScreen.y, r, 0, Math.PI * 2);
                octx.moveTo(ptScreen.x - r - 6, ptScreen.y);
                octx.lineTo(ptScreen.x + r + 6, ptScreen.y);
                octx.moveTo(ptScreen.x, ptScreen.y - r - 6);
                octx.lineTo(ptScreen.x, ptScreen.y + r + 6);
                octx.stroke();
                octx.font = '11px ui-monospace,monospace';
                octx.fillText(label, ptScreen.x + r + 8, ptScreen.y - r);
            };
            mark(pin.pos[0], pin.pos[1], pin.pos[2], '#ff2bd6', 14, `PIN #${pin.id} fijo`);
            if (cur && dist3(pin.pos, [cur.position.x, cur.position.y, cur.position.z]) > 0.005) {
                mark(cur.position.x, cur.position.y, cur.position.z, '#35e0ff', 10, 'mismo id ahora');
            }
        }
    };

    let overlayTick = 0;
    const renderOverlay = (row: RenderRow, cPos: V3, cRot: Q4, aPos: V3, aRot: Q4) => {
        refreshLabels();
        if (overlayTick++ % 3) return; // ~10 veces por segundo: suficiente para la grabación de pantalla
        const e = lastEngine;
        const pl = placement as { t_ms: number; clock: string } | null;
        box.innerHTML =
            `<b>● REC</b> t=${(Number(row.t_ms) / 1000).toFixed(3)} s   reloj ${row.clock}   fps ${fps.toFixed(0)}   filas ${rows.length}\n` +
            `TRACK  ${lastStatus} / ${lastReason}   puntos ${e?.wp_count ?? '—'} (conf ${e?.wp_mean_conf ?? '—'})   motor #${e?.i ?? '—'} hace ${row.engine_age_ms ?? '—'} ms\n` +
            `8W cam p ${fmt(e?.r_pos ?? null)}  r° ${eulerOf(e?.r_rot ?? null)}\n` +
            `PC cam p ${fmt(cPos)}  r° ${eulerOf(cRot)}\n` +
            `Δ PC-8W  ${row.d_pos_m ?? '—'} m   ${row.d_ang_deg ?? '—'}°   fov 8W ${e?.fov_deg ?? '—'} / PC ${row.pc_fov_deg}\n` +
            `ANCLA  p ${fmt(aPos)}  r° ${eulerOf(aRot)}  esc ${row.anchor_scale}\n` +
            `       en pantalla ${row.anchor_scr_x ?? '—'}, ${row.anchor_scr_y ?? '—'} px\n` +
            `RETÍC  ${row.reticle_on ? fmt([Number(row.reticle_px), Number(row.reticle_py), Number(row.reticle_pz)]) : '—'}   fase ${row.phase}\n` +
            `PLANO  ${row.plane_source ?? '—'} y=${row.plane_y ?? '—'}  hit ${row.hit_types || '—'}   prof. retíc ${row.reticle_depth ?? '—'} / mapa ${row.wp_c_depth ?? '—'} (y ${row.wp_c_y ?? '—'})\n` +
            `CTRL ${row.ctrl_on ? 'sí' : 'no'} px ${row.ctrl_px_n ?? '—'}   GS ${row.model_on ? 'sí' : 'no'}   vm_err ${row.vm_err}   PIN ${row.pin_id ?? '—'} deriva ${row.pin_drift ?? '—'}\n` +
            (pl ? `<b>ANCLA COLOCADA en t=${(pl.t_ms / 1000).toFixed(3)} s (${pl.clock})</b>` : 'ancla aún no colocada') +
            (markCount ? `   marcas ${markCount}` : '');
    };

    // ---- exportar
    const stamp = () => new Date(startEpoch || Date.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const meta = () => ({
        recorder: 'AR Tracking Recorder (San Sebastián)',
        protocol: 'control-v1',
        camera_start_before_runXr: deps.cameraStart(),
        started_at: new Date(startEpoch).toISOString(),
        started_epoch_ms: Math.round(startEpoch),
        user_agent: navigator.userAgent,
        screen: { css: [innerWidth, innerHeight], dpr: devicePixelRatio, canvas: [app.graphicsDevice.width, app.graphicsDevice.height] },
        xr8_version: (window as unknown as { XR8?: { version?: () => string } }).XR8?.version?.() ?? null,
        notes: {
            rows: 'una fila por cuadro dibujado por PlayCanvas (frameend), con el último cuadro del motor',
            r_: 'pose de cámara de 8th Wall (processCpuResult.reality), unidades del motor (escala relativa)',
            pc_: 'pose de la entidad cámara de PlayCanvas al terminar el cuadro',
            d_pos_m_d_ang_deg: 'diferencia PlayCanvas vs 8th Wall (último cuadro del motor)',
            anchor_scr: 'proyección del ancla en pantalla (px CSS) con la cámara de PlayCanvas',
            world_points: 'cada 10 cuadros del motor, los 60 puntos de mayor confianza: [id, confidence, x, y, z]',
            control: 'ctrl_* = malla de control (aro, poste y cubos) colgada del MISMO anchorRoot que el GSplat; ctrl_top_scr = proyección de su cubo magenta; ctrl_px_n = píxeles magenta (de 81) leídos en esa posición (0 = el cubo no se ve donde la proyección dice)',
            model: 'model_* = entidad del GSplat: model_on/model_gs_on = visible, model_wp* = posición mundial, model_wscale = escala mundial',
            matrices: 'vm0..vm15 = viewMatrix real de la cámara en frameend; vm_err = máx|viewMatrix − inversa(transform del nodo)|; pm_err = error de la proyección frente a fov+aspect; upd_to_pre_dpos = cuánto se movió la cámara entre update y prerender (pose escrita en el mismo cuadro); pre_to_end_dpos debe ser 0',
            pin: 'pin_x/y/z = world point fijado al pulsar PIN (coordenadas del mundo, fijas); pin_cur_* = posición ACTUAL del mismo id en el mapa del motor; pin_drift = distancia entre ambas (el mapa se movió si crece); pin_scr = su proyección',
            wp_stability: 'en el JSON: cada ~1 s, desplazamiento por id respecto a la primera vez que se vio (disp_first_*) y respecto al momento de colocar (disp_place_*)',
            plane: 'plane_source = de dónde sale el plano del círculo (surface: superficie de hitTest, ground: piso del motor Y=0); hit_* = respuesta cruda de hitTest(0.5,0.5); wp_c_* = puntos del mapa a <4° del centro de la pantalla; reticle_depth vs wp_c_depth compara la profundidad del círculo con la del mapa'
        }
    });
    const toJSON = () =>
        JSON.stringify({ meta: meta(), placement, events, rows, engine_frames: engineFrames, world_points: wpSnapshots, wp_stability: wpStability });
    const toCSV = () => {
        if (!rows.length) return '';
        const cols = Object.keys(rows[0]);
        const esc = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
        return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    };
    const download = (text: string, name: string, type: string) => {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    jsonBtn.addEventListener('click', () => download(toJSON(), `ar-tracking-${stamp()}.json`, 'application/json'));
    csvBtn.addEventListener('click', () => download(toCSV(), `ar-tracking-${stamp()}.csv`, 'text/csv'));
    shareBtn.addEventListener('click', async () => {
        const file = new File([toJSON()], `ar-tracking-${stamp()}.json`, { type: 'application/json' });
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
        if (nav.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'AR tracking log' });
            } catch {
                // cancelado
            }
        } else {
            download(toJSON(), file.name, 'application/json');
        }
    });
    markBtn.addEventListener('click', () => {
        markCount++;
        lastMark = `MARCA ${markCount}`;
        addEvent('marca', { n: markCount });
    });

    // gancho para pruebas automáticas (navegador sin cabeza): exportar sin tocar los botones
    (window as unknown as { __arRecorder?: unknown }).__arRecorder = { toCSV, toJSON, pinPoint };

    return {
        module,
        /** Empieza a registrar (al iniciar el seguimiento). */
        start: () => {
            if (recording) return;
            startEpoch = epochNow();
            recording = true;
            addEvent('inicio del seguimiento');
            addEvent('cámara de PlayCanvas justo antes de runXr', deps.cameraStart());
            refreshLabels();
        },
        /** Momento exacto de la colocación del ancla. */
        markPlacement: (reticlePos: Vec3) => {
            const now = epochNow();
            placement = {
                t_ms: t(),
                epoch_ms: Math.round(now),
                clock: clock(now),
                engine_i: lastEngine?.i ?? null,
                reticle_pos: v3(reticlePos),
                anchor_pos: v3(anchorRoot.getPosition()),
                anchor_rot: q4(anchorRoot.getRotation()),
                camera_pos: v3(camera.getPosition()),
                camera_rot: q4(camera.getRotation()),
                reality_pos: lastEngine?.r_pos ?? null,
                reality_rot: lastEngine?.r_rot ?? null,
                plane: placementInfo(),
                map_center_depth: lastEngine?.wp_c_depth ?? null,
                map_center_y: lastEngine?.wp_c_y ?? null
            };
            wpAtPlace.clear();
            allWp.forEach((p) => wpAtPlace.set(p.id, v3(p.position)));
            (placement as Record<string, unknown>).wp_at_place = allWp.length;
            lastMark = 'COLOCACIÓN';
            addEvent('ancla colocada', placement);
            banner.textContent = `ANCLA COLOCADA  ${clock(now)}`;
            banner.hidden = false;
            setTimeout(() => (banner.hidden = true), 4000);
        },
        addEvent
    };
};

export type Recorder = ReturnType<typeof createRecorder>;
