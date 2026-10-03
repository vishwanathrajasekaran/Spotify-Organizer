import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Last.fm calls go through a same-origin /lastfm/2.0 path (avoids browser CORS limits).
// In production the same path is handled by the rewrite in vercel.json.
const lastfm = {
  "/lastfm": { target: "https://ws.audioscrobbler.com", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/lastfm\/2\.0\/?/, "/2.0/") },
};
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, proxy: lastfm },
  preview: { host: "127.0.0.1", port: 4173, proxy: lastfm },
});
