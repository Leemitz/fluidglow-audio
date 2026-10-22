# FluidGlow Audio — Phase 02 (v1.2)

A music-reactive iridescent metaball visualizer built on [FluidGlow](https://github.com/stephanezdz/fluidglow). Zero runtime dependencies: **WebGL + Web Audio API**, just HTML, CSS and JavaScript.

## Live features

- Upload a local MP3/WAV/OGG/M4A audio file, play/pause, seek, or drag and drop.
- Microphone input for live sound (HTTPS or localhost; browser permission required).
- Built-in *silent simulated beat* so the visual can be explored without a song. This mode is **not** real audio analysis.
- FFT with distinct bands for bass (35–180 Hz), mid (180–1900 Hz), and high (1900–10000 Hz), plus actual **time-domain RMS loudness** (not FFT average).
- Attack/release smoothing (loudness: 45/260 ms, bass: 80/320 ms, mid: 180/550 ms, high: 25/130 ms).
- Overall RMS loudness → visible `glow` and soft outer `aura`; bass → gentle `size` breathing; mid → `film` and `hueOff`; high → subtle `fringe` detail only.
- **Drum-like onset detection**: a fast/slow bass-weighted envelope contrast with rising-edge threshold, cooldown and impact strength estimation. Demo mode generates synthetic beat events; music and microphone mode analyze real sound.
- **Damped elastic surface waves**: each beat changes the velocity of two spring oscillators, whose displacement smoothly deforms each droplet's GLSL signed distance with two angular harmonics and individual phase offsets. The ripple oscillates and decays instead of instantly jumping to a new silhouette.
- Adjustable wave strength (0–160%), manual **Test Strike** button, and beat indicator/count. OS `prefers-reduced-motion` disables the waves.
- The `merge` and `spread` topology parameters **never depend on audio**, which minimizes the abrupt neck changes observed when droplets approach.
- Sliders for sensitivity, visual response, and independent orbital motion speed.
- Audio stays entirely on the user's machine. No uploads, analytics, cookies, or third-party scripts.

## Run locally

Open `index.html` in a browser. For microphone access use `http://localhost` or HTTPS, e.g.:

```bash
python3 -m http.server 8000
# Visit http://localhost:8000/
```

## Publish using GitHub Pages

1. Create a **public** repository named `fluidglow-audio` on GitHub.
2. Upload **all the files** from this project to the repository root (including `index.html`, `fluidglow.js`, `app.js`, `styles.css`, and `LICENSE`).
3. Open repository **Settings → Pages → Build and deployment** and choose **Deploy from a branch**, branch **main**, folder **/(root)**, then Save.
4. The site URL will be `https://YOUR-USERNAME.github.io/fluidglow-audio/` after Pages finishes deploying.

No build step, configuration files or third-party services are needed.

## Design notes

Audio does not control orbital centers or the smooth-minimum merge threshold. Instead, the shader continuously evolves and the audio modifies its perceived energy (subtle radius pulsation, oil-film interference width/color, rim brightness and an outer aura). The v1.1 iteration switched primary luminance to time-domain RMS and added a dedicated loudness meter. **v1.2** adds beat-triggered, damped surface deformation while retaining stable orbital centres and smooth-union threshold. A corrected edge smoothstep avoids relying on undefined reversed-edge behavior. All incoming spectral energy passes through an attack/release exponential envelope using delta time.

The elastic ripples are a visual SDF deformation, not a full fluid simulation. Viscous flow and physical mass-conserving merging remain out of scope. Transient detection is heuristic; sensitivity will vary by recording and music style.

## Credits and license

- `fluidglow.js`: based on original source by **Stéphane Drozdz** under MIT. See `LICENSE` and [upstream](https://github.com/stephanezdz/fluidglow).
- `app.js`, `styles.css`, `index.html`: custom music-reactive application and interface created for this project. Distributed under the same MIT license.

## v1.2.1 shader visibility regression fix

**Root cause**: The v1.2 GLSL ES 1.00 shader indexed the C/R arrays with the function parameter `i` from `dropSdf(vec2 p, int i)`. Browser WebGL compilation failed with `'i' : Index expression can only contain const or loop symbols`. Rendering continued with an invalid program, leaving the canvas blank.

Fixes:
- Unroll the four metaball SDF calls with constant indices and pass center, radius, and numeric phase directly to the helper.
- Check both GLSL compilation and program link status. When the elastic-wave shader fails, try a stable non-wave version.
- If WebGL cannot render at all, show an explicit fallback/status rather than leaving an unexplained black canvas; recover from WebGL context restoration.
- Bust cached script/style URLs to `?v=1.2.1` so GitHub Pages clients do not mix versions.

The bass/mid/high/RMS audio mapping, drum onset detection, damped wave integration, and constant merge/spread settings remain unchanged.

Browser regression: Chromium with real ANGLE/SwiftShader WebGL showed no visible liquid and console GLSL errors in v1.2; v1.2.1 rendered liquid and exposed no compilation errors.
