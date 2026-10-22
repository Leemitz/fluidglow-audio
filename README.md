# FluidGlow Audio — Phase 01

A music-reactive iridescent metaball visualizer built on [FluidGlow](https://github.com/stephanezdz/fluidglow). Zero runtime dependencies: **WebGL + Web Audio API**, just HTML, CSS and JavaScript.

## Live features

- Upload a local MP3/WAV/OGG/M4A audio file, play/pause, seek, or drag and drop.
- Microphone input for live sound (HTTPS or localhost; browser permission required).
- Built-in *silent simulated beat* so the visual can be explored without a song. This mode is **not** real audio analysis.
- FFT with distinct bands for bass (35–180 Hz), mid (180–1900 Hz), and high (1900–10000 Hz).
- Attack/release smoothing (bass: 80/320 ms, mid: 180/550 ms, high: 25/130 ms).
- Bass → gentle `size` breathing; mid → `film` and `hueOff`; high → `glow` and subtle `fringe` response.
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

Audio does not control orbital centers or the smooth-minimum merge threshold. Instead, the shader continuously evolves and the audio modifies its perceived energy (subtle radius pulsation, oil-film interference width/color, rim brightness). All incoming spectral energy passes through an attack/release exponential envelope using delta time.

This is **phase 1**. Liquid-surface standing waves, viscous body dynamics, and realistic physical merging are out of scope.

## Credits and license

- `fluidglow.js`: based on original source by **Stéphane Drozdz** under MIT. See `LICENSE` and [upstream](https://github.com/stephanezdz/fluidglow).
- `app.js`, `styles.css`, `index.html`: custom music-reactive application and interface created for this project. Distributed under the same MIT license.