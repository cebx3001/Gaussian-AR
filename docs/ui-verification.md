# San Sebastián presentation verification

## Scope and visual construction

The reference controls the mobile composition: a technical utility row, terracotta place label, two-line project identity, AR access, a horizontal division, chapter information and historical reading, and a bottom navigation region. The same outer margins, column units, gutters and vertical rhythm govern the entire overlay. Desktop uses twelve columns; mobile uses ten, with each destination spanning two columns. Chapter titles and the closing heading remain secondary editorial typography. Only the project identity uses monumental display scale.

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
- Real Chromium WebGL screenshots inspected at 320×568, 390×844, 768×1024, 844×390 and 1440×900. Root document width never exceeds the viewport. The original redesign used a horizontal mobile navigation rail; the follow-up below replaces it with five visible columns. Controls retain at least 44px hit heights, safe-area spacing and keyboard focus styling.
- Initial Gaussian rendering, all five chapter destinations, language switching, mouse exploration, return to the story and mobile AR navigation were exercised. Keyboard PageDown scroll was checked. Chromium touch orbit and two-finger pinch changed the actual PlayCanvas camera pose, and hit testing confirmed that the canvas receives exploration input. The final short landscape layout leaves approximately 151px of scroll viewport at 844×390 with no heading overlap. The initial redesign preserved camera poses, track construction, scroll interpolation, smoothing constants, reveal, exploration functions and AR modules.
- All three local fonts loaded. The main viewer produced no page errors, failed requests or HTTP asset errors.
- AR start and return navigation were checked; real camera capture, SLAM, plane placement and native immersive AR remain unverified without a physical device.

Publication is performed through the existing GitHub Actions pipeline, without infrastructure changes. Its resulting run and production URL must be checked after publication; a successful local build alone does not establish that the site is live.

## Authorized follow-up: visible destinations and story/tour switching

The user requested five simultaneously visible mobile destinations, a fine structural separator, mode controls below AR, and free orbit around each selected place. The navigation now uses compact localized labels on at most two lines, preserving full accessible destination names. Shared navigation label markup also keeps the existing `recorrido.html` and authoring routes compatible with the common stylesheet.

Story remains the initial mode. The new Historia / Recorrido libre controls expose the existing orbital interaction at any chapter. Tour navigation selects an annotation constructed from that chapter's original pose and target. The general view retains the existing model-center anchor. Selection shows the existing chapter text; a scene gesture dismisses it. Longer text remains scrollable and a tap dismisses it. Returning to Story restores the saved reading position for the same chapter, or the selected chapter when the tour destination changed. No camera-track keyframes, interpolation or smoothing constants, scene data, historical text, AR modules, dependencies or deployment configuration were changed.

Pages now reports `build_type: workflow`, confirming the account-level setting was corrected. Publication uses the unchanged Actions workflow.

### Follow-up verification results

- TypeScript checking and the production Vite build pass. The existing external XR script warning remains.
- Chromium WebGL initialized and rendered. All five Tour selections reached their existing authored camera positions (within 0.25 world units during the final transition frames).
- Touch and mouse drags changed the actual PlayCanvas camera. At the church, the distance to its original target stayed 40.000997 world units before and after both gestures (variation below 0.000002), and the forward-vector alignment with that target stayed effectively 1.0. Thus the selected object remains the orbital anchor.
- Chapter text dismissed on tap. Text hit areas consume dismissal without selecting a new scene point; the surrounding overlay remains transparent to input. Both languages retain Tour mode and translate the selected caption. Returning to Story restores the selected chapter; subsequent Story navigation works.
- Geometry checked at 320×740, 390×844, 844×390 and 1440×900: all five destinations fit; neither the root nor navigation labels overflow horizontally. Mobile controls retain 44px mode and 64px destination hit heights. A full-resolution 390×844 screenshot was inspected, alongside the other viewport captures.
- Main viewer tests produced no JavaScript page errors. Existing AR links and modules remain intact; physical AR tracking is still unverified without a device.

## Authorized follow-up: frosted bottom backing

The user explicitly requested an edgeless frosted-glass gradient at the bottom, superseding the earlier prohibition for this navigation region. The existing `#index` gains a full-width pseudo-element with the requested rgba(24,26,29) gradient and 10px backdrop blur. A 32px masked fade removes the blur's upper rectangular edge. The pseudo-element ignores pointer input; navigation geometry, keyline, five visible destinations, typography, all other colors and application behavior remain unchanged.
