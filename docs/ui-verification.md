# San Sebastián presentation verification

## Scope and visual construction

The reference controls the mobile composition: a technical utility row, terracotta place label, two-line project identity, AR access, a horizontal division, chapter information and historical reading, and a bottom navigation rail. The same outer margins, column units, gutters and vertical rhythm govern the entire overlay. Desktop uses twelve columns; mobile uses four. Chapter titles and the closing heading remain secondary editorial typography. Only the project identity uses monumental display scale.

Syne 700 was selected after rendering 700 and 800 side by side: Syne's 800 master has substantially wider letterforms. The 700 master preserves the requested natural vertical proportions without transforms. Plus Jakarta Sans handles chapter titles and reading; JetBrains Mono handles indices, navigation and controls. The three licensed variable fonts are self-hosted. Their Latin character sets include Á, É and Ñ. The palette is #FFFFFF, #D1CDB8, #B84335 and the #0D0D0D technical fallback, with rgba(255,255,255,0.1) keylines.

No cards, rounded controls, backdrop blur, fictional telemetry, decorative grid patterns or full-screen reading veil remain in the visitor overlay. Text uses restrained local shadows. Uncaptured areas of the original transparent Gaussian retain the technical fallback; its rendering and camera framing have not been changed.

## Discovery and baseline

- `historia.ts` mounts SuperSplat 1.36.2 in the fixed full-viewport `#stage`, with WebGL and its own UI disabled. It reads `scene.sog` and the existing story camera track.
- Scroll maps article geometry to existing travel, reading and orbit segments. Navigation uses the same five chapter buttons and smooth `goTo` destinations. There are no thumbnails in this application.
- Story mode captures scrolling intentionally. Free exploration hides the story and enables input on the canvas; returning restores the same story track. Language detection, persistence and translations remain intact.
- Mobile AR access leads to `ar-cero.html`, which retains the existing WebXR / 8th Wall startup and camera-permission flow. Authoring tools remain at `recorrido.html?editar` and `recorrido.html?animar`.
- Vite builds `dist`, with relative URLs and four existing HTML entries. The unchanged Pages workflow builds and deploys on pushes to `main`. The baseline production URL returned HTTP 200 and the latest baseline deployment succeeded.
- Baseline defects: `npm ci` rejects the existing incomplete lockfile; the existing workflow uses `npm install`, which succeeds. Switching languages could clear the active navigation highlight. This UI state has been repaired without changing language persistence or chapter selection.
- Headless software WebGL renders slowly; loading tests were extended after the unchanged baseline also exceeded a 90-second timeout. The browser's default trust store also rejected the environment proxy certificate for the unchanged AR page's Google Fonts request. This is an environment transport limitation, not a newly missing application asset.

## Verification

- `npm install --package-lock=false` follows the existing workflow's installation path without changing dependencies or the lockfile.
- `npm run build` passes TypeScript checking and the Vite production build. The baseline warning about the deliberately external XR engine script in `ar.html` remains unchanged.
- Real Chromium WebGL screenshots inspected at 320×568, 390×844, 768×1024, 844×390 and 1440×900. Root document width never exceeds the viewport. The mobile navigation rail intentionally scrolls horizontally; its five original destinations remain available. Controls retain at least 44px hit heights, safe-area spacing and keyboard focus styling.
- Initial Gaussian rendering, all five chapter destinations, language switching, mouse exploration, return to the story and mobile AR navigation were exercised. Keyboard PageDown scroll was checked. Chromium touch orbit and two-finger pinch changed the actual PlayCanvas camera pose, and hit testing confirmed that the canvas receives exploration input. The final short landscape layout leaves approximately 151px of scroll viewport at 844×390 with no heading overlap. The original camera poses, track construction, scroll interpolation, smoothing constants, reveal, exploration functions and AR modules are unchanged.
- All three local fonts loaded. The main viewer produced no page errors, failed requests or HTTP asset errors.
- AR start and return navigation were checked; real camera capture, SLAM, plane placement and native immersive AR remain unverified without a physical device.

Publication is performed through the existing GitHub Actions pipeline, without infrastructure changes. Its resulting run and production URL must be checked after publication; a successful local build alone does not establish that the site is live.
