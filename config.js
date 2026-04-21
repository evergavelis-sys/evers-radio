// config.js — shared config for ever's radio.
//
// HOW TO SET UP:
//   1. Go to https://developer.spotify.com/dashboard and open your app
//      (or create one). Copy the Client ID from Settings → Basic Information.
//   2. Replace 'PASTE_CLIENT_ID_HERE' below.
//   3. In that same Spotify app, under Settings → Redirect URIs, add BOTH:
//        https://evergavelis-sys.github.io/evers-radio/
//        http://127.0.0.1:8000/
//      (exact match, including trailing slash).
//   4. Under "User Management", add the Spotify account email of each
//      friend who will be testing. Spotify dev-mode caps this at ~25 users.
//
// SECURITY NOTE: PKCE has no client secret, so this file is safe to commit.
// The Client ID is sent in the browser's URL bar during auth anyway.
// All security relies on the redirect-URI whitelist above.

window.CONFIG = {
    SPOTIFY_CLIENT_ID: '0c9dbd7cb5bd4b13ade1a4f3899af292',

    REDIRECT_URIS: {
      prod:  'https://evergavelis-sys.github.io/evers-radio/',
            local: 'http://127.0.0.1:8000/'
        },

  SCOPES: [
        'user-read-currently-playing',
        'user-read-playback-state'
      ],

      // Spotify rate-limits ~180 req/min per user token.
      POLL_CURRENTLY_PLAYING_MS: 3000,
      LOCAL_INTERP_TICK_MS: 100,

      // Visualizer behavior — can be flipped at runtime via the toggle bar.
      CYCLE_ON_TRACK_CHANGE: true,
      CYCLE_ON_SECTION_BOUNDARY: true,
      AUTO_CYCLE_FALLBACK_MS: 60000,

      // Album-art card initial mode: 'intro' | 'always' | 'faded' | 'off'
      ALBUM_ART_MODE: 'intro',
      ALBUM_ART_INTRO_HOLD_MS: 8000,
      ALBUM_ART_FADE_IN_MS: 500,
      ALBUM_ART_FADE_OUT_MS: 1500
    };
