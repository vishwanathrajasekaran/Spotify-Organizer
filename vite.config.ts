import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served under /spotify-organizer/ (tools.vishwanathrajasekaran.in/spotify-organizer/).
// To host it at the root of its own domain instead, set base to "/".
const base = "/spotify-organizer/";
// Last.fm calls go through a same-origin <base>lastfm/2.0 path (avoids browser CORS limits).
// In production the same path is handled by the rewrite in vercel.json.
const lastfm = {
  [`${base}lastfm`]: { target: "https://ws.audioscrobbler.com", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/spotify-organizer\/lastfm\/2\.0\/?/, "/2.0/") },
};
export default defineConfig({
  base,
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, proxy: lastfm },
  preview: { host: "127.0.0.1", port: 4173, proxy: lastfm },
});
