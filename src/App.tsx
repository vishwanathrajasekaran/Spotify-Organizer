import { useEffect, useMemo, useState, type FormEvent } from "react";
import { buildPlan, cleanOptions, type Group, type Options as Opts, type Track } from "./lib/ranking";
import { clearAll, getCfg, load, save, saveCfg, type Cfg } from "./lib/storage";
import { clearTokens, finishLogin, getMe, hasTokens, redirectUri, startLogin } from "./lib/spotify";
import { searchTracks, validateKey } from "./lib/lastfm";
import { analyze as analyzeLib, applyPlan, computeDiff, fixMatch, insights as makeInsights, type ApplyJob, type Ins, type Step } from "./lib/engine";
import { makeCover } from "./lib/cover";

type T = Track & { rank?: number };
interface Job { status: "idle" | "running" | "done" | "error"; phase?: string; done?: number; total?: number; error?: string }
const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());
const HEX32 = /^[a-f0-9]{32}$/i;

function exportCsv(groups: Group[], unranked: Track[]) {
  const rows: string[][] = [["playlist", "rank", "song", "artist", "album", "year", "added", "playcount", "listeners", "tags"]];
  const add = (pl: string, t: T) => rows.push([pl, String(t.rank ?? ""), t.name, t.artist, t.album, t.released.slice(0, 4), t.addedAt.slice(0, 10), String(t.playcount ?? ""), String(t.listeners ?? ""), t.tags.join("; ")]);
  groups.forEach((g) => g.tracks.forEach((t) => add(g.name, t))); unranked.forEach((t) => add("Unranked", t));
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "ranked-songs.csv"; a.click(); URL.revokeObjectURL(a.href);
}

function Seg<V extends string | number>({ value, options, onChange, label }: { value: V; options: [V, string][]; onChange: (v: V) => void; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button type="button" key={String(v)} className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

type SortKey = "rank" | "name" | "artist" | "released" | "addedAt" | "playcount" | "listeners";
function SongTable({ tracks, q }: { tracks: T[]; q: string }) {
  const [key, setKey] = useState<SortKey>("rank"); const [asc, setAsc] = useState(true);
  const needle = q.trim().toLowerCase();
  const val = (t: T): any => (key === "name" ? t.name.toLowerCase() : key === "artist" ? t.artist.toLowerCase() : key === "addedAt" ? t.addedAt : key === "released" ? t.released : (t[key] ?? -1));
  const rows = tracks.filter((t) => !needle || `${t.name} ${t.artist} ${t.album} ${t.tags.join(" ")}`.toLowerCase().includes(needle))
    .sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (asc ? 1 : -1));
  const th = (k: SortKey, l: string, n = false) => <th className={n ? "n" : ""} aria-sort={key === k ? (asc ? "ascending" : "descending") : "none"}>
    <button onClick={() => { if (key === k) setAsc(!asc); else { setKey(k); setAsc(true); } }}>{l}{key === k ? (asc ? " ▴" : " ▾") : ""}</button></th>;
  return <div style={{ overflowX: "auto" }}><table><thead><tr>{th("rank", "Rank", true)}{th("name", "Song")}{th("artist", "Artist")}{th("released", "Year")}{th("addedAt", "Added")}{th("playcount", "Plays", true)}{th("listeners", "Listeners", true)}</tr></thead>
    <tbody>{rows.map((t) => <tr key={t.id}><td className="n">{t.rank ?? "—"}</td><td>{t.name}</td><td>{t.artist}</td><td>{t.released.slice(0, 4) || "—"}</td><td>{t.addedAt.slice(0, 10) || "—"}</td><td className="n">{fmt(t.playcount)}</td><td className="n">{fmt(t.listeners)}</td></tr>)}</tbody></table>
    {!rows.length && <p className="dim">No songs match your search.</p>}</div>;
}

function Fix({ t, cfg, onDone }: { t: Track; cfg: Cfg; onDone: (e: { playcount: number; listeners: number; tags: string[] }) => void }) {
  const [q, setQ] = useState(`${t.artist} ${t.name}`);
  const [res, setRes] = useState<{ artist: string; name: string; listeners: number }[] | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const search = async (e: FormEvent) => { e.preventDefault(); setErr(""); setBusy(true); try { setRes(await searchTracks(cfg.lastfmKey, q)); } catch (x: any) { setErr(x.message); } setBusy(false); };
  const pick = async (m: { artist: string; name: string }) => { setErr(""); try { onDone(await fixMatch(cfg, t, m.artist, m.name)); } catch (x: any) { setErr(x.message); } };
  return <div style={{ padding: "10px 0 16px" }}>
    <form className="row" onSubmit={search}><div style={{ flex: 1, minWidth: 200 }}><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Last.fm" /></div><button className="btn sky small" disabled={busy}>Search Last.fm</button></form>
    {err && <p className="err">{err}</p>}
    {res && <ul className="plain">{res.map((m, i) => <li className="match row between" key={i}><span>{m.name} <span className="dim">by {m.artist} · {fmt(m.listeners)} listeners</span></span><button className="btn mint small" onClick={() => pick(m)}>Use this match</button></li>)}{!res.length && <li className="dim">No results. Try a shorter search.</li>}</ul>}
  </div>;
}

function Bars({ items }: { items: { label: string; count: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return <div className="bars">{items.map((i) => <div className="brow" key={i.label}><span title={i.label}>{i.label}</span><div className="meter"><i style={{ width: `${(i.count / max) * 100}%` }} /></div><span>{i.count}</span></div>)}</div>;
}
function Insights({ ins }: { ins: Ins }) {
  const list = (t: string, a: Ins["mainstream"]) => <div className="card clay"><b>{t}</b><ol>{a.map((m, i) => <li key={i}>{m.name} <span className="dim">· {m.artist} · {fmt(m.playcount)} plays</span></li>)}</ol></div>;
  return <>
    <div className="stats">
      <div className="tile clay"><b>{ins.score}/100</b>Mainstream score (vs your top song)</div>
      <div className="tile clay"><b>{ins.abs}/100</b>Score on the 50M scale</div>
      <div className="tile clay"><b>{fmt(ins.median)}</b>Median plays per song</div>
    </div>
    <p className="dim">The main score compares each song's plays (log scale) with your most popular song, which has {fmt(ins.max)} plays. 100 means every song is as popular as your top one. The 50M score uses a fixed 50 million plays as the top, so it is easier to compare with other libraries.</p>
    <h2>How popular are your songs?</h2><div className="card clay"><Bars items={ins.dist} /></div>
    <div className="opts"><div><h2 style={{ marginTop: 0 }}>Top artists in your library</h2><div className="card clay"><Bars items={ins.artists} /></div></div>
      {ins.tags.length > 0 && <div><h2 style={{ marginTop: 0 }}>Top genres</h2><div className="card clay"><Bars items={ins.tags} /></div></div>}</div>
    <div className="opts">{list("Most mainstream", ins.mainstream)}{list("Most obscure", ins.obscure)}</div>
  </>;
}

function ArtistPicker({ list, value, onChange }: { list: { name: string; count: number }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState("");
  const shown = list.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const toggle = (n: string) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n]);
  return <div className="fld">Only these artists<div style={{ position: "relative" }}>
    <button type="button" className="btn pick" onClick={() => setOpen(!open)} aria-expanded={open}>{value.length ? `${value.length} selected` : "All artists"} ▾</button>
    {open && <div className="pop clay">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search artists" autoFocus />
      <div className="poplist">{shown.map((a) => <label className="check" key={a.name}><input type="checkbox" checked={value.includes(a.name)} onChange={() => toggle(a.name)} />{a.name} <span className="dim">({a.count})</span></label>)}</div>
      <div className="row"><button type="button" className="btn small" onClick={() => onChange([])}>Clear</button><button type="button" className="btn mint small" onClick={() => setOpen(false)}>Done</button></div>
    </div>}
  </div></div>;
}

function Setup({ onSaved }: { onSaved: (c: Cfg) => void }) {
  const [clientId, setClientId] = useState(""); const [lastfmKey, setLastfmKey] = useState("");
  const [remember, setRemember] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const uri = redirectUri();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const c = { clientId: clientId.trim(), lastfmKey: lastfmKey.trim() };
    if (!HEX32.test(c.clientId)) return setErr("The Spotify Client ID should be 32 letters and numbers. Copy it again from your Spotify app's Settings.");
    if (!HEX32.test(c.lastfmKey)) return setErr("The Last.fm API key should be 32 letters and numbers. Copy the API key, not the shared secret.");
    setBusy(true);
    try { if (!(await validateKey(c.lastfmKey))) { setErr("Last.fm rejected this API key. Check it and try again."); setBusy(false); return; } }
    catch (x: any) { setErr(x.message); setBusy(false); return; }
    saveCfg(c, remember); onSaved(c);
  };
  return <main>
    <h1>Spotify Organizer</h1>
    <p className="dim">Organize your Spotify Liked Songs by how many times the world has listened to them.</p>
    <div className="card clay" style={{ marginTop: 28 }}>
      <h2 style={{ marginTop: 6 }}>Set up your own keys</h2>
      <p className="dim">Everything runs in this browser with your own Spotify app and Last.fm key. Your keys and songs are never stored on a server.</p>
      {location.hostname === "localhost" && <p className="err">Open this page at http://127.0.0.1:5173 instead of localhost. Spotify rejects localhost.</p>}
      <ol>
        <li>Create an app at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a>, choose Web API, and add this redirect URI:
          <div className="row" style={{ marginTop: 8 }}><code>{uri}</code><button type="button" className="btn small" onClick={() => navigator.clipboard.writeText(uri)}>Copy</button></div></li>
        <li>Create a Last.fm key at <a href="https://www.last.fm/api/account/create" target="_blank" rel="noreferrer">last.fm/api/account/create</a>.</li>
      </ol>
      <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
        <label className="fld">Spotify Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} required /></label>
        <label className="fld">Last.fm API key<input type="password" value={lastfmKey} onChange={(e) => setLastfmKey(e.target.value)} autoComplete="off" spellCheck={false} required /></label>
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember my keys on this device (otherwise they clear when you close the tab)</label>
        {err && <p className="err">{err}</p>}
        <div><button className="btn mint" disabled={busy}>{busy ? "Checking…" : "Save and continue"}</button></div>
      </form>
    </div>
  </main>;
}

export default function App() {
  const [cfg, setCfg] = useState<Cfg | null>(getCfg);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<Job>({ status: "idle" });
  const [library, setLibrary] = useState<Track[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [apply, setApply] = useState<ApplyJob>({ status: "idle" });
  const [snap, setSnap] = useState(0);
  const [options, setOptions] = useState<Opts>(() => cleanOptions(load("vr-options", {})));
  const [tab, setTab] = useState<"playlists" | "insights">("playlists");
  const [open, setOpen] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cover, setCover] = useState(false);
  const [fontTick, setFontTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const c = getCfg();
        if (c) {
          if (location.pathname === "/callback") {
            const p = new URLSearchParams(location.search);
            if (p.get("error")) throw new Error(`Spotify login was cancelled or failed: ${p.get("error")}`);
            await finishLogin(c.clientId, p.get("code") ?? "", p.get("state") ?? "");
            history.replaceState({}, "", "/");
          }
          if (hasTokens()) { const u = await getMe(c.clientId); setMe({ id: u.id, name: u.display_name || u.id }); }
        }
      } catch (e: any) { setError(e.message); clearTokens(); history.replaceState({}, "", "/"); }
      setBooting(false);
    })();
    document.fonts?.load("800 40px Nunito").then(() => setFontTick(1)).catch(() => {});
  }, []);
  useEffect(() => { save("vr-options", options); }, [options]);
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setOptions((o) => ({ ...o, [k]: v }));

  const plan = useMemo(() => (library ? buildPlan(library, options) : null), [library, options]);
  const ins = useMemo(() => (library ? makeInsights(library) : null), [library]);
  const diff = useMemo(() => (plan && me ? computeDiff(me.id, plan.groups) : null), [plan, me, snap]);
  const artistList = useMemo(() => {
    const m = new Map<string, number>(); (library ?? []).forEach((t) => m.set(t.artist, (m.get(t.artist) ?? 0) + 1));
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [library]);
  const names = plan ? plan.groups.map((g) => g.name).join("|") : "";
  const covers = useMemo(() => (cover && plan ? Object.fromEntries(plan.groups.map((g) => [g.name, makeCover(g.name)])) : {}), [cover, names, fontTick]);

  const connect = async () => { if (cfg) try { await startLogin(cfg.clientId); } catch (e: any) { setError(e.message); } };
  const reset = () => { clearAll(); setCfg(null); setMe(null); setLibrary(null); setAnalysis({ status: "idle" }); setApply({ status: "idle" }); };
  const analyze = async () => {
    if (!cfg) return;
    setError(""); setApply({ status: "idle" }); setAnalysis({ status: "running", phase: "Starting", done: 0, total: 0 });
    try {
      const r = await analyzeLib(cfg, (phase, done, total) => { if (done % 5 === 0 || done === total) setAnalysis({ status: "running", phase, done, total }); });
      setLibrary(r.library); setSkipped(r.skipped); setAnalysis({ status: "done" });
    } catch (e: any) { setAnalysis({ status: "error", error: e.message }); }
  };
  const run = async () => {
    if (!plan || !cfg || !me || !confirm("Create or update these playlists now? Only playlists created by this app are changed.")) return;
    setError(""); setApply({ status: "running" });
    await applyPlan(cfg, me.id, plan.groups, cover ? covers : {}, setApply);
    setSnap((n) => n + 1);
  };

  if (booting) return <main><p className="dim">Loading…</p></main>;
  if (!cfg) return <Setup onSaved={(c) => { setCfg(c); setError(""); }} />;
  if (!me) return <main>
    <h1>Spotify Organizer</h1>
    <p className="dim">Organize your Spotify Liked Songs by how many times the world has listened to them.</p>
    {error && <p className="err">{error}</p>}
    <div className="row" style={{ marginTop: 28 }}><button className="btn mint" onClick={connect}>Connect Spotify</button><button className="btn small" onClick={reset}>Change keys</button></div>
  </main>;

  const busy = analysis.status === "running";
  const pct = analysis.total ? Math.round(((analysis.done ?? 0) / analysis.total) * 100) : 0;
  const unit = options.metric === "playcount" ? "plays" : "listeners";
  const range = (g: Group) => { const v = g.tracks.map((t) => t[options.metric] ?? 0); return `${fmt(Math.min(...v))} to ${fmt(Math.max(...v))} ${unit}`; };
  const stepBadge = (s: Step) => s.state === "done" ? (s.created ? "✓ created" : "✓ updated") : s.state === "working" ? "…" : s.state === "error" ? "✗" : "";

  return <main>
    <div className="row between"><div><h1>Spotify Organizer</h1><p className="dim" style={{ margin: 0 }}>Connected as {me.name}</p></div>
      <button className="btn small" onClick={reset}>Disconnect and clear keys</button></div>
    {error && <p className="err">{error}</p>}

    <div className="stats">
      <div className="tile clay"><b>{library ? fmt(library.length) : "—"}</b>Liked Songs</div>
      <div className="tile clay"><b>{plan ? fmt(plan.rankedCount) : "—"}</b>Ranked</div>
      <div className="tile clay"><b>{plan ? fmt(plan.unranked.length) : "—"}</b>Unranked</div>
      <div className="tile clay"><b>{plan ? plan.groups.length : "—"}</b>Playlists to create or update</div>
    </div>

    <div className="row"><button className="btn mint" onClick={analyze} disabled={busy}>{analysis.status === "done" ? "Analyze again" : "Analyze my songs"}</button>
      {plan && <button className="btn lilac" onClick={() => exportCsv(plan.groups, plan.unranked)}>Export CSV</button>}</div>
    {busy && <div className="card clay" style={{ marginTop: 20 }}><b>{analysis.phase}</b> <span className="dim">{analysis.done ?? 0} of {analysis.total || "…"}</span><div className="meter"><i style={{ width: `${pct}%` }} /></div>
      <span className="dim">The first run looks up every song on Last.fm (about 4 per second). Keep this tab open. Later runs reuse saved results.</span></div>}
    {analysis.status === "error" && <p className="err">Analysis failed: {analysis.error}</p>}

    {library && plan && <>
      <h2>Ranking options</h2>
      <div className="card clay"><div className="opts">
        <label className="fld">Rank by<Seg label="Rank by" value={options.metric} onChange={(v) => set("metric", v)} options={[["playcount", "Plays"], ["listeners", "Listeners"]]} /></label>
        <label className="fld">Group songs by<select value={options.mode} onChange={(e) => set("mode", e.target.value as Opts["mode"])}>
          <option value="ranges">Rank ranges (Top 50, 51-100, …)</option><option value="tiers">Popularity tiers</option><option value="released">Release year (song or movie)</option><option value="added">Year added to Liked Songs</option><option value="genre">Genre tag</option></select></label>
        {options.mode === "ranges" && <>
          <label className="fld">Songs per playlist<Seg label="Songs per playlist" value={options.groupSize} onChange={(v) => set("groupSize", v)} options={[[25, "25"], [50, "50"], [100, "100"]]} /></label>
          <label className="fld">Playlist names<Seg label="Playlist names" value={options.naming} onChange={(v) => set("naming", v)} options={[["range", "Top 50"], ["numbered", "Batch 01"], ["tier", "Tier 1"]]} /></label></>}
        <label className="fld">Order inside playlists<Seg label="Order" value={options.order} onChange={(v) => set("order", v)} options={[["rank", "Rank"], ["shuffle", "Shuffle"], ["newest", "Newest"], ["oldest", "Oldest"]]} /></label>
        <ArtistPicker list={artistList} value={options.artists} onChange={(v) => set("artists", v)} />
        <label className="fld">Only this album<input value={options.album} onChange={(e) => set("album", e.target.value)} placeholder="Any album" /></label>
        <label className="fld">Only this genre tag<input value={options.tag} onChange={(e) => set("tag", e.target.value)} placeholder="e.g. indie" /></label>
      </div>{plan.filteredOut > 0 && <p className="dim">{plan.filteredOut} songs are hidden by your filters.</p>}</div>

      <div className="row" style={{ margin: "26px 0 6px" }}><Seg label="View" value={tab} onChange={setTab} options={[["playlists", "Playlists"], ["insights", "Insights"]]} /></div>
      {tab === "insights" && (ins ? <Insights ins={ins} /> : <p>Nothing to show yet: no songs matched on Last.fm.</p>)}
      {tab === "playlists" && <>
        <h2>Playlist preview</h2>
        {skipped > 0 && <p className="dim">{skipped} deleted, local or unavailable items were skipped.</p>}
        {diff && <p className="dim">Since your last update: {diff.moved} moved, {diff.added} new, {diff.removed} removed.</p>}
        <div className="row" style={{ alignItems: "end", marginBottom: 18 }}>
          <label className="fld" style={{ flex: 1, maxWidth: 360 }}>Search songs<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Song, artist, album or tag" /></label>
          {Object.keys(options.renames).length > 0 && <button className="btn small" onClick={() => set("renames", {})}>Reset playlist names</button>}</div>
        <p className="dim">Type in a playlist's name box to give it your own name. The name is used when you create or update.</p>
        {plan.groups.length === 0 && <p>No songs to rank with the current options.</p>}
        {plan.groups.map((g) => { const d = diff?.perGroup[g.name]; return <div className="card clay" key={g.key}>
          <div className="row between">
            <div className="row" style={{ flex: 1, minWidth: 240 }}>
              {cover && covers[g.name] && <img className="thumb" alt="" src={`data:image/jpeg;base64,${covers[g.name]}`} />}
              <div style={{ flex: 1 }}>
                <input className="nameinput" value={options.renames[g.key] ?? g.key} placeholder={g.key} maxLength={100} aria-label={`Playlist name for ${g.key}`}
                  onChange={(e) => set("renames", { ...options.renames, [g.key]: e.target.value })} />
                <div className="dim">{g.tracks.length} songs · {range(g)}{d && d.in > 0 && <span className="badge">+{d.in}</span>}{d && d.out > 0 && <span className="badge out">−{d.out}</span>}</div>
              </div></div>
            <button className="btn small" onClick={() => setOpen(open === g.key ? null : g.key)}>{open === g.key ? "Hide songs" : "View songs"}</button></div>
          {open === g.key && <SongTable tracks={g.tracks} q={q} />}</div>; })}
        {plan.unranked.length > 0 && <div className="card clay">
          <div className="row between"><div><b>Unranked</b> <span className="dim">{plan.unranked.length} songs with no Last.fm match. Not added to any playlist.</span></div>
            <button className="btn small" onClick={() => setOpen(open === "_u" ? null : "_u")}>{open === "_u" ? "Hide songs" : "View songs"}</button></div>
          {open === "_u" && <ul className="plain" style={{ marginTop: 12 }}>{plan.unranked.filter((t) => !q || `${t.name} ${t.artist}`.toLowerCase().includes(q.toLowerCase())).map((t) => <li className="match" key={t.id}>
            <div className="row between"><span>{t.name} <span className="dim">by {t.artist}</span></span><button className="btn sky small" onClick={() => setFixing(fixing === t.id ? null : t.id)}>{fixing === t.id ? "Close" : "Fix match"}</button></div>
            {fixing === t.id && <Fix t={t} cfg={cfg} onDone={(e) => { setFixing(null); setLibrary((lib) => lib!.map((x) => (x.id === t.id ? { ...x, ...e } : x))); }} />}</li>)}</ul>}
        </div>}

        {plan.groups.length > 0 && <div className="card clay" style={{ marginTop: 28 }}>
          <div className="row"><button className="btn" onClick={run} disabled={apply.status === "running"}>Create / Update playlists</button>
            <label className="check"><input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} /> Add cover art</label></div>
          {apply.error && <p className="err">{apply.error}</p>}
          {apply.steps && <div style={{ marginTop: 16 }}>{apply.steps.map((s) => <div key={s.name}>
            <span className={s.state === "done" ? "ok" : s.state === "error" ? "err" : "dim"}>{s.name} {stepBadge(s)}</span>
            {s.message && <div className={s.state === "error" ? "err" : "dim"} style={{ marginLeft: 16 }}>{s.message}</div>}</div>)}
            {apply.status === "done" && <p className="ok">Finished. Open Spotify to see your playlists.</p>}
            {apply.leftover && apply.leftover.length > 0 && <p className="dim">These earlier playlists made by this app were left unchanged: {apply.leftover.join(", ")}. Delete them in Spotify if you no longer need them.</p>}</div>}
        </div>}
      </>}
    </>}
  </main>;
}
