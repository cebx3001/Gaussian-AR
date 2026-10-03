// Textos de la página de realidad aumentada nueva (ar-cero.html), en español e inglés.
import type { Lang } from './i18n';

export type ArCeroText = {
    back: string;
    kicker: string;
    intro: string;
    steps: string[];
    installNote: string;
    start: string;
    openingCamera: string;
    loadingModel: string;
    scan: string;
    scanTip: string;
    ready: string;
    readyTip: string;
    placed: string;
    placedTip: string;
    again: string;
    errTitle: string;
    errCamera: string;
    errMotion: string;
    errDevice: string;
    errGeneric: string;
};

export const AR_CERO: Record<Lang, ArCeroText> = {
    es: {
        back: '← Volver al visor',
        kicker: 'Maqueta en realidad aumentada',
        intro: 'Vas a ver la maqueta sobre una superficie plana, a través de la cámara.',
        steps: [
            'Toca <b>Comenzar</b> y permite el uso de la cámara.',
            'Apunta a una superficie plana y mueve el teléfono despacio.',
            'Cuando aparezca un círculo, toca la pantalla.'
        ],
        installNote: 'Si aparece un aviso para instalar o actualizar algo, puedes tocar <b>Cancelar</b>: igual va a funcionar.',
        start: 'Comenzar',
        openingCamera: 'Abriendo la cámara…',
        loadingModel: 'Cargando la maqueta…',
        scan: 'Apunta a una superficie plana',
        scanTip: 'Mueve el teléfono despacio de lado a lado hasta que aparezca un círculo.',
        ready: 'Toca la pantalla',
        readyTip: 'La maqueta aparecerá donde está el círculo.',
        placed: '¡Listo!',
        placedTip: 'Pellizca con dos dedos para hacerla más grande o más pequeña. Camina alrededor para verla desde todos los lados.',
        again: 'Colocar de nuevo',
        errTitle: 'No se pudo iniciar',
        errCamera: 'No se pudo abrir la cámara. Revisa que hayas dado permiso a la cámara y vuelve a intentarlo.',
        errMotion: 'Hace falta permitir el acceso al movimiento del teléfono. Recarga la página, toca Comenzar y luego Permitir.',
        errDevice: 'Este teléfono o navegador no es compatible. Prueba abrir el enlace en Chrome (Android) o Safari (iPhone).',
        errGeneric: 'Algo falló al iniciar. Recarga la página e inténtalo de nuevo.'
    },
    en: {
        back: '← Back to the viewer',
        kicker: 'Model in augmented reality',
        intro: 'You will see the model on a flat surface, through your camera.',
        steps: [
            'Tap <b>Start</b> and allow camera access.',
            'Point at a flat surface and move your phone slowly.',
            'When a circle appears, tap the screen.'
        ],
        installNote: 'If a prompt asks you to install or update something, you can tap <b>Cancel</b>: it will still work.',
        start: 'Start',
        openingCamera: 'Opening the camera…',
        loadingModel: 'Loading the model…',
        scan: 'Point at a flat surface',
        scanTip: 'Move your phone slowly from side to side until a circle appears.',
        ready: 'Tap the screen',
        readyTip: 'The model will appear where the circle is.',
        placed: 'Done!',
        placedTip: 'Pinch with two fingers to make it bigger or smaller. Walk around to see it from every side.',
        again: 'Place again',
        errTitle: 'Could not start',
        errCamera: 'The camera could not be opened. Make sure you allowed camera access and try again.',
        errMotion: 'Motion access is needed. Reload the page, tap Start and then Allow.',
        errDevice: 'This phone or browser is not supported. Try opening the link in Chrome (Android) or Safari (iPhone).',
        errGeneric: 'Something went wrong while starting. Reload the page and try again.'
    }
};
