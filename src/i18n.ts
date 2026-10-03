// Textos de la interfaz en español e inglés. Los textos de cada lugar viven en story.json.
export type Lang = 'es' | 'en';

export const LANG_KEY = 'san-sebastian:lang';

/** Nombres de los dos modos: la historia con scroll (historia.html) y el recorrido libre (index.html). */
export const MODES: Record<Lang, { story: string; tour: string }> = {
    es: { story: 'Modo historia', tour: 'Modo recorrido' },
    en: { story: 'Story mode', tour: 'Tour mode' }
};

/** Idioma: `?lang=`, el último elegido o el del navegador (español si empieza por «es»). */
export const detectLang = (): Lang => {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'es' || q === 'en') return q;
    try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved === 'es' || saved === 'en') return saved;
    } catch {
        // sin almacenamiento
    }
    return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
};

export type UiText = {
    loading: string;
    loadError: string;
    prev: string;
    next: string;
    places: string;
    /** Cómo se «activa» un nombre: toque en pantallas táctiles, clic con ratón. */
    tapTouch: string;
    tapMouse: string;
    /** Instrucciones de uso: `**negrita**` para el gesto. */
    howTouch: string[];
    howMouse: string[];
};

export const UI: Record<Lang, UiText> = {
    es: {
        loading: 'Cargando la plaza',
        loadError: 'Este navegador no pudo abrir la escena 3D.',
        prev: 'Anterior',
        next: 'Siguiente',
        places: 'Lugares',
        tapTouch: 'toca',
        tapMouse: 'haz clic en',
        howTouch: [
            '**Girar:** arrastra con un dedo.',
            '**Zoom:** pellizca con dos dedos.',
            '**Mover:** desliza con dos dedos.'
        ],
        howMouse: [
            '**Girar:** arrastra con el ratón.',
            '**Zoom:** rueda del ratón.',
            '**Mover:** clic derecho y arrastra, o las teclas W A S D.'
        ]
    },
    en: {
        loading: 'Loading the square',
        loadError: 'This browser could not open the 3D scene.',
        prev: 'Previous',
        next: 'Next',
        places: 'Places',
        tapTouch: 'tap',
        tapMouse: 'click',
        howTouch: [
            '**Rotate:** drag with one finger.',
            '**Zoom:** pinch with two fingers.',
            '**Move:** slide with two fingers.'
        ],
        howMouse: [
            '**Rotate:** drag with the mouse.',
            '**Zoom:** scroll the mouse wheel.',
            '**Move:** right-click and drag, or use the W A S D keys.'
        ]
    }
};

/** Textos de la realidad aumentada (página `ar.html`) y del botón del visor. */
export type ArText = {
    button: string;
    buttonLabel: string;
    back: string;
    startKicker: string;
    startTitle: string;
    startText: string;
    start: string;
    loadingModel: string;
    starting: string;
    scanning: string;
    ready: string;
    placed: string;
    again: string;
    notMobileTitle: string;
    notMobileText: string;
    errCamera: string;
    errDevice: string;
    errGeneric: string;
};

export const AR_UI: Record<Lang, ArText> = {
    es: {
        button: 'Ver en AR',
        buttonLabel: 'Míralo en realidad aumentada',
        back: '← Volver al visor',
        startKicker: 'Realidad aumentada',
        startTitle: 'La plaza sobre tu mesa',
        startText:
            'Coloca la maqueta de la plaza de San Sebastián sobre una superficie plana, a un tamaño de aproximadamente 1 metro. Al comenzar, el navegador te pedirá permiso para usar la cámara y el movimiento del teléfono.',
        start: 'Comenzar',
        loadingModel: 'Cargando el modelo…',
        starting: 'Iniciando la cámara…',
        scanning: 'Apunta el teléfono al piso o a una superficie plana y muévelo despacio de lado a lado. Funciona mejor con buena luz y superficies con textura (no lisas ni brillantes).',
        ready: 'Toca el círculo para colocar la maqueta.',
        placed: 'Camina alrededor para verla desde todos los lados. Pellizca con dos dedos para cambiar su tamaño.',
        again: 'Colocar de nuevo',
        notMobileTitle: 'Solo en el teléfono',
        notMobileText: 'La realidad aumentada está pensada para teléfonos. Abre esta página desde tu celular.',
        errCamera: 'No se pudo usar la cámara ni el movimiento del teléfono. Revisa que el navegador tenga esos permisos y vuelve a intentarlo.',
        errDevice: 'Este dispositivo o navegador no admite realidad aumentada en la web.',
        errGeneric: 'No se pudo iniciar la realidad aumentada. Recarga la página e inténtalo de nuevo.'
    },
    en: {
        button: 'View in AR',
        buttonLabel: 'See it in augmented reality',
        back: '← Back to the viewer',
        startKicker: 'Augmented reality',
        startTitle: 'The square on your table',
        startText:
            'Place the model of San Sebastián Square on a flat surface, at about 1 meter across. When you start, the browser will ask for permission to use the camera and the phone’s motion sensors.',
        start: 'Start',
        loadingModel: 'Loading the model…',
        starting: 'Starting the camera…',
        scanning: 'Point your phone at the floor or a flat surface and move it slowly from side to side. It works best with good light and textured surfaces (not smooth or shiny).',
        ready: 'Tap the circle to place the model.',
        placed: 'Walk around it to see it from every side. Pinch with two fingers to resize it.',
        again: 'Place again',
        notMobileTitle: 'Phones only',
        notMobileText: 'Augmented reality is designed for phones. Open this page on your mobile.',
        errCamera: 'The camera or the phone’s motion sensors could not be used. Make sure the browser has those permissions and try again.',
        errDevice: 'This device or browser does not support augmented reality on the web.',
        errGeneric: 'Augmented reality could not start. Reload the page and try again.'
    }
};
