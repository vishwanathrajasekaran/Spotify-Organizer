// Pure planning logic: no Spotify, no UI, no network.
export interface Track { id: string; uri: string; name: string; artist: string; album: string; albumId: string; trackNo: number; addedAt: string; released: string; playcount: number | null; listeners: number | null; tags: string[] }
export type RankedTrack = Track & { rank: number };   // rank 0 = not ranked (no Last.fm match)
export interface Group { key: string; name: string; tracks: RankedTrack[] }
export interface Options {
  metric: "playcount" | "listeners";
  mode: "ranges" | "tiers" | "released" | "releasedDecade" | "added" | "addedDecade" | "album";
  groupSize: number; naming: "range" | "numbered" | "tier"; order: "rank" | "shuffle" | "newest" | "oldest" | "album";
  artists: string[]; albums: string[]; releaseDecades: string[]; addedDecades: string[];
  minAlbumSongs: number;
  renames: Record<string, string>;   // default group name -> your own playlist name
}
export const defaultOptions: Options = { metric: "playcount", mode: "ranges", groupSize: 50, naming: "range", order: "rank", artists: [], albums: [], releaseDecades: [], addedDecades: [], minAlbumSongs: 3, renames: {} };

export function cleanOptions(x: any): Options {
  const pick = <T extends string>(v: any, allowed: readonly T[], f: T): T => (allowed.includes(v) ? v : f);
  const str = (v: any) => (typeof v === "string" ? v.slice(0, 100) : "");
  const list = (v: any) => (Array.isArray(v) ? v.slice(0, 1000).map(str).filter(Boolean) : []);
  const d = defaultOptions;
  const renames: Record<string, string> = {};
  if (x?.renames && typeof x.renames === "object") for (const [k, v] of Object.entries(x.renames).slice(0, 300)) if (typeof v === "string") renames[k.slice(0, 100)] = v.slice(0, 100);
  return {
    metric: pick(x?.metric, ["playcount", "listeners"] as const, d.metric),
    mode: pick(x?.mode, ["ranges", "tiers", "released", "releasedDecade", "added", "addedDecade", "album"] as const, d.mode),
    groupSize: [25, 50, 100].includes(Number(x?.groupSize)) ? Number(x.groupSize) : d.groupSize,
    naming: pick(x?.naming, ["range", "numbered", "tier"] as const, d.naming),
    order: pick(x?.order, ["rank", "shuffle", "newest", "oldest", "album"] as const, d.order),
    artists: list(x?.artists), albums: list(x?.albums), releaseDecades: list(x?.releaseDecades), addedDecades: list(x?.addedDecades),
    minAlbumSongs: [2, 3, 5, 10].includes(Number(x?.minAlbumSongs)) ? Number(x.minAlbumSongs) : d.minAlbumSongs,
    renames,
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const year = (s: string) => { const y = parseInt(s.slice(0, 4), 10); return Number.isFinite(y) ? y : null; };
const decadeOf = (s: string) => { const y = year(s); return y === null ? "" : String(Math.floor(y / 10) * 10); };
export const releaseDecade = (t: Track) => decadeOf(t.released);
export const addedDecade = (t: Track) => decadeOf(t.addedAt);

function reorder(tr: RankedTrack[], order: Options["order"]): RankedTrack[] {
  if (order === "rank") return tr;
  const a = [...tr];
  if (order === "shuffle") {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  if (order === "album") return a.sort((x, y) => x.trackNo - y.trackNo);
  return a.sort((x, y) => (order === "newest" ? cmp(y.addedAt, x.addedAt) : cmp(x.addedAt, y.addedAt)));
}

// Ranking tie-breaks: value desc, name asc, artist asc, Spotify id asc.
export function buildPlan(all: Track[], o: Options) {
  const pool = all.filter((t) =>
    (!o.artists.length || o.artists.includes(t.artist)) && (!o.albums.length || o.albums.includes(t.albumId)) &&
    (!o.releaseDecades.length || o.releaseDecades.includes(releaseDecade(t))) && (!o.addedDecades.length || o.addedDecades.includes(addedDecade(t))));
  const val = (t: Track) => t[o.metric];
  const ranked = pool.filter((t) => val(t) !== null).sort((a, b) =>
    (val(b)! - val(a)!) || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.artist.toLowerCase(), b.artist.toLowerCase()) || cmp(a.id, b.id));
  const unranked = pool.filter((t) => val(t) === null).sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id));
  const rt: RankedTrack[] = ranked.map((t, i) => ({ ...t, rank: i + 1 }));

  const bucket = (keyOf: (t: RankedTrack) => string, name: (k: string) => string) => {
    const by = new Map<string, RankedTrack[]>();
    for (const t of rt) { const k = keyOf(t); if (k) by.set(k, [...(by.get(k) ?? []), t]); }
    return [...by.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, tracks]) => ({ key: name(k), tracks }));
  };
  let raw: { key: string; tracks: RankedTrack[] }[] = [], skippedAlbums = 0;
  if (o.mode === "ranges") {
    for (let i = 0, n = 1; i < rt.length; i += o.groupSize, n++) {
      const start = i + 1;
      const key = o.naming === "numbered" ? `Batch ${String(n).padStart(2, "0")}` : o.naming === "tier" ? `Tier ${n}`
        : start === 1 ? `Top ${o.groupSize}` : `${start}-${start + o.groupSize - 1}`;
      raw.push({ key, tracks: rt.slice(i, i + o.groupSize) });
    }
  } else if (o.mode === "tiers") {
    let from = 0;
    for (const [label, frac] of [["Mainstream", 0.2], ["Popular", 0.5], ["Deep Cuts", 0.8], ["Hidden Gems", 1]] as const) {
      const to = Math.round(rt.length * frac);
      if (to > from) raw.push({ key: label, tracks: rt.slice(from, to) });
      from = to;
    }
  } else if (o.mode === "released") raw = bucket((t) => String(year(t.released) ?? ""), (k) => `Songs from ${k}`);
  else if (o.mode === "releasedDecade") raw = bucket(releaseDecade, (k) => `Songs from the ${k}s`);
  else if (o.mode === "added") raw = bucket((t) => String(year(t.addedAt) ?? ""), (k) => `Liked in ${k}`);
  else if (o.mode === "addedDecade") raw = bucket(addedDecade, (k) => `Liked in the ${k}s`);
  else {   // one playlist per album (for film songs the album is the movie); unranked songs are included here
    const all2: RankedTrack[] = [...rt, ...unranked.map((t) => ({ ...t, rank: 0 }))];
    const by = new Map<string, RankedTrack[]>();
    for (const t of all2) if (t.albumId) by.set(t.albumId, [...(by.get(t.albumId) ?? []), t]);
    const entries = [...by.values()].filter((ts) => ts.length >= o.minAlbumSongs)
      .sort((a, b) => b.length - a.length || cmp(a[0].album, b[0].album)).slice(0, 50);
    skippedAlbums = by.size - entries.length;
    const dup = new Map<string, number>(); entries.forEach((ts) => dup.set(ts[0].album, (dup.get(ts[0].album) ?? 0) + 1));
    raw = entries.map((ts) => ({ key: (dup.get(ts[0].album)! > 1 ? `${ts[0].album} (${ts[0].artist})` : ts[0].album) || "Unknown album", tracks: ts }));
  }
  const seen = new Map<string, number>();
  const groups: Group[] = raw.map((g) => {
    const base = (o.renames[g.key]?.trim() || g.key).slice(0, 100);
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { key: g.key, name: n > 1 ? `${base} (${n})` : base, tracks: reorder(g.tracks, o.order) };
  });
  return { groups, unranked, rankedCount: rt.length, filteredOut: all.length - pool.length, skippedAlbums, unrankedIncluded: o.mode === "album" };
}
