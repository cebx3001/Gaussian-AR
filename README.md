# San Sebastián · visor patrimonial (Cuenca)

La plaza de San Sebastián como una maqueta circular en Gaussian Splatting, contada como una revista editorial en 3D: cuatro lugares que llevan la cámara a cada rincón y muestran su historia.

- **Navegación 3D:** el visor oficial de SuperSplat (`@playcanvas/supersplat-viewer`), incrustado sin su interfaz. Cada lugar es una anotación de SuperSplat.
  - Al llegar a un lugar, ese punto es el **ancla**: la cámara orbita a su alrededor, sin bajar de la horizontal (no se ve la maqueta desde abajo).
  - Si el usuario **desplaza** la escena (dos dedos, botón derecho, Mayús o teclas W A S D), pasa al **modo vuelo** de SuperSplat: la cámara gira sobre su propio eje y no baja del suelo.
- **Capa editorial:** textos y botones encima del visor (`src/viewer-main.ts`, `src/viewer.css`). Tipografías: Cormorant Garamond (títulos) y Libre Franklin (texto). Todas las descripciones usan el mismo tamaño de letra.
- **Parche de SuperSplat:** `vite.config.ts` permite fijar el límite de giro vertical y el suelo del modo vuelo, que el paquete no expone. Si el paquete cambia, la compilación falla en lugar de publicar sin el límite.

## Lugares

Plaza de San Sebastián · Iglesia y Cruz de San Sebastián · Museo Municipal de Arte Moderno · La fuente de San Sebastián.

Textos y poses de cámara en `src/story.json`. El modo caminata se quitó (la calidad del suelo de la escena no es buena); sus archivos de colisión ya no están en el repositorio.

## Editar poses (sin computadora)

1. Abre `…/Gaussian-AR/?editar`: sin límites de giro, solo una barra pequeña abajo.
2. Elige el lugar en el selector y navega con el visor.
3. **Capturar** guarda la pose (el ancla es el punto del suelo al que apunta la vista).
4. **Copiar** copia las poses de todos los lugares: pégalas en el chat o en `src/story.json`.

## Animación de entrada

Al abrir el visor suena una animación de cámara y la **Vista general** es donde termina (su último keyframe): al terminar, la cámara se queda ahí, sin movimiento extra, y aparece el texto. Se hace con una línea de tiempo de 8 s:

1. Abre `…/Gaussian-AR/?animar`.
2. Toca la línea para colocar el cabezal (el visor muestra la cámara en ese instante) y mueve la cámara con los gestos del visor.
3. **Añadir** crea un keyframe en ese instante (si ya había uno, lo actualiza). Los keyframes se arrastran para cambiar su tiempo; el seleccionado se quita con **Borrar**.
4. ▶ reproduce la animación; **Ejemplo** carga una entrada de partida.
5. **Copiar** y pega el resultado en el chat (o en `src/story.json`, clave `intro`).

Sin keyframes en `story.json` se usa una entrada automática. Si la animación termina en un sitio distinto a la vista general, la cámara vuela hasta ella antes de mostrar el texto. `?sinintro` la salta.

## Efecto Radial Reveal

Al abrir el visor, la escena no aparece de golpe: nace de la oscuridad con el **Radial Reveal** de PlayCanvas (viene dentro del paquete `playcanvas`, `scripts/esm/gsplat/reveal-radial.mjs`). Desde el centro de la plaza salen dos ondas: la primera hace aparecer los splats como **puntos** de color, y la segunda los **levanta, los resalta y los crece** hasta su forma y color reales. Al terminar, el efecto se retira solo.

- Se usa el shader y la lógica del efecto oficial. El visor de SuperSplat dibuja en modo «unified», así que se conecta con `setWorkBufferModifier` y actualiza el work buffer en cada cuadro mientras dura (`src/reveal.ts`).
- El efecto original está pensado para objetos pequeños (sus puntos miden 5 mm); `dotScale` los agranda para esta escena de ~130 m.
- Dura lo mismo que la animación de cámara (8 s): las ondas arrancan despacio en el centro y aceleran hacia afuera, y la de colores llega al borde de la escena (116 m) justo a los 8 s, cuando el efecto se retira solo.
- Los parámetros (radio, velocidad inicial, desfase entre ondas, elevación, tamaño de los puntos) están en `REVEAL`, en `src/viewer-main.ts`; la aceleración se calcula sola para que termine a los 8 s. `?sinintro` salta la animación y el efecto.

## Paleta

| Uso | Color |
|---|---|
| Fondo (piedra oscura) | `#3B3A35` |
| Texto e información (blanco piedra) | `#E7D8D6` |
| Títulos, líneas, indicadores y elementos activos (rojo profundo) | `#A6473E` |

Están definidos como variables al inicio de `src/viewer.css` (`--bg`, `--ink`, `--accent`); el fondo de la escena 3D se fija en `buildSettings`, en `src/viewer-main.ts`.

## Idiomas (español / inglés)

Arriba a la derecha hay un selector **EN | ES**. El idioma se elige por el navegador la primera vez, se recuerda en el dispositivo y también se puede fijar con `?lang=en` o `?lang=es`. Todo cambia al instante: cabecera, nombres del índice, textos de cada lugar, pantalla de carga y mensajes.

- Textos de cada lugar: en `src/story.json` el español es el texto base y el inglés está en `en` dentro de cada lugar (`place.en` para la cabecera).
- Mensajes de la interfaz y las instrucciones de uso: `src/i18n.ts`.
- La **Vista general** lleva además las instrucciones de uso (girar, zoom, mover), distintas para pantalla táctil y para ratón (`"howto": true` en su entrada de `story.json`).
- Las herramientas de edición (`?editar`, `?animar`) siguen en español.

## Realidad aumentada (solo teléfonos)

En el visor, el botón **Ver en AR / View in AR** (solo en pantallas táctiles) abre `ar.html`, una página aparte: si algo falla en la AR, el visor no se toca.

1. **Comenzar** pide cámara y movimiento (en iPhone el permiso debe salir de un toque).
2. Se pide apuntar a una superficie plana (piso, mesa) y moverse despacio.
3. Al detectarla aparece un círculo sobre ella; al tocarlo, la maqueta (~1 m) se coloca ahí y se expande con el mismo Radial Reveal del visor.
4. **Colocar de nuevo** repite el proceso.

- **Seguimiento: 8th Wall** (motor binario con SLAM, paquete `@8thwall/engine-binary`). Funciona en iPhone (Safari) y Android (Chrome) sin ARCore ni WebXR. El render es PlayCanvas, con el mismo splat del visor.
- El motor **se copia tal cual** a `external/xr/` al compilar (`vite.config.ts`): su licencia exige no modificarlo y conservar su aviso de derechos de autor, que está en `ar.html` y en `external/xr/LICENSE`. Licencia: <https://github.com/8thwall/engine/blob/main/LICENSE> (Niantic Spatial).
- La escala es en metros reales (`scale: 'absolute'`); el tamaño de la maqueta está en `MODEL_METERS`, en `src/ar-page.ts`.
- `ar.html?demo` salta la cámara y las superficies, para probar la maqueta y el efecto en una computadora.

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
