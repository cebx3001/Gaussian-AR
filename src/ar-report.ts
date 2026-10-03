// ---------------------------------------------------------------------------
// Reporte de prueba para ar-cero.html: junta lo que el teléfono SÍ puede medir (modelo, navegador, GPU, cuadros por
// segundo, pérdidas del seguimiento) y lo manda por WhatsApp (o el menú de compartir) con un toque.
// El teléfono no puede saber si el objeto «se movió» respecto al mundo real (8th Wall cree que su pose es correcta);
// por eso hay un toque opcional «fijo / se movió», que es lo único que necesita el ojo de quien prueba.
// ---------------------------------------------------------------------------
type UAData = { brands?: { brand: string; version: string }[]; getHighEntropyValues?: (h: string[]) => Promise<Record<string, string>> };

export const createReport = (canvas: HTMLCanvasElement) => {
    const t0 = performance.now();
    const secs = (ms: number) => Math.round((ms - t0) / 100) / 10;

    // ---- cuadros por segundo: una muestra por segundo, desde que el seguimiento arranca
    let frames = 0;
    let lastSecond = performance.now();
    const fpsSamples: number[] = [];
    let measuring = false;
    const frame = () => {
        frames++;
        const now = performance.now();
        if (now - lastSecond >= 1000) {
            if (measuring) fpsSamples.push((frames * 1000) / (now - lastSecond));
            frames = 0;
            lastSecond = now;
        }
    };

    // ---- seguimiento: cuándo llegó a NORMAL, cuántas veces y cuánto tiempo estuvo LIMITED
    let firstNormal: number | null = null;
    let limitedCount = 0;
    let limitedSince: number | null = null;
    let limitedTotal = 0;
    let lastStatus = '';
    const tracking = (statusName: string, reason?: string) => {
        const now = performance.now();
        if (statusName === 'NORMAL' && firstNormal === null) firstNormal = now;
        if (statusName === 'LIMITED' && lastStatus !== 'LIMITED') {
            limitedCount++;
            limitedSince = now;
        }
        if (statusName !== 'LIMITED' && limitedSince !== null) {
            limitedTotal += now - limitedSince;
            limitedSince = null;
        }
        lastStatus = statusName + (reason && reason !== 'UNSPECIFIED' ? ` (${reason})` : '');
    };

    // ---- colocación
    let placedAt: number | null = null;
    let placements = 0;
    let placedOn = '';
    const placed = (on: string) => {
        placements++;
        placedAt = performance.now();
        placedOn = on;
        button.hidden = false;
    };

    // ---- datos del teléfono
    const gpu = (() => {
        try {
            const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
            const ext = gl?.getExtension('WEBGL_debug_renderer_info');
            return (ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '') || '?';
        } catch {
            return '?';
        }
    })();
    const device = async () => {
        const ua = navigator.userAgent;
        const uad = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
        let model = '';
        let os = '';
        try {
            const h = await uad?.getHighEntropyValues?.(['model', 'platform', 'platformVersion']);
            if (h) {
                model = h.model || '';
                os = h.platform ? `${h.platform} ${h.platformVersion ?? ''}`.trim() : '';
            }
        } catch {
            // sin datos de alta entropía
        }
        if (!model) model = /iPhone|iPad/.test(ua) ? (ua.match(/(iPhone|iPad)/)?.[1] ?? '') : (ua.match(/Android [^;]+; ([^;)]+)/)?.[1] ?? '?');
        if (!os) os = ua.match(/(Android [\d.]+|OS [\d_]+ like Mac OS X)/)?.[1]?.replace(/_/g, '.') ?? '?';
        const inApp = ua.match(/(Instagram|FBAN|FBAV|WhatsApp|TikTok|Line|Snapchat)/)?.[1];
        const brand = uad?.brands?.find((b) => !/Not.?A.?Brand|Chromium/.test(b.brand));
        const browser = inApp
            ? `dentro de ${inApp}`
            : brand
              ? `${brand.brand} ${brand.version}`
              : /CriOS/.test(ua)
                ? 'Chrome (iOS)'
                : /Safari/.test(ua) && /iPhone|iPad/.test(ua)
                  ? `Safari ${ua.match(/Version\/([\d.]+)/)?.[1] ?? ''}`
                  : ua.slice(0, 80);
        return { model, os, browser };
    };

    const text = async (opinion: string) => {
        const d = await device();
        const s = [...fpsSamples].sort((a, b) => a - b);
        const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
        const p10 = s.length ? s[Math.floor(s.length * 0.1)] : 0;
        const now = performance.now();
        const limited = limitedTotal + (limitedSince !== null ? now - limitedSince : 0);
        return [
            'Prueba AR (cubo)',
            `Teléfono: ${d.model} · ${d.os}`,
            `Navegador: ${d.browser}`,
            `GPU: ${gpu}`,
            `Pantalla: ${innerWidth}×${innerHeight} @${devicePixelRatio}`,
            `FPS: promedio ${avg.toFixed(0)} · mínimo ${s.length ? s[0].toFixed(0) : '—'} · p10 ${p10.toFixed(0)} (${s.length} s medidos)`,
            `Seguimiento: NORMAL a los ${firstNormal !== null ? secs(firstNormal) + ' s' : '— (nunca)'} · LIMITED ${limitedCount} veces (${(limited / 1000).toFixed(1)} s) · ahora ${lastStatus || '—'}`,
            `Cubo: colocado ${placements} veces, el último sobre ${placedOn || '—'} hace ${placedAt !== null ? ((now - placedAt) / 1000).toFixed(0) : '—'} s`,
            `Opinión: ${opinion}`,
            `Duración de la prueba: ${secs(now)} s`
        ].join('\n');
    };

    const send = async (opinion: string) => {
        sheet.hidden = true;
        const msg = await text(opinion);
        const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
        if (nav.share) {
            try {
                await nav.share({ text: msg });
                return;
            } catch (e) {
                if ((e as Error)?.name === 'AbortError') return; // la persona canceló
            }
        }
        location.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    };

    // ---- interfaz: botón «Enviar resultado» y, al tocarlo, la opinión opcional
    const style = document.createElement('style');
    style.textContent = `
#report-btn{position:fixed;right:12px;top:calc(8px + env(safe-area-inset-top));z-index:6;height:40px;padding:0 16px;
 font:600 14px system-ui,sans-serif;color:#111;background:#25d366;border:0;border-radius:999px}
#report-sheet{position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:7;padding:16px;
 background:#1b1b1b;border-radius:16px;display:flex;flex-direction:column;gap:10px;text-align:center}
#report-sheet p{margin:0 0 4px}
#report-sheet button{height:46px;font:600 15px system-ui,sans-serif;border:0;border-radius:12px;color:#111;background:#fff}
#report-sheet button.ok{background:#7ee08a}#report-sheet button.bad{background:#ff8a80}#report-sheet button.skip{background:#444;color:#fff}`;
    document.head.append(style);
    const button = document.createElement('button');
    button.id = 'report-btn';
    button.type = 'button';
    button.textContent = 'Enviar resultado';
    button.hidden = true;
    const sheet = document.createElement('div');
    sheet.id = 'report-sheet';
    sheet.hidden = true;
    sheet.innerHTML =
        '<p>Mientras caminabas alrededor, el cubo…</p>' +
        '<button type="button" class="ok">Se quedó fijo</button>' +
        '<button type="button" class="bad">Se movió</button>' +
        '<button type="button" class="skip">Enviar sin opinar</button>';
    document.body.append(button, sheet);
    button.addEventListener('click', () => (sheet.hidden = false));
    sheet.querySelector('.ok')!.addEventListener('click', () => void send('se quedó FIJO'));
    sheet.querySelector('.bad')!.addEventListener('click', () => void send('se MOVIÓ'));
    sheet.querySelector('.skip')!.addEventListener('click', () => void send('— (no opinó)'));

    return {
        frame,
        /** Empieza a contar fps (al abrir la cámara). */
        start: () => (measuring = true),
        tracking,
        placed
    };
};
