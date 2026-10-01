# San Sebastián · visor patrimonial (Cuenca)

La plaza de San Sebastián como una maqueta circular en Gaussian Splatting, contada como una revista editorial en 3D: cuatro capítulos que llevan la cámara a cada lugar y muestran su historia.

- **Navegación 3D:** el visor oficial de SuperSplat (`@playcanvas/supersplat-viewer`), incrustado sin su interfaz. Cada capítulo es una anotación de SuperSplat; el capítulo IV activa su modo caminata.
- **Capa editorial:** capítulos, textos y botones encima del visor (`src/viewer-main.ts`, `src/viewer.css`). Tipografías: Cormorant Garamond (títulos) y Libre Franklin (texto).

## Capítulos

| | Capítulo | Modo |
|---|---|---|
| I | Parque de San Sebastián (la plaza entera) | órbita |
| II | Museo de Arte Moderno | órbita |
| III | Iglesia y Cruz de San Sebastián | órbita |
| IV | Recorre la plaza | caminata |

Textos y poses de cámara en `src/story.json`.

## Editar poses y textos (sin computadora)

1. Abre `…/Gaussian-AR/?editar`.
2. Elige el capítulo y navega con el visor (arrastra y pellizca; con «Cámara: Vuelo» se usa W A S D).
3. Toca **Capturar pose aquí** y escribe etiqueta, título y texto.
4. **Ir a la pose** recarga el visor con las poses nuevas para probarlas.
5. **Copiar datos** y pega el resultado en `src/story.json` (o pásalo en el chat).

## Modo caminata

El modo caminata de SuperSplat necesita los datos de colisión de la escena. Cuando existan, se añaden en `public/` y su ruta en `"collision"` dentro de `src/story.json`.

## Publicación

GitHub Actions compila con Vite y publica `dist/`. En Settings → Pages el origen (**Source**) está en **GitHub Actions**, así que ya no existe una publicación aparte de la rama sin compilar.

## AR

Desactivado por ahora. Su código sigue en `src/ar-experience.ts` y `src/main.ts`.

## Desarrollo

```bash
npm install
npm run dev
npm run build
```
