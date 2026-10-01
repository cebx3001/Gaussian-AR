# Gaussian-AR · Plaza de San Sebastián (Cuenca)

La plaza de San Sebastián como una maqueta circular en Gaussian Splatting (formato **SOG**), con dos experiencias separadas:

| Página | Qué es |
|---|---|
| `index.html` — **Visor 3D** | La maqueta completa vista desde arriba a ~45°, con una animación de entrada. Cinco botones llevan la cámara a cada punto y abren su texto (narrativa espacial). Funciona en cualquier navegador con WebGPU o WebGL2. |
| `ar.html` — **AR** | Coloca la maqueta sobre una superficie real (WebXR `immersive-ar`) y la hace aparecer con el efecto Radial Reveal. |

El visor muestra el botón «Ver en AR» solo si el dispositivo lo soporta.

## Contenido

- `public/scene.sog` — la escena (359 311 splats), publicada en <https://superspl.at/scene/ef51f7bb> (CC BY 4.0, autor: CB / drbrownlabs).
- `src/story.json` — **los datos de la narrativa**: títulos, textos y poses de cámara de los 5 puntos.
- `src/viewer-main.ts`, `src/viewer.css` — el visor 3D.
- `src/ar-experience.ts`, `src/main.ts`, `src/style.css` — la experiencia AR.

## Cómo se editan los puntos (sin computadora)

1. Abre el visor con `?editar` al final de la dirección: `…/Gaussian-AR/?editar`.
2. Navega hasta el encuadre que quieres, elige el punto en el selector y toca **Capturar pose aquí**.
3. Escribe etiqueta, título y texto del punto.
4. Toca **Copiar datos** y pega el resultado en `src/story.json` (o pásalo en el chat).

Los cambios del modo edición se guardan solo en ese navegador hasta que se pasen a `story.json`. Sin `?editar`, la gente ve únicamente los botones y los textos.

En la URL también funciona `?sinintro` para saltar la animación de entrada.

## Ejecutar / reconstruir

```bash
npm install
npm run dev       # servidor local (Vite)
npm run build     # -> dist/
```

El despliegue en GitHub Pages es automático al hacer push a `main` (`.github/workflows/deploy.yml`).
WebXR AR requiere HTTPS y un dispositivo compatible (p. ej. Chrome en Android con ARCore).

## Parámetros del AR

Centralizados en `CONFIG` dentro de [`src/ar-experience.ts`](src/ar-experience.ts): `scale`, `euler`, `yOffset`, `revealCenter`, `revealEndRadius`, `revealDuration`.

## Stack

[PlayCanvas](https://playcanvas.com/) `2.21.4` · [Vite](https://vitejs.dev/) `7` · TypeScript
