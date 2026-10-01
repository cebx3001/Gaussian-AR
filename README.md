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

Al abrir el visor suena una animación de cámara que termina en la **Vista general**. Se hace con una línea de tiempo de 8 s:

1. Abre `…/Gaussian-AR/?animar`.
2. Toca la línea para colocar el cabezal (el visor muestra la cámara en ese instante) y mueve la cámara con los gestos del visor.
3. **Añadir** crea un keyframe en ese instante (si ya había uno, lo actualiza). Los keyframes se arrastran para cambiar su tiempo; el seleccionado se quita con **Borrar**.
4. ▶ reproduce la animación; **Ejemplo** carga una entrada de partida.
5. **Copiar** y pega el resultado en el chat (o en `src/story.json`, clave `intro`).

Sin keyframes en `story.json` se usa una entrada automática. Si la animación termina en un sitio distinto a la vista general, la cámara vuela hasta ella antes de mostrar el texto. `?sinintro` la salta.

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
