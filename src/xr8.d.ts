// Tipos mínimos de la parte de la API de 8th Wall (motor binario con SLAM) que usa la página de AR.
// Documentación: https://8thwall.org/docs/api/engine/xr8
type Xr8Hit = {
    type: 'FEATURE_POINT' | 'ESTIMATED_SURFACE' | 'DETECTED_SURFACE' | 'UNSPECIFIED';
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    distance: number;
};

type Xr8Module = {
    name: string;
    onException?: (error: unknown) => void;
    onCameraStatusChange?: (e: { status: string }) => void;
    onDeviceIncompatible?: (e: unknown) => void;
    listeners?: { event: string; process: (e: { detail: unknown }) => void }[];
};

type Xr8Api = {
    XrConfig: { device: () => { MOBILE: unknown; ANY: unknown } };
    XrController: {
        hitTest: (x: number, y: number, includedTypes?: string[]) => Xr8Hit[];
        configure: (options: Record<string, unknown>) => void;
        recenter: () => void;
    };
    PlayCanvas: {
        runXr: (
            scene: { pcCamera: unknown; pcApp: unknown },
            extraModules: Xr8Module[],
            config: { canvas: HTMLCanvasElement; allowedDevices?: unknown; cameraConfig?: unknown }
        ) => void;
        stopXr: () => void;
    };
    addCameraPipelineModule: (m: Xr8Module) => void;
    loadChunk?: (name: string) => Promise<void>;
};

interface Window {
    XR8?: Xr8Api;
}
