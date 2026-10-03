import type { Track } from "./ranking";

const ACCOUNTS = "https://accounts.spotify.com", API = "https://api.spotify.com/v1";
// Minimum scopes: read Liked Songs, list own playlists, edit own private playlists, upload playlist covers.
export const SCOPES = "user-library-read playlist-read-private playlist-modify-private ugc-image-upload";
export const MARKER = "Managed by VR Spotify Organizer";
export const redirectUri = () => `${location.origin}/callback`;

interface Tokens { access: string; refresh?: string; expiresAt: number }
const readTokens = (): Tokens | null => { try { return JSON.parse(sessionStorage.getItem("vr-tokens") ?? "null"); } catch { return null; } };
export const hasTokens = () => !!readTokens();
export const clearTokens = () => sessionStorage.removeItem("vr-tokens");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  let s = ""; new Uint8Array(buf as ArrayBuffer).forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const rand = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

// PKCE login: no client secret is needed or used.
export async function startLogin(clientId: string) {
  const verifier = rand(64), state = rand(16);
  sessionStorage.setItem("vr-pkce", JSON.stringify({ verifier, state }));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  location.href = `${ACCOUNTS}/authorize?` + new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirectUri(), scope: SCOPES,
    code_challenge_method: "S256", code_challenge: challenge, state,
  });
}

async function token(clientId: string, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...body }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify login failed: ${j.error_description || j.error || res.status}`);
  const t: Tokens = { access: j.access_token, refresh: j.refresh_token ?? body.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 };
  sessionStorage.setItem("vr-tokens", JSON.stringify(t));
  return t;
}

export async function finishLogin(clientId: string, code: string, state: string) {
  let p: { verifier: string; state: string } | null = null;
  try { p = JSON.parse(sessionStorage.getItem("vr-pkce") ?? "null"); } catch { /* ignore */ }
  if (!p || p.state !== state) throw new Error("Login state mismatch. Click Connect Spotify to try again.");
  await token(clientId, { grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: p.verifier });
  sessionStorage.removeItem("vr-pkce");
}

export async function api(clientId: string, path: string, init: { method?: string; body?: unknown; raw?: string } = {}): Promise<any> {
  const tk = readTokens();
  if (!tk) throw new Error("Not connected to Spotify.");
  const refresh = async () => {
    if (!tk.refresh) throw new Error("Session expired. Connect Spotify again.");
    Object.assign(tk, await token(clientId, { grant_type: "refresh_token", refresh_token: tk.refresh }));
  };
  if (tk.expiresAt - 60_000 < Date.now()) await refresh();
  let retried401 = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API + path, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${tk.access}`, ...(init.body ? { "Content-Type": "application/json" } : init.raw ? { "Content-Type": "image/jpeg" } : {}) },
      body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
    });
    if (res.status === 429) { await sleep((Number(res.headers.get("retry-after")) || 2) * 1000 + 250); continue; }
    if (res.status === 401 && !retried401) { retried401 = true; await refresh(); continue; }
    if (res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 403 ? " (403: the Spotify app owner needs Premium, and your account must be listed under User Management in your Spotify app)" : "";
      throw new Error(`Spotify ${res.status} on ${init.method ?? "GET"} ${path.split("?")[0]}: ${text.slice(0, 200)}${hint}`);
    }
    return text ? JSON.parse(text) : {};
  }
  throw new Error(`Spotify kept failing on ${path.split("?")[0]} (rate limit or server error). Try again shortly.`);
}

export const getMe = (cid: string) => api(cid, "/me");

export async function getLikedTracks(cid: string, onProgress: (n: number, total: number) => void) {
  const seen = new Map<string, Omit<Track, "playcount" | "listeners" | "tags">>();
  let skipped = 0, url: string | null = "/me/tracks?limit=50&offset=0";
  while (url) {
    const page: any = await api(cid, url);
    for (const it of page.items ?? []) {
      const t = it.track;
      if (!t || !t.id || t.is_local || t.type !== "track") { skipped++; continue; }   // deleted / local / unavailable
      if (!seen.has(t.id)) seen.set(t.id, { id: t.id, uri: t.uri, name: t.name, artist: t.artists?.[0]?.name ?? "", album: t.album?.name ?? "", addedAt: it.added_at ?? "", released: t.album?.release_date ?? "" });
    }
    onProgress(seen.size + skipped, page.total ?? 0);
    url = page.next ? page.next.replace(API, "") : null;
  }
  return { tracks: [...seen.values()], skipped };
}

export async function listMyPlaylists(cid: string) {
  const out: { id: string; name: string; description: string | null; ownerId: string }[] = [];
  let url: string | null = "/me/playlists?limit=50&offset=0";
  while (url) {
    const page: any = await api(cid, url);
    for (const p of page.items ?? []) if (p) out.push({ id: p.id, name: p.name, description: p.description, ownerId: p.owner?.id });
    url = page.next ? page.next.replace(API, "") : null;
  }
  return out;
}

export const createPlaylist = (cid: string, name: string) =>
  api(cid, "/me/playlists", { method: "POST", body: { name, public: false, description: `${MARKER}. Ranked by Last.fm global listening counts.` } });

// Replaces contents (first 100 via PUT, the rest via POST in batches of 100).
export async function setPlaylistItems(cid: string, id: string, uris: string[]) {
  await api(cid, `/playlists/${id}/items`, { method: "PUT", body: { uris: uris.slice(0, 100) } });
  for (let i = 100; i < uris.length; i += 100) await api(cid, `/playlists/${id}/items`, { method: "POST", body: { uris: uris.slice(i, i + 100) } });
}
// Cover art: base64 JPEG under 256 KB.
export const setPlaylistCover = (cid: string, id: string, base64Jpeg: string) => api(cid, `/playlists/${id}/images`, { method: "PUT", raw: base64Jpeg });
