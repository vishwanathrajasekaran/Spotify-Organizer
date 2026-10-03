// 300x300 rich cover art: layered gradients, glow, rings, equalizer bars, grain, then a frosted name panel.
const PALETTES = [
  ["#1b1464", "#6a11cb", "#ff6ec4", "#ffd1ff"],
  ["#04293a", "#0a7e8c", "#27d3b0", "#d4fff4"],
  ["#3a0ca3", "#f72585", "#ff9e00", "#ffe8b0"],
  ["#0b132b", "#1c5d99", "#4cc9f0", "#d7f6ff"],
  ["#2d1b69", "#c9184a", "#ff758f", "#ffe0e6"],
  ["#14213d", "#e85d04", "#ffba08", "#fff4d6"],
];
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function makeCover(name: string): string {
  const W = 300, c = document.createElement("canvas"); c.width = c.height = W;
  const x = c.getContext("2d")!;
  const seed = [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7), r = rng(seed), p = PALETTES[Math.abs(seed) % PALETTES.length];

  const base = x.createLinearGradient(0, 0, W, W);
  base.addColorStop(0, p[0]); base.addColorStop(0.55, p[1]); base.addColorStop(1, p[2]);
  x.fillStyle = base; x.fillRect(0, 0, W, W);

  for (let i = 0; i < 4; i++) {   // glowing blobs
    const cx = r() * W, cy = r() * W, rad = 80 + r() * 100, col = p[1 + Math.floor(r() * 3)];
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, col + "cc"); g.addColorStop(1, col + "00");
    x.fillStyle = g; x.fillRect(0, 0, W, W);
  }
  const ox = W * (0.2 + r() * 0.6), oy = W * (0.2 + r() * 0.6);   // vinyl-style rings
  x.lineWidth = 1.3;
  for (let i = 1; i <= 10; i++) { x.strokeStyle = `rgba(255,255,255,${Math.max(0.03, 0.2 - i * 0.015)})`; x.beginPath(); x.arc(ox, oy, i * 22, 0, Math.PI * 2); x.stroke(); }
  const n = 18;   // equalizer bars
  for (let i = 0; i < n; i++) {
    const h = 20 + r() * 80, bx = 14 + (i * (W - 28)) / n, g = x.createLinearGradient(0, W, 0, W - h);
    g.addColorStop(0, "rgba(255,255,255,.32)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(bx, W - h, 10, h);
  }
  for (let i = 0; i < 28; i++) { x.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`; x.beginPath(); x.arc(r() * W, r() * W * 0.7, 0.8 + r() * 1.8, 0, Math.PI * 2); x.fill(); }
  const vg = x.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W * 0.78);   // vignette
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.38)");
  x.fillStyle = vg; x.fillRect(0, 0, W, W);
  for (let i = 0; i < 2200; i++) { x.fillStyle = r() > 0.5 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.05)"; x.fillRect(r() * W, r() * W, 1.2, 1.2); }   // grain

  // name: wrap to at most 3 lines, shrink to fit
  const label = name.trim() || "Playlist", maxW = 228;
  let size = 58, lines: string[] = [label];
  for (; size >= 22; size -= 2) {
    x.font = `800 ${size}px Nunito, system-ui, sans-serif`;
    const words = label.split(/\s+/), tmp: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width <= maxW || !cur) cur = t; else { tmp.push(cur); cur = w; } }
    tmp.push(cur);
    if (tmp.length <= 3 && tmp.every((l) => x.measureText(l).width <= maxW)) { lines = tmp; break; }
    lines = tmp;
  }
  const lh = size * 1.15, ph = lines.length * lh + 36, py = (W - ph) / 2, px = 26, pw = W - 52;
  x.beginPath(); x.moveTo(px + 26, py); x.arcTo(px + pw, py, px + pw, py + ph, 26); x.arcTo(px + pw, py + ph, px, py + ph, 26); x.arcTo(px, py + ph, px, py, 26); x.arcTo(px, py, px + pw, py, 26); x.closePath();
  x.fillStyle = "rgba(255,255,255,.16)"; x.fill(); x.lineWidth = 1.5; x.strokeStyle = "rgba(255,255,255,.4)"; x.stroke();
  x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = "rgba(0,0,0,.4)"; x.shadowBlur = 10; x.shadowOffsetY = 3;
  x.font = `800 ${size}px Nunito, system-ui, sans-serif`;
  lines.forEach((l, i) => x.fillText(l, W / 2, py + 18 + lh / 2 + i * lh));
  return c.toDataURL("image/jpeg", 0.86).split(",")[1];
}
