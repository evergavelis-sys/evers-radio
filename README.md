# Ever's Radio

Spotify-driven music visualizer. Butterchurn presets, brand-adaptive chrome, designed for the big screen.

## Setup

1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Add redirect URI: `https://evergavelis-sys.github.io/evers-radio/` (and `http://127.0.0.1:8000/` for local dev)
3. Copy Client ID
4. `cp config.js.template config.js`
5. Paste Client ID into `config.js`
6. Open `index.html` in a browser — for local dev, serve it (Spotify auth needs a real origin):
   ```
   python3 -m http.server 8000
   ```
   then visit `http://127.0.0.1:8000/`
7. Click Authorize
8. Press `F` for fullscreen

## Controls

- `F` — toggle fullscreen
- `N` / `→` — next preset
- `P` / `←` — previous preset
- `R` — random preset
- `L` — lock current preset (disable auto-cycle)
- `A` — cycle album-art mode (Intro → Always → Faded → Off)
- `M` — toggle toggle-bar visibility (otherwise auto-hides on mouseidle)

## Architecture (v0.1)

Metadata-driven — no DRM-restricted audio required.

- Poll Spotify `currently-playing` every 3s
- On track change, fetch `audio-analysis` + `audio-features`, cache by track id
- Interpolate current beat/segment/section locally at 100ms
- Synthesize FFT from segment loudness + timbre, feed Butterchurn analyser
- Cycle preset on track change, on Spotify section boundary, or on 60s fallback

## Roadmap

- v0.1 — metadata-driven visualizer (current)
- v0.2 — system audio capture mode (BlackHole on Mac)
- v0.3 — multi-source: Apple Music, YouTube Music
- v0.4 — preset editor, custom presets

## Brand

Part of the E15 umbrella. Cyan = live, mint = shipped. Never pure black, never pure white.
See [E15 Brand System](https://github.com/evergavelis-sys/e15-vault/blob/main/brand/BRAND.md) (private).

---

© 2026 Ever Gavelis / E15 Umbrella. All rights reserved.
