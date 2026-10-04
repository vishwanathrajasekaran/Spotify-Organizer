import { load, save } from "./storage";

export type Entry = { playcount: number; listeners: number; tags: string[] } | null;
const BASE = `${import.meta.env.BASE_URL}lastfm/2.0`;   // proxied to https://ws.audioscrobbler.com/2.0/ (see vite.config.ts and vercel.json)
const cache: Record<string, Entry> = load("vr-lastfm", {});
const persist = () => save("vr-lastfm", cache);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const lastfmKey = (artist: string, name: string) => `${artist}|${name}`.toLowerCase();
// "Song - Remastered 2011" / "Song (feat. X)" -> "Song"
const clean = (n: string) => n.replace(/\s+-\s+.*$/, "").replace(/\s*[\(\[].*?[\)\]]/g, "").trim();

async function call(params: Record<string, string>): Promise<any> {
  const res = await fetch(`${BASE}?` + new URLSearchParams({ ...params, format: "json" }));
  if (res.status === 429) return { error: 29 };
  if (!(res.headers.get("content-type") ?? "").includes("json"))
    throw new Error("Could not reach Last.fm through the /lastfm proxy. See the Troubleshooting section of the README.");
  return res.json().catch(() => ({}));
}

async function query(apiKey: string, artist: string, track: string): Promise<Entry | "retry"> {
  const body = await call({ method: "track.getInfo", api_key: apiKey, artist, track, autocorrect: "1" });
  if (body.error === 6) return null;
  if ([29, 11, 16].includes(body.error)) return "retry";
  if (body.error) throw new Error(`Last.fm error ${body.error}: ${body.message}`);
  const pc = Number(body.track?.playcount), ls = Number(body.track?.listeners);
  if (!Number.isFinite(pc)) return null;
  const tags: string[] = (body.track?.toptags?.tag ?? []).slice(0, 5).map((t: any) => String(t.name).toLowerCase());
  return { playcount: pc, listeners: Number.isFinite(ls) ? ls : 0, tags };
}

async function lookupOne(apiKey: string, artist: string, name: string, fuzzy = true): Promise<Entry> {
  const candidates = (fuzzy ? [name, clean(name)] : [name]).filter((v, i, a) => v && a.indexOf(v) === i);
  for (const cand of candidates) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await query(apiKey, artist, cand);
      if (r === "retry") { await sleep(1500 * (attempt + 1)); continue; }
      if (r) return r;
      break;
    }
  }
  return null;
}

// Looks up every track at a gentle rate (~4/s). Results (with tags) are cached in this browser.
export async function lookupAll(items: { artist: string; name: string }[], apiKey: string, onProgress: (done: number) => void) {
  const out = new Map<string, Entry>();
  const st = { done: 0, next: 0, since: 0, fails: 0, fatal: null as Error | null };
  const worker = async () => {
    while (st.next < items.length && !st.fatal) {
      const it = items[st.next++], k = lastfmKey(it.artist, it.name), hit = cache[k];
      if (k in cache && !(hit && !hit.tags)) out.set(k, hit);   // old cache entries without tags are refreshed once
      else {
        try { cache[k] = await lookupOne(apiKey, it.artist, it.name); out.set(k, cache[k]); st.fails = 0; }
        catch (e: any) { out.set(k, null); if (++st.fails >= 8) st.fatal = e; }   // a few failures never abort the run
        await sleep(400);
        if (++st.since >= 50) { persist(); st.since = 0; }
      }
      onProgress(++st.done);
    }
  };
  await Promise.all([worker(), worker()]);
  persist();
  if (st.fatal) throw st.fatal;
  return out;
}

export async function lookupExact(apiKey: string, artist: string, name: string) {
  const e = await lookupOne(apiKey, artist, name, false);
  if (e) { cache[lastfmKey(artist, name)] = e; persist(); }
  return e;
}

export async function searchTracks(apiKey: string, q: string) {
  const body = await call({ method: "track.search", limit: "8", api_key: apiKey, track: q });
  const list: any[] = body.results?.trackmatches?.track ?? [];
  return list.map((t) => ({ artist: String(t.artist), name: String(t.name), listeners: Number(t.listeners) || 0 }));
}

export async function validateKey(apiKey: string): Promise<boolean> {
  const body = await call({ method: "chart.gettopartists", limit: "1", api_key: apiKey });
  return body.error !== 10 && body.error !== 26;
}
