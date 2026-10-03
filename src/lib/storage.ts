export interface Cfg { clientId: string; lastfmKey: string }
const read = (s: Storage, k: string) => { try { const v = s.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
export const load = <T,>(k: string, fallback: T): T => (read(localStorage, k) ?? fallback) as T;
export const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
// Keys: kept in this browser only. "remember" = this device (localStorage), otherwise this tab (sessionStorage).
export const getCfg = (): Cfg | null => read(localStorage, "vr-cfg") ?? read(sessionStorage, "vr-cfg");
export function saveCfg(c: Cfg, remember: boolean) {
  localStorage.removeItem("vr-cfg"); sessionStorage.removeItem("vr-cfg");
  (remember ? localStorage : sessionStorage).setItem("vr-cfg", JSON.stringify(c));
}
export const clearAll = () => { for (const k of ["vr-cfg", "vr-tokens", "vr-pkce"]) { localStorage.removeItem(k); sessionStorage.removeItem(k); } };
