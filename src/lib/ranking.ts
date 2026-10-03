// Pure planning logic: no Spotify, no UI, no network.
export interface Track { id: string; uri: string; name: string; artist: string; album: string; addedAt: string; released: string; playcount: number | null; listeners: number | null; tags: string[] }
export type RankedTrack = Track & { rank: number };
export interface Group { key: string; name: string; tracks: RankedTrack[] }
export interface Options {
  metric: "playcount" | "listeners"; mode: "ranges" | "tiers" | "released" | "added" | "genre";
  groupSize: number; naming: "range" | "numbered" | "tier"; order: "rank" | "shuffle" | "newest" | "oldest";
  artists: string[]; album: string; tag: string;
  renames: Record<string, string>;   // default group name -> your own playlist name
}
export const defaultOptions: Options = { metric: "playcount", mode: "ranges", groupSize: 50, naming: "range", order: "rank", artists: [], album: "", tag: "", renames: {} };

export function cleanOptions(x: any): Options {
  const pick = <T extends string>(v: any, allowed: readonly T[], f: T): T => (allowed.includes(v) ? v : f);
  const str = (v: any) => (typeof v === "string" ? v.slice(0, 100) : "");
  const d = defaultOptions;
  const renames: Record<string, string> = {};
  if (x?.renames && typeof x.renames === "object") for (const [k, v] of Object.entries(x.renames).slice(0, 300)) if (typeof v === "string") renames[k.slice(0, 100)] = v.slice(0, 100);
  return {
    metric: pick(x?.metric, ["playcount", "listeners"] as const, d.metric),
    mode: pick(x?.mode, ["ranges", "tiers", "released", "added", "genre"] as const, d.mode),
    groupSize: [25, 50, 100].includes(Number(x?.groupSize)) ? Number(x.groupSize) : d.groupSize,
    naming: pick(x?.naming, ["range", "numbered", "tier"] as const, d.naming),
    order: pick(x?.order, ["rank", "shuffle", "newest", "oldest"] as const, d.order),
    artists: Array.isArray(x?.artists) ? x.artists.slice(0, 500).map(str).filter(Boolean) : [],
    album: str(x?.album), tag: str(x?.tag), renames,
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function reorder(tr: RankedTrack[], order: Options["order"]): RankedTrack[] {
  if (order === "rank") return tr;
  const a = [...tr];
  if (order === "shuffle") {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  return a.sort((x, y) => (order === "newest" ? cmp(y.addedAt, x.addedAt) : cmp(x.addedAt, y.addedAt)));
}

// Ranking tie-breaks: value desc, name asc, artist asc, Spotify id asc.
export function buildPlan(all: Track[], o: Options) {
  const has = (v: string, q: string) => !q || v.toLowerCase().includes(q.toLowerCase());
  const pool = all.filter((t) =>
    (!o.artists.length || o.artists.includes(t.artist)) && has(t.album, o.album) && (!o.tag || t.tags.some((g) => has(g, o.tag))));
  const val = (t: Track) => t[o.metric];
  const ranked = pool.filter((t) => val(t) !== null).sort((a, b) =>
    (val(b)! - val(a)!) || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.artist.toLowerCase(), b.artist.toLowerCase()) || cmp(a.id, b.id));
  const unranked = pool.filter((t) => val(t) === null).sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id));
  const rt: RankedTrack[] = ranked.map((t, i) => ({ ...t, rank: i + 1 }));

  let raw: { key: string; tracks: RankedTrack[] }[] = [];
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
  } else if (o.mode === "released" || o.mode === "added") {
    const by = new Map<number, RankedTrack[]>();
    for (const t of rt) {
      const y = o.mode === "released" ? parseInt(t.released.slice(0, 4), 10) : new Date(t.addedAt).getFullYear();
      if (Number.isFinite(y)) by.set(y, [...(by.get(y) ?? []), t]);
    }
    raw = [...by.entries()].sort((a, b) => b[0] - a[0]).map(([y, tracks]) => ({ key: o.mode === "released" ? `Songs from ${y}` : `Liked in ${y}`, tracks }));
  } else {
    const by = new Map<string, RankedTrack[]>();
    for (const t of rt) { const g = t.tags[0]?.toLowerCase() ?? ""; by.set(g, [...(by.get(g) ?? []), t]); }
    const other: RankedTrack[] = [...(by.get("") ?? [])]; by.delete("");
    const big: { key: string; tracks: RankedTrack[] }[] = [];
    for (const [g, tracks] of by) (tracks.length >= 3 ? big.push({ key: titleCase(g).slice(0, 90), tracks }) : other.push(...tracks));
    raw = big.sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 30);
    for (const g of big.slice(30)) other.push(...g.tracks);
    if (other.length) raw.push({ key: "Other", tracks: other.sort((a, b) => a.rank - b.rank) });
  }
  const seen = new Map<string, number>();
  const groups: Group[] = raw.map((g) => {
    const base = (o.renames[g.key]?.trim() || g.key).slice(0, 100);
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { key: g.key, name: n > 1 ? `${base} (${n})` : base, tracks: reorder(g.tracks, o.order) };
  });
  return { groups, unranked, rankedCount: rt.length, filteredOut: all.length - pool.length };
}
