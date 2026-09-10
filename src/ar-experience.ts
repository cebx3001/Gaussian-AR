// ---------------------------------------------------------------------------
// Gaussian-AR — a minimal WebXR `immersive-ar` experience.
//
//   enter AR → hit-test a real surface → reticle → tap once → the SOG is
//   anchored at that physical point → it materialises via the classic Radial
//   Reveal (spatial, splat-by-splat, from a local centre outward) → stays
//   registered in place while the user walks around it.
//
// No annotations / cameras / tours / hotspots / panels — just this.
// ---------------------------------------------------------------------------
import {
    AppBase,
    AppOptions,
    Asset,
    BinaryHandler,
    CameraComponentSystem,
    Color,
    ContainerHandler,
    Entity,
    FILLMODE_FILL_WINDOW,
    GSplatComponentSystem,
    GSplatHandler,
    Quat,
    RESOLUTION_AUTO,
    RenderComponentSystem,
    ScriptComponentSystem,
    StandardMaterial,
    TONEMAP_ACES,
    TextureHandler,
    Vec3,
    XRSPACE_LOCAL,
    XRTYPE_AR,
    createGraphicsDevice
} from 'playcanvas';
import type { XrAnchor, XrHitTestSource } from 'playcanvas';
import { GSplatRevealRadial } from 'playcanvas/scripts/esm/gsplat/reveal-radial.mjs';

// ===========================================================================
// PARÁMETROS — se ajustan tras verlo físicamente en el teléfono.
// ===========================================================================
export type ArConfig = {
    /** SOG asset URL (relative to the site root). */
    assetUrl: string;
    /** Uniform world scale of the placed scene. The capture is ~9 m across in its
     *  own units; 0.12 ≈ a ~1.1 m model on the floor in front of you. */
    scale: number;
    /** Local Euler (deg, xyz) that seats the SOG upright. splat-transform output
     *  is Y-down → a 180° flip about X. Keeps the asset's internal transform. */
    euler: [number, number, number];
    /** Extra vertical offset (metres, applied at the anchor) if the floor of the
     *  capture isn't at its local origin. */
    yOffset: number;
    /** Origin of the reveal, in the SOG's LOCAL model space (its bbox centre by
     *  default — from meta.json means mins/maxs). Travels with the scene. */
    revealCenter: [number, number, number];
    /** Radius the radial front must travel to finish — cover the whole extent. */
    revealEndRadius: number;
    /** Total, clearly-perceptible duration of the reveal in seconds. */
    revealDuration: number;
};

export const CONFIG: ArConfig = {
    assetUrl: 'scene.sog',
    scale: 0.12,
    euler: [180, 0, 0],
    yOffset: 0,
    // scene.sog meta.json means: mins [-4.569, -3.952, -4.504], maxs [4.600, -2.341, 4.675]
    revealCenter: [0.0155, -3.1466, 0.0854],
    revealEndRadius: 7,
    revealDuration: 6
};

// ===========================================================================

export type ArPhase =
    | 'unsupported'
    | 'ready'
    | 'starting'
    | 'scanning'
    | 'aim'
    | 'revealing'
    | 'placed'
    | 'ended';

export const detectArSupport = async (): Promise<boolean> => {
    if (!navigator.xr?.isSessionSupported) return false;
    try {
        return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
        return false;
    }
};

export class ArExperience {
    private app!: AppBase;

    private camera!: Entity;

    /** Follows the WebXR anchor pose every frame it changes. */
    private anchorRoot!: Entity;

    /** Child of anchorRoot — carries the SOG's own transform + user scale. */
    private gsplat!: Entity;

    private reticle!: Entity;

    private hitSource: XrHitTestSource | null = null;

    private anchor: XrAnchor | null = null;

    private readonly hitPos = new Vec3();

    private readonly hitRot = new Quat();

    private haveHit = false;

    private placed = false;

    private wantPlace = false;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly config: ArConfig,
        private readonly onPhase: (phase: ArPhase, detail?: string) => void,
        private readonly domOverlayRoot: HTMLElement | null = null
    ) {}

    async init(): Promise<void> {
        // WebXR on mobile is a WebGL2 path everywhere today; force it so the GLSL
        // branch of the reveal shader is the one that compiles.
        const device = await createGraphicsDevice(this.canvas, {
            deviceTypes: ['webgl2'],
            antialias: false,
            depth: true,
            stencil: false,
            xrCompatible: true,
            powerPreference: 'high-performance'
        });
        device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

        const options = new AppOptions();
        options.graphicsDevice = device;
        options.componentSystems = [
            GSplatComponentSystem,
            CameraComponentSystem,
            ScriptComponentSystem,
            RenderComponentSystem
        ];
        options.resourceHandlers = [TextureHandler, ContainerHandler, BinaryHandler, GSplatHandler];

        const app = new AppBase(this.canvas);
        app.init(options);
        app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
        app.setCanvasResolution(RESOLUTION_AUTO);
        window.addEventListener('resize', () => app.resizeCanvas());
        this.app = app;
        (window as unknown as { __app?: AppBase }).__app = app;

        this.camera = new Entity('camera');
        this.camera.addComponent('camera', {
            clearColor: new Color(0, 0, 0, 0), // transparent — passthrough shows through
            toneMapping: TONEMAP_ACES, // without ACES the gsplat's HDR colour renders near-black
            farClip: 100,
            nearClip: 0.05
        });
        app.root.addChild(this.camera);

        this.buildReticle();
        await this.loadGsplat();

        app.start();

        if (!app.xr?.supported) {
            this.onPhase('unsupported', 'WebXR no está disponible en este navegador.');
            return;
        }
        if (this.domOverlayRoot && app.xr.domOverlay?.supported) {
            app.xr.domOverlay.root = this.domOverlayRoot;
        }

        app.xr.on('start', () => this.onXrStart());
        app.xr.on('end', () => this.onPhase(this.placed ? 'placed' : 'ended'));
        app.xr.on('error', (err: Error) => this.onPhase('ended', err?.message ?? 'WebXR error'));

        this.onPhase('ready');
    }

    private buildReticle(): void {
        const mat = new StandardMaterial();
        mat.emissive = new Color(0.1, 0.85, 0.75);
        mat.useLighting = false;
        mat.opacity = 0.85;
        mat.blendType = 2; // BLEND_NORMAL
        mat.update();

        this.reticle = new Entity('reticle');
        this.reticle.addComponent('render', { type: 'plane', material: mat });
        this.reticle.setLocalScale(0.18, 0.18, 0.18);
        this.reticle.enabled = false;
        this.app.root.addChild(this.reticle);
    }

    private async loadGsplat(): Promise<void> {
        const url = this.config.assetUrl;
        const filename = url.split('/').pop() ?? 'scene.sog';

        this.anchorRoot = new Entity('anchor-root');
        this.anchorRoot.enabled = false; // hidden until the tap places it
        this.app.root.addChild(this.anchorRoot);

        this.gsplat = new Entity('gsplat');
        this.gsplat.setLocalEulerAngles(...this.config.euler);
        this.gsplat.setLocalScale(this.config.scale, this.config.scale, this.config.scale);
        this.anchorRoot.addChild(this.gsplat);

        await new Promise<void>((resolve, reject) => {
            const asset = new Asset(filename, 'gsplat', { url, filename });
            asset.once('load', () => {
                // Non-unified: the reveal effect binds to THIS entity's material, so
                // it never touches a shared template and cleanly reverts on completion.
                this.gsplat.addComponent('gsplat', { unified: false, asset });
                resolve();
            });
            asset.once('error', (err: string) => reject(new Error(`No se pudo cargar el SOG: ${err}`)));
            this.app.assets.add(asset);
            this.app.assets.load(asset);
        });
    }

    /** Enter immersive-ar. Call from a user gesture (button click). */
    enter(): void {
        if (!this.app.xr?.isAvailable(XRTYPE_AR)) {
            this.onPhase('ended', 'immersive-ar no está disponible en este dispositivo.');
            return;
        }
        this.onPhase('starting');
        this.app.xr.start(this.camera.camera!, XRTYPE_AR, XRSPACE_LOCAL, {
            anchors: true,
            callback: (err?: Error | null) => {
                if (err) this.onPhase('ended', err.message || 'No se pudo iniciar AR.');
            }
        });
    }

    exit(): void {
        this.app.xr?.end();
    }

    private onXrStart(): void {
        const xr = this.app.xr!;
        this.onPhase('scanning');

        // Raw session 'select' — the reliable signal for a screen tap in AR.
        xr.session?.addEventListener('select', () => this.onTap());

        if (!xr.hitTest?.supported) {
            this.onPhase('ended', 'Este dispositivo no soporta hit-testing AR.');
            return;
        }

        xr.hitTest.start({
            entityTypes: ['point', 'plane'],
            callback: (err: Error | null, source: XrHitTestSource | null) => {
                if (err || !source) {
                    this.onPhase('ended', err?.message ?? 'No se pudo iniciar el hit-test.');
                    return;
                }
                this.hitSource = source;
                source.on(
                    'result',
                    (position: Vec3, rotation: Quat, _i: unknown, hitResult: XRHitTestResult) => {
                        // Pooled — copy synchronously, never retain the args.
                        this.hitPos.copy(position);
                        this.hitRot.copy(rotation);
                        if (!this.haveHit) {
                            this.haveHit = true;
                            if (!this.placed) this.onPhase('aim');
                        }
                        if (!this.placed) {
                            this.reticle.enabled = true;
                            this.reticle.setPosition(this.hitPos);
                            this.reticle.setRotation(this.hitRot);
                            this.reticle.rotateLocal(-90, 0, 0); // lay the plane flat, facing up
                        }
                        // A tap is queued and a live hit result is in hand — anchor now.
                        if (this.wantPlace && !this.placed) {
                            this.wantPlace = false;
                            this.place(hitResult);
                        }
                    }
                );
                source.on('remove', () => {
                    this.haveHit = false;
                    if (!this.placed) this.onPhase('scanning');
                });
            }
        });
    }

    private onTap(): void {
        if (this.placed || !this.app.xr?.active) return;
        this.wantPlace = true; // handled on the next hit-test result
    }

    private place(hitResult: XRHitTestResult): void {
        if (this.placed) return;
        this.placed = true;

        // One placement only — stop scanning, hide the reticle.
        this.hitSource?.remove();
        this.hitSource = null;
        this.reticle.enabled = false;

        const anchors = this.app.xr!.anchors;
        const settle = (anchor: XrAnchor | null) => {
            if (anchor) {
                this.anchor = anchor;
                this.applyAnchor();
                anchor.on('change', () => this.applyAnchor());
            } else {
                this.seat(this.hitPos, this.hitRot); // static fallback
            }
            this.runReveal();
        };

        if (anchors?.supported && 'XRHitTestResult' in window) {
            anchors.create(hitResult, (err: Error | null, anchor: XrAnchor | null) => {
                if (err || !anchor) {
                    anchors.create(this.hitPos, this.hitRot, (e2: Error | null, a2: XrAnchor | null) =>
                        settle(e2 ? null : a2)
                    );
                    return;
                }
                settle(anchor);
            });
        } else if (anchors?.supported) {
            anchors.create(this.hitPos, this.hitRot, (err: Error | null, anchor: XrAnchor | null) =>
                settle(err ? null : anchor)
            );
        } else {
            settle(null);
        }
    }

    private applyAnchor(): void {
        if (this.anchor) this.seat(this.anchor.getPosition(), this.anchor.getRotation());
    }

    private seat(position: Vec3, rotation: Quat): void {
        this.anchorRoot.enabled = true;
        this.anchorRoot.setPosition(position.x, position.y + this.config.yOffset, position.z);
        this.anchorRoot.setRotation(rotation);
    }

    /** Runs the upstream Radial Reveal once, from the SOG's local centre outward. */
    private runReveal(): void {
        this.onPhase('revealing');

        const { revealDuration, revealEndRadius, revealCenter } = this.config;
        const delay = Math.max(0.3, revealDuration * 0.18);
        const speed = revealEndRadius / Math.max(0.1, revealDuration - delay);

        this.gsplat.addComponent('script');
        const effect = this.gsplat.script!.create(GSplatRevealRadial) as unknown as GSplatRevealRadial;
        effect.center.set(revealCenter[0], revealCenter[1], revealCenter[2]);
        effect.endRadius = revealEndRadius;
        effect.speed = speed;
        effect.acceleration = 0; // constant front → total time ≈ revealDuration
        effect.delay = delay;
        effect.bandWidth = 1.0;
        effect.oscillationIntensity = 0.18;
        effect.dotTint.set(0, 1, 1);
        effect.waveTint.set(1, 0.5, 0);

        // The effect disables itself once the front passes endRadius and removes
        // its shader chunks — the SOG is then back to its exact normal look.
        const watch = () => {
            if (effect.isEffectComplete()) {
                this.app.off('update', watch);
                this.onPhase('placed');
            }
        };
        this.app.on('update', watch);
    }

    /** Non-XR bring-up: seat the SOG in front of the camera and reveal it, so the
     *  asset pipeline + effect can be checked on a desktop browser. Not the AR flow. */
    previewPlace(): void {
        if (this.placed) return;
        this.placed = true;
        this.reticle.enabled = false;
        this.camera.setPosition(2.2, 1.5, 3.0);
        this.camera.lookAt(0, 1, 0);
        this.seat(new Vec3(0, 1, 0), new Quat());
        this.runReveal();
    }
}
