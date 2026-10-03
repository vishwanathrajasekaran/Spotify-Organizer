import { createPlaylist, getLikedTracks, listMyPlaylists, MARKER, setPlaylistCover, setPlaylistItems } from "./spotify";
import { lastfmKey, lookupAll, lookupExact } from "./lastfm";
import { load, save, type Cfg } from "./storage";
import type { Group, Track } from "./ranking";

type Overrides = Record<string, { artist: string; name: string }>;

export async function analyze(cfg: Cfg, onProgress: (phase: string, done: number, total: number) => void) {
  const overrides = load<Overrides>("vr-overrides", {});
  const { tracks, skipped } = await getLikedTracks(cfg.clientId, (n, t) => onProgress("Reading Liked Songs", n, t));
  const lk = (t: { id: string; artist: string; name: string }) => overrides[t.id] ?? t;
  const phase = "Matching Last.fm listening counts";
  onProgress(phase, 0, tracks.length);
  const found = await lookupAll(tracks.map(lk), cfg.lastfmKey, (d) => onProgress(phase, d, tracks.length));
  const library: Track[] = tracks.map((t) => {
    const o = lk(t), f = found.get(lastfmKey(o.artist, o.name));
    return { ...t, playcount: f?.playcount ?? null, listeners: f?.listeners ?? null, tags: f?.tags ?? [] };
  });
  return { library, skipped };
}

export async function fixMatch(cfg: Cfg, t: Track, artist: string, name: string) {
  const e = await lookupExact(cfg.lastfmKey, artist, name);
  if (!e) throw new Error("Last.fm has no data for that match.");
  const ov = load<Overrides>("vr-overrides", {}); ov[t.id] = { artist, name }; save("vr-overrides", ov);
  return e;
}

const snapKey = (uid: string) => `vr-applied-${uid}`;
export function computeDiff(uid: string, groups: Group[]) {
  const prev = load<Record<string, string[]> | null>(snapKey(uid), null);
  if (!prev) return null;
  const prevOf = new Map<string, string>(), curOf = new Map<string, string>();
  for (const [g, ids] of Object.entries(prev)) ids.forEach((id) => prevOf.set(id, g));
  const perGroup: Record<string, { in: number; out: number }> = {};
  for (const g of groups) {
    const before = new Set(prev[g.name] ?? []), now = new Set(g.tracks.map((t) => t.id));
    now.forEach((id) => curOf.set(id, g.name));
    perGroup[g.name] = { in: [...now].filter((id) => !before.has(id)).length, out: [...before].filter((id) => !now.has(id)).length };
  }
  let moved = 0, added = 0, removed = 0;
  for (const [id, g] of curOf) { const p = prevOf.get(id); if (!p) added++; else if (p !== g) moved++; }
  for (const id of prevOf.keys()) if (!curOf.has(id)) removed++;
  return { perGroup, moved, added, removed };
}
export type Diff = NonNullable<ReturnType<typeof computeDiff>>;

export function insights(lib: Track[]) {
  const pcs = lib.filter((t) => t.playcount !== null).sort((a, b) => b.playcount! - a.playcount!);
  if (!pcs.length) return null;
  // Scores: average log-scaled playcount against a reference (100 = every song is as popular as the reference)
  const max = pcs[0].playcount!;
  const avgLog = (ref: number) => Math.round((100 * pcs.reduce((a, t) => a + Math.min(1, Math.log10(t.playcount! + 1) / Math.log10(ref + 1)), 0)) / pcs.length);
  const buckets: [string, number, number][] = [["Under 1K", 0, 1e3], ["1K to 10K", 1e3, 1e4], ["10K to 100K", 1e4, 1e5], ["100K to 1M", 1e5, 1e6], ["1M to 10M", 1e6, 1e7], ["10M+", 1e7, Infinity]];
  const top = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }));
  const mini = (a: Track[]) => a.slice(0, 5).map((t) => ({ name: t.name, artist: t.artist, playcount: t.playcount }));
  return {
    score: avgLog(max), abs: avgLog(5e7), max, median: pcs[Math.floor(pcs.length / 2)].playcount!,
    dist: buckets.map(([label, lo, hi]) => ({ label, count: pcs.filter((t) => t.playcount! >= lo && t.playcount! < hi).length })),
    artists: top(lib.map((t) => t.artist)), tags: top(lib.flatMap((t) => t.tags.slice(0, 1))),
    mainstream: mini(pcs), obscure: mini([...pcs].reverse()),
  };
}
export type Ins = NonNullable<ReturnType<typeof insights>>;

export interface Step { name: string; state: "pending" | "working" | "done" | "error"; message?: string; created?: boolean }
export interface ApplyJob { status: "idle" | "running" | "done" | "error"; error?: string; steps?: Step[]; leftover?: string[] }

// Only creates/updates playlists this app created (marker in the description). Liked Songs are never changed.
export async function applyPlan(cfg: Cfg, uid: string, groups: Group[], covers: Record<string, string>, onUpdate: (j: ApplyJob) => void) {
  const steps: Step[] = groups.map((g) => ({ name: g.name, state: "pending" }));
  const job: ApplyJob = { status: "running", steps };
  const push = () => onUpdate({ ...job, steps: steps.map((s) => ({ ...s })) });
  push();
  try {
    const mine = (await listMyPlaylists(cfg.clientId)).filter((p) => p.ownerId === uid);
    const snapshot: Record<string, string[]> = {};
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i], step = steps[i];
      step.state = "working"; push();
      try {
        const same = mine.filter((p) => p.name === g.name);
        const managed = same.find((p) => p.description?.includes(MARKER));
        if (!managed && same.length) throw new Error("A playlist with this name already exists that this app didn't create. Rename it in Spotify or choose another name here, then run again.");
        const id = managed?.id ?? (await createPlaylist(cfg.clientId, g.name)).id;
        step.created = !managed;
        await setPlaylistItems(cfg.clientId, id, g.tracks.map((t) => t.uri));
        snapshot[g.name] = g.tracks.map((t) => t.id);
        step.state = "done";
        if (covers[g.name]) await setPlaylistCover(cfg.clientId, id, covers[g.name]).catch((e) => { step.message = `Songs updated, cover not uploaded: ${e.message}`; });
      } catch (e: any) { step.state = "error"; step.message = e.message; }
      push();
    }
    job.leftover = mine.filter((p) => p.description?.includes(MARKER) && !groups.some((g) => g.name === p.name)).map((p) => p.name);
    if (Object.keys(snapshot).length) save(snapKey(uid), snapshot);
    job.status = "done";
  } catch (e: any) { job.status = "error"; job.error = e.message; }
  push();
}
