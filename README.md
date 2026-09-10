# Gaussian-AR

Experiencia mínima de **WebXR `immersive-ar`**: coloca un Gaussian Splat (formato **SOG**) sobre una superficie real y lo hace aparecer con el efecto clásico **Radial Reveal** de PlayCanvas / SuperSplat.

No incluye viewer, anotaciones, cámaras, tours, navegación, hotspots ni paneles. Solo el flujo:

> entrar en AR → detectar superficie → retículo → tocar la pantalla una vez → el SOG queda anclado en ese punto físico → se materializa radialmente desde su centro hacia afuera → queda completamente visible y fijo mientras caminas a su alrededor.

## Contenido

- `public/scene.sog` — el SOG, tomado tal cual de
  `supersplat-viewer/deploy/scenes/ef51f7bb/scene.sog` (359 311 splats). Es el único contenido.
- `src/ar-experience.ts` — toda la lógica AR. El efecto es el **upstream**
  `GSplatRevealRadial` de `playcanvas/scripts/esm/gsplat/reveal-radial.mjs` (no se reimplementa).
- `src/main.ts` — botón de entrada + textos de estado.

## Parámetros para la prueba física

Centralizados en `CONFIG` dentro de [`src/ar-experience.ts`](src/ar-experience.ts):

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `scale` | `0.12` | Escala mundial de la escena colocada |
| `euler` | `[180, 0, 0]` | Rotación local que endereza el SOG (Y-down → flip en X) |
| `yOffset` | `0` | Ajuste vertical en el anclaje |
| `revealCenter` | `[0.0155, -3.1466, 0.0854]` | Origen del reveal, **en espacio local del SOG** (centro de su bounding box) |
| `revealEndRadius` | `7` | Radio que el frente radial debe recorrer para terminar |
| `revealDuration` | `6` | Duración total, claramente perceptible, del reveal (segundos) |

## Ejecutar / reconstruir

```bash
npm install
npm run dev       # servidor local (Vite)
npm run build     # -> dist/
```

WebXR AR requiere **HTTPS** y un dispositivo compatible (p. ej. Chrome en Android con ARCore).
Para probar en el teléfono: publica `dist/` en cualquier host HTTPS, o usa el workflow de GitHub
Pages incluido en `.github/workflows/deploy.yml` (Settings → Pages → Source: GitHub Actions).

`?preview` en la URL (`index.html?preview`) coloca el SOG delante de la cámara sin AR, para
comprobar la carga del asset y el efecto en un navegador de escritorio.

## Stack

- [PlayCanvas](https://playcanvas.com/) `2.21.4` (motor + `GSplatRevealRadial` + WebXR hit-test/anchors)
- [Vite](https://vitejs.dev/) `7` + TypeScript
