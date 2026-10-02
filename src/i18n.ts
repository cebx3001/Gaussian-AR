// Textos de la interfaz en español e inglés. Los textos de cada lugar viven en story.json.
export type Lang = 'es' | 'en';

export const LANG_KEY = 'san-sebastian:lang';

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
