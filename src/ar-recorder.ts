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
// ---------------------------------------------------------------------------
import { Quat, Vec3 } from 'playcanvas';
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
    phase: () => string;
    /** Origen del plano de la retícula y respuesta cruda de hitTest (antes de colocar). */
    placementInfo: () => { source: string | null; planeY: number | null; hits: { type: string; position: { x: number; y: number; z: number } }[] };
};

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
    const { app, camera, anchorRoot, reticle, phase, placementInfo } = deps;
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
            mark: lastMark
        };
        lastMark = '';
        if (rows.length < MAX_ROWS) rows.push(row);
        renderOverlay(row, cPos, cRot, aPos, aRot);
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
#rec-bar button.mark{background:#a6473e;color:#fff}`;
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
    document.body.append(box, banner, bar);

    let overlayTick = 0;
    const renderOverlay = (row: RenderRow, cPos: V3, cRot: Q4, aPos: V3, aRot: Q4) => {
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
            (pl ? `<b>ANCLA COLOCADA en t=${(pl.t_ms / 1000).toFixed(3)} s (${pl.clock})</b>` : 'ancla aún no colocada') +
            (markCount ? `   marcas ${markCount}` : '');
    };

    // ---- exportar
    const stamp = () => new Date(startEpoch || Date.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const meta = () => ({
        recorder: 'AR Tracking Recorder (San Sebastián)',
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
            plane: 'plane_source = de dónde sale el plano del círculo (surface: superficie de hitTest, ground: piso del motor Y=0); hit_* = respuesta cruda de hitTest(0.5,0.5); wp_c_* = puntos del mapa a <4° del centro de la pantalla; reticle_depth vs wp_c_depth compara la profundidad del círculo con la del mapa'
        }
    });
    const toJSON = () =>
        JSON.stringify({ meta: meta(), placement, events, rows, engine_frames: engineFrames, world_points: wpSnapshots });
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

    return {
        module,
        /** Empieza a registrar (al iniciar el seguimiento). */
        start: () => {
            if (recording) return;
            startEpoch = epochNow();
            recording = true;
            addEvent('inicio del seguimiento');
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
