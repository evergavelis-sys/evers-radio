// spotify.js
// PKCE auth + currently-playing polling + audio-analysis/features fetching.
// Token and PKCE verifier live in sessionStorage (wiped on tab close) — the
// only state that needs to survive a redirect is the verifier, which is
// single-use and cleared after exchange.

(function () {
  const AUTH_URL = 'https://accounts.spotify.com/authorize';
  const TOKEN_URL = 'https://accounts.spotify.com/api/token';
  const API = 'https://api.spotify.com/v1';

  const SS_VERIFIER = 'er_pkce_verifier';
  const SS_TOKEN = 'er_access_token';
  const SS_TOKEN_EXPIRES = 'er_access_token_expires';
  const SS_REFRESH = 'er_refresh_token';

  function pickRedirect() {
    const origin = window.location.origin + window.location.pathname;
    const reds = window.CONFIG.REDIRECT_URIS;
    // Match on origin+path exactly — Spotify requires it.
    if (origin === reds.prod) return reds.prod;
    if (origin === reds.local) return reds.local;
    // Fall back to local if origin starts with 127.0.0.1
    if (origin.startsWith('http://127.0.0.1')) return reds.local;
    return reds.prod;
  }

  // --- PKCE helpers ---

  function randString(len) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    return Array.from(bytes, b => alpha[b % alpha.length]).join('');
  }

  async function sha256b64url(input) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    let s = '';
    const bytes = new Uint8Array(hash);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function beginAuth() {
    const verifier = randString(96);
    const challenge = await sha256b64url(verifier);
    sessionStorage.setItem(SS_VERIFIER, verifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: window.CONFIG.SPOTIFY_CLIENT_ID,
      scope: window.CONFIG.SCOPES.join(' '),
      redirect_uri: pickRedirect(),
      code_challenge_method: 'S256',
      code_challenge: challenge
    });
    window.location.href = `${AUTH_URL}?${params.toString()}`;
  }

  async function exchangeCodeIfPresent() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) return false;
    const verifier = sessionStorage.getItem(SS_VERIFIER);
    if (!verifier) {
      console.warn('spotify: code present but no verifier — did sessionStorage get wiped?');
      return false;
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pickRedirect(),
      client_id: window.CONFIG.SPOTIFY_CLIENT_ID,
      code_verifier: verifier
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) {
      console.error('spotify: token exchange failed', await res.text());
      return false;
    }
    const json = await res.json();
    storeToken(json);
    sessionStorage.removeItem(SS_VERIFIER);
    // Clean the ?code= from the URL so a refresh doesn't re-exchange.
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    return true;
  }

  function storeToken({ access_token, expires_in, refresh_token }) {
    sessionStorage.setItem(SS_TOKEN, access_token);
    sessionStorage.setItem(SS_TOKEN_EXPIRES, String(Date.now() + (expires_in * 1000) - 15000));
    if (refresh_token) sessionStorage.setItem(SS_REFRESH, refresh_token);
  }

  function hasValidToken() {
    const t = sessionStorage.getItem(SS_TOKEN);
    const exp = Number(sessionStorage.getItem(SS_TOKEN_EXPIRES) || 0);
    return !!t && Date.now() < exp;
  }

  async function refreshIfNeeded() {
    if (hasValidToken()) return true;
    const refresh = sessionStorage.getItem(SS_REFRESH);
    if (!refresh) return false;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: window.CONFIG.SPOTIFY_CLIENT_ID
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) { clearAuth(); return false; }
    storeToken(await res.json());
    return true;
  }

  function clearAuth() {
    sessionStorage.removeItem(SS_TOKEN);
    sessionStorage.removeItem(SS_TOKEN_EXPIRES);
    sessionStorage.removeItem(SS_REFRESH);
    sessionStorage.removeItem(SS_VERIFIER);
  }

  async function apiGet(path) {
    if (!(await refreshIfNeeded())) return { error: 'unauthenticated' };
    const res = await fetch(`${API}${path}`, {
      headers: { 'Authorization': 'Bearer ' + sessionStorage.getItem(SS_TOKEN) }
    });
    if (res.status === 204) return { empty: true };
    if (res.status === 429) {
      const retry = Number(res.headers.get('Retry-After') || 5);
      return { error: 'rate-limited', retryAfter: retry };
    }
    if (!res.ok) return { error: `http-${res.status}` };
    return { data: await res.json() };
  }

  // --- High-level endpoints ---

  const analysisCache = new Map();
  const featuresCache = new Map();

  async function currentlyPlaying() {
    return apiGet('/me/player/currently-playing?additional_types=track');
  }

  async function audioAnalysis(trackId) {
    if (analysisCache.has(trackId)) return { data: analysisCache.get(trackId) };
    const r = await apiGet(`/audio-analysis/${trackId}`);
    if (r.data) analysisCache.set(trackId, r.data);
    return r;
  }

  async function audioFeatures(trackId) {
    if (featuresCache.has(trackId)) return { data: featuresCache.get(trackId) };
    const r = await apiGet(`/audio-features/${trackId}`);
    if (r.data) featuresCache.set(trackId, r.data);
    return r;
  }

  window.Spotify = {
    beginAuth,
    exchangeCodeIfPresent,
    hasValidToken,
    refreshIfNeeded,
    clearAuth,
    currentlyPlaying,
    audioAnalysis,
    audioFeatures,
    pickRedirect
  };
})();
