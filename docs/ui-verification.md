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

## Authorized follow-up: dark cobblestone grey

The user requested a lighter, stone-like dark grey rather than the near-black background. `--canvas-bg: #383A39` now governs the exposed canvas, page/loading fallback and frosted footer backing. The footer's lower opacity changes from 0.95 to 0.88 to retain more scene presence. Technical black remains available for text shadows and authoring details. Gaussian rendering, colors, camera data, navigation, fonts and narrative remain unchanged.

## Authorized follow-up: shared AR presentation and mineral graphite grid

AR now imports the same self-hosted fonts and design tokens as the spatial viewer through `design-system.css`. Its old embedded CSS, external font requests, ornamental pattern and legacy cards/pills are replaced by the shared grid, white/warm-secondary/terracotta hierarchy, natural Syne project identity, Jakarta reading text and Mono controls. Startup, language, loading, hints, reset, error and return elements retain their original IDs and handlers; the AR engine implementation changes only by adding its stylesheet import. Native DOM overlay gesture capture is preserved.

The user's latest instruction replaces the stone background with #26292E and its exact 40px technical grid (1px white at 0.04 opacity, centered). The grid is painted behind the viewer canvas and behind AR's camera canvas, never as an overlay on the Gaussian or camera feed. The same mineral graphite is used for the frosted footer backing and browser theme color across all four page entries. This explicitly supersedes the earlier restriction on decorative background grids.

The initial scroll cue now reads “Desliza hacia abajo” / “Scroll down to explore”, with 12–14px bold white Mono, a larger 2px directional chevron and alignment to the shared left margin. The existing footer backing extends 64px upward to support cue contrast. Its original reveal, bounce timing and dismissal-on-scroll behavior are preserved; it never captures input.

### AR and cue validation

Local Chromium checks exercised Spanish/English AR entry, Start and the existing unsupported-device error flow at 320×568, 390×844, 844×390 and 1440×900. All three fonts loaded; there was no horizontal overflow or JavaScript page error. Entry screens and desktop/mobile layouts were visually inspected. The initial viewer rendered and the cue resolved to bold white 14px text; its layer was raised above the frosted footer so the footer cannot blur the instruction itself. Native camera capture, tracking, placement and pinch remain unverified without a physical AR device; their code and gesture layer are preserved.

Files in this follow-up: `src/design-system.css`, `src/viewer.css`, `src/ar.css`, `src/ar-cero.ts` (CSS import only), `src/historia.css`, `src/historia.ts` (cue translations only), the four HTML page entries, and this verification record. The AR entry retains its IDs while using h1 for the project identity and h2 for the AR instructions.

## Authorized follow-up: Story reading contrast

Story description wrappers retain `.text` and add `.story-description`. Within the story scroller they use the exact requested rgba(24,26,29,0.65→0.45) vertical gradient, 6px backdrop blur, 16px vertical padding, 12px vertical margin, #EAE6DF paragraph text and 0 1px 3px black shadow at 0.8 opacity. The reading band has no border, rounded corners or horizontal padding and stays aligned to the shared grid. It is scoped to Story mode; Tour and AR input layers are unaffected. Article geometry continues to be measured by the existing layout mapping.

The story scroller's previous edge mask was removed so it does not isolate the backdrop sampling from the Gaussian canvas; the Tour caption keeps its existing edge mask. Story scrolling, camera-track construction and input ownership are preserved.

## Temporary global Story contrast tuner

The user superseded the local description treatment: descriptions now have no background, backdrop blur, border, radius, box shadow, padding or margin. The independently positioned `#story-filter` fills the viewport at z-index 1, above the renderer and below all text. Its #181A1D fill uses the exact slider percentage as opacity, without blocking pointer input. A temporary, localized, keyboard-accessible native range offers integer values 0–50%, initially 0%, with a live percentage output. It is independent of the original animated veil and camera clock. Both filter and control hide outside ready Story mode; the chosen value remains during chapter/language/mode changes for this page session. No value is fixed as a final preference yet. Once the user supplies their preferred percentage, remove the panel and its tuning handler and fix that value in CSS.


## Scroll-led opening (user-authorized presentation change)

After the unchanged intro, Story starts with one empty scroll viewport, the scene, permanent UI, scroll cue and temporary tuner. The filter defaults to 0%. Scrolling brings the first article up naturally and drives its opacity directly from scroll distance, without a timer. The authored camera track holds its original first reading pose throughout this opening; keyframes, authored segment times and later choreography are unchanged. First-chapter navigation still reaches its reading position. Language changes at the clean opening preserve scroll zero; Tour returns preserve the saved Story position.

Local native range checks passed for 0%, 50%, 49%, touch drag, transparent descriptions, viewport widths 320/390/1440, localized labels, and hiding/retaining the value across Story/Tour switching, with no browser errors.


## Final contrast selection

The user selected 30%. The Story filter now has fixed CSS opacity 0.3. The temporary panel, range, output, localized tuner labels, CSS custom property and input handlers are removed entirely. The scroll-led opening and transparent descriptions remain. The fixed filter still hides during loading and Tour mode, and never intercepts pointer events. This supersedes the temporary 0% starting value above.


## Scroll-driven orbits during reading

The user explicitly requested camera motion during reading and confirmed it must advance with scroll, as at the fountain. All reading segments now use the same early orbit pattern as the fountain: the first half of the existing angle while reading, the remaining half during the following pause. The first opening now also advances that orbit with scroll. The total angle, orbital targets/radii/FOV, segment durations, intro, fountain motion and next-travel endpoints remain unchanged. No real-time auto-rotation is introduced; stopping scroll still pauses the motion by request. This supersedes the static camera hold described above.

Validation compared generated keyframes against the preceding deployed source: intro and every travel segment match exactly (41 samples per travel), the fountain read/orbit match exactly, segment timings match, every reading segment moves at constant radius/target/FOV, and every orbit retains its exact prior exit keyframe. TypeScript and the production build passed.
